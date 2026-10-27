-- 20261027b_mfa_funciones_e_interruptor.sql
--
-- Paso 2 del blindaje (/blindar-seguridad, 27/10/2026): las funciones del
-- segundo factor y el interruptor que lo hace obligatorio. Portado de RiskGuard
-- (20261026b_mfa_satisfecho_y_sesiones + 20261027_politicas_seguridad_mfa),
-- con `search_path = ''` como el resto de funciones de Flujos.
--
-- NO LE CAMBIA NADA A NADIE HOY: ninguna política usa todavía mfa_satisfecho()
-- (las restrictivas `_aal2` son el paso 4) y el interruptor solo lo lee el
-- navegador, que aún no tiene la pantalla del segundo factor (paso 3).
--
-- MEDIDO EL 27/10/2026 ANTES DE ESCRIBIR NADA
--   · No existen mfa_satisfecho, es_admin_plataforma ni politicas_seguridad.
--   · 7 usuarios, 0 con factor verificado; ninguno con la marca
--     app_metadata.admin_plataforma.
--   · Sin triggers en auth.users.
--
-- QUÉ HACE
--   1. mfa_satisfecho() — cierta si la sesión del JWT sigue viva en
--      auth.sessions y, además, pasó el segundo factor (aal2, TOTP/teléfono/
--      webauthn) hace menos de 6 h, o el usuario no tiene ningún factor
--      verificado. Esa última rama es la que permite el alta del factor tras la
--      contraseña: NO SE QUITA, el interruptor depende de ella.
--      Las 6 h viven aquí y en CADUCIDAD_MFA_HORAS del frontend: iguales.
--   2. mis_sesiones() / cerrar_sesiones(ids) — ventanilla sobre auth.sessions
--      para el panel de sesiones abiertas. Nunca la sesión actual ni la de otro.
--   3. es_admin_plataforma() — cierta si el JWT trae
--      app_metadata.admin_plataforma = true. app_metadata solo lo escribe la
--      clave de servicio; el rol `admin` de Flujos NO la tiene por serlo.
--   4. politicas_seguridad — una sola fila (la clave es un booleano que solo
--      admite true), sin organization_id a propósito: es la política de la
--      plataforma, no dato de una organización. exigir_mfa NO es control de
--      acceso: decide si el NAVEGADOR obliga a dar de alta el factor. La
--      barrera de datos es mfa_satisfecho().
--        · leer: todo `authenticated`, sin `_aal2` (el login la lee antes del
--          código);
--        · cambiar: solo exigir_mfa, solo es_admin_plataforma() y solo con aal2
--          de verdad;
--        · insertar, borrar, vaciar: nadie (sin GRANT y sin política); anon: nada.
--      updated_at / updated_by los pone el trigger.
--      Se siembra con exigir_mfa = true: obligatorio para todos (Hermes, 27/10).
--
-- CÓMO SE CORRE: dos sentencias. La 1 es un solo bloque DO, atómico. La 2 es
-- la verificación de solo lectura y es lo único que se ve.
--
-- ESPERADO en la sentencia 2: filas 1, exigir_mfa true, rls true,
-- anon_tabla [], authenticated_tabla ["SELECT"], authenticated_columnas
-- ["exigir_mfa"], políticas select y update, y en las cuatro funciones
-- anon false / authenticated true.

-- ─────────────────────────── SENTENCIA 1 de 2 ──────────────────────────────
DO $mig$
DECLARE
  v_mal text;
BEGIN
  -- >>> CUERPO (el ensayo lo copia literal)
  IF to_regclass('public.politicas_seguridad') IS NOT NULL
     OR to_regprocedure('public.mfa_satisfecho()') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTA - politicas_seguridad o mfa_satisfecho() ya existen: mirar antes';
  END IF;

  EXECUTE $f$
    create function public.mfa_satisfecho()
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $body$
      select
        exists (
          select 1
            from auth.sessions s
           where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
             and (s.not_after is null or s.not_after > now())
        )
        and (
          (
            coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
            and exists (
              select 1
                from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
               where e ->> 'method' in ('totp', 'phone', 'webauthn')
                 and to_timestamp((e ->> 'timestamp')::bigint) > now() - interval '6 hours'
            )
          )
          or not exists (
            select 1
              from auth.mfa_factors f
             where f.user_id = auth.uid()
               and f.status  = 'verified'
          )
        );
    $body$
  $f$;
  EXECUTE $f$
    comment on function public.mfa_satisfecho() is
      'Cierta si la sesión del JWT sigue abierta en auth.sessions y, además, pasó el segundo factor (aal2) hace menos de 6 horas según el claim amr, o el usuario no tiene ninguno verificado. Para las restrictivas <tabla>_aal2. 27/10/2026.'
  $f$;

  EXECUTE $f$
    create function public.mis_sesiones()
    returns table (id uuid, creada timestamptz, ultimo_uso timestamptz, nivel text, navegador text, ip text, actual boolean)
    language sql
    stable
    security definer
    set search_path = ''
    as $body$
      select s.id,
             s.created_at,
             coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at),
             s.aal::text,
             s.user_agent,
             host(s.ip),
             s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        from auth.sessions s
       where s.user_id = auth.uid()
         and (s.not_after is null or s.not_after > now())
         and public.mfa_satisfecho();
    $body$
  $f$;
  EXECUTE $f$
    comment on function public.mis_sesiones() is
      'Sesiones abiertas del usuario que llama, con la actual marcada. Ventanilla sobre auth.sessions: la tabla no se expone. Exige mfa_satisfecho().'
  $f$;

  EXECUTE $f$
    create function public.cerrar_sesiones(ids uuid[] default null)
    returns integer
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $body$
    declare
      n integer;
    begin
      if auth.uid() is null or not public.mfa_satisfecho() then
        raise exception 'Hace falta una sesión verificada para cerrar sesiones'
          using errcode = '42501';
      end if;

      delete from auth.sessions s
       where s.user_id = auth.uid()
         and s.id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid
         and (ids is null or s.id = any (ids));

      get diagnostics n = row_count;
      return n;
    end;
    $body$
  $f$;
  EXECUTE $f$
    comment on function public.cerrar_sesiones(uuid[]) is
      'Cierra sesiones del usuario que llama: las indicadas o, sin ids, todas menos la actual. Nunca la actual ni las de otro usuario. Exige mfa_satisfecho(). Devuelve cuántas cerró.'
  $f$;

  EXECUTE $f$
    create function public.es_admin_plataforma()
    returns boolean
    language sql
    stable
    set search_path = ''
    as $body$
      select coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_plataforma', '') = 'true';
    $body$
  $f$;
  EXECUTE $f$
    comment on function public.es_admin_plataforma() is
      'Cierta si el JWT trae app_metadata.admin_plataforma = true. Solo la tiene el dueño de la plataforma; el rol admin de una organización no. 27/10/2026.'
  $f$;

  CREATE TABLE public.politicas_seguridad (
    id          boolean     PRIMARY KEY DEFAULT true CHECK (id),
    exigir_mfa  boolean     NOT NULL DEFAULT true,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL
  );
  COMMENT ON TABLE public.politicas_seguridad IS
    'Política de seguridad de la plataforma: una sola fila. exigir_mfa decide si el navegador obliga a dar de alta el segundo factor a quien no lo tiene; la barrera de datos es mfa_satisfecho() y no depende de esto. 27/10/2026.';

  EXECUTE $f$
    create function public.politicas_seguridad_sello()
    returns trigger
    language plpgsql
    set search_path = ''
    as $body$
    begin
      new.updated_at := now();
      new.updated_by := auth.uid();
      return new;
    end;
    $body$
  $f$;

  CREATE TRIGGER politicas_seguridad_sello
    BEFORE UPDATE ON public.politicas_seguridad
    FOR EACH ROW EXECUTE FUNCTION public.politicas_seguridad_sello();

  ALTER TABLE public.politicas_seguridad ENABLE ROW LEVEL SECURITY;

  CREATE POLICY politicas_seguridad_select ON public.politicas_seguridad
    FOR SELECT TO authenticated
    USING (true);

  CREATE POLICY politicas_seguridad_update ON public.politicas_seguridad
    FOR UPDATE TO authenticated
    USING      ( (SELECT public.es_admin_plataforma())
                 AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
                 AND (SELECT public.mfa_satisfecho()) )
    WITH CHECK ( (SELECT public.es_admin_plataforma())
                 AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
                 AND (SELECT public.mfa_satisfecho()) );

  -- Supabase concede EXECUTE y ALL a anon y authenticated POR NOMBRE en todo
  -- lo nuevo: REVOKE FROM PUBLIC no basta (CLAUDE.md §6.4).
  REVOKE EXECUTE ON FUNCTION public.mfa_satisfecho()            FROM PUBLIC, anon;
  REVOKE EXECUTE ON FUNCTION public.mis_sesiones()              FROM PUBLIC, anon;
  REVOKE EXECUTE ON FUNCTION public.cerrar_sesiones(uuid[])     FROM PUBLIC, anon;
  REVOKE EXECUTE ON FUNCTION public.es_admin_plataforma()       FROM PUBLIC, anon;
  REVOKE EXECUTE ON FUNCTION public.politicas_seguridad_sello() FROM PUBLIC, anon, authenticated;
  GRANT  EXECUTE ON FUNCTION public.mfa_satisfecho()            TO authenticated;
  GRANT  EXECUTE ON FUNCTION public.mis_sesiones()              TO authenticated;
  GRANT  EXECUTE ON FUNCTION public.cerrar_sesiones(uuid[])     TO authenticated;
  GRANT  EXECUTE ON FUNCTION public.es_admin_plataforma()       TO authenticated;

  REVOKE ALL ON TABLE public.politicas_seguridad FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON TABLE public.politicas_seguridad TO authenticated;
  GRANT UPDATE (exigir_mfa) ON TABLE public.politicas_seguridad TO authenticated;

  INSERT INTO public.politicas_seguridad (id, exigir_mfa) VALUES (true, true);

  -- GUARDAS
  SELECT string_agg(f, ', ') INTO v_mal
  FROM unnest(ARRAY['public.mfa_satisfecho()', 'public.mis_sesiones()',
                    'public.cerrar_sesiones(uuid[])', 'public.es_admin_plataforma()']) AS f
  WHERE has_function_privilege('anon', f, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', f, 'EXECUTE');
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADA - permisos de EXECUTE incorrectos en %', v_mal;
  END IF;

  SELECT string_agg(r || ':' || p, ', ') INTO v_mal
  FROM unnest(ARRAY['anon', 'authenticated']) r,
       unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  WHERE has_table_privilege(r, 'public.politicas_seguridad', p);
  IF v_mal IS NOT NULL OR has_table_privilege('anon', 'public.politicas_seguridad', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.politicas_seguridad', 'SELECT') THEN
    RAISE EXCEPTION 'ABORTADA - privilegios de tabla incorrectos: %', coalesce(v_mal, 'SELECT');
  END IF;

  IF has_column_privilege('authenticated', 'public.politicas_seguridad', 'updated_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.politicas_seguridad', 'id', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.politicas_seguridad', 'exigir_mfa', 'UPDATE') THEN
    RAISE EXCEPTION 'ABORTADA - UPDATE por columna incorrecto';
  END IF;

  IF (SELECT count(*) FROM public.politicas_seguridad) <> 1
     OR NOT (SELECT exigir_mfa FROM public.politicas_seguridad) THEN
    RAISE EXCEPTION 'ABORTADA - la fila sembrada no es (true, true)';
  END IF;
  -- <<< CUERPO
END
$mig$;

-- ─────────────────────────── SENTENCIA 2 de 2 ──────────────────────────────
-- Verificación de solo lectura. Mide el estado FINAL.
SELECT jsonb_build_object(
  'filas',      (SELECT count(*) FROM public.politicas_seguridad),
  'exigir_mfa', (SELECT exigir_mfa FROM public.politicas_seguridad),
  'rls',        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.politicas_seguridad'::regclass),
  'anon_tabla', (SELECT coalesce(jsonb_agg(p), '[]'::jsonb)
                 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                 WHERE has_table_privilege('anon', 'public.politicas_seguridad', p)),
  'authenticated_tabla', (SELECT coalesce(jsonb_agg(p), '[]'::jsonb)
                          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                          WHERE has_table_privilege('authenticated', 'public.politicas_seguridad', p)),
  'authenticated_columnas', (SELECT coalesce(jsonb_agg(c), '[]'::jsonb)
                             FROM unnest(ARRAY['id', 'exigir_mfa', 'updated_at', 'updated_by']) c
                             WHERE has_column_privilege('authenticated', 'public.politicas_seguridad', c, 'UPDATE')),
  'politicas', (SELECT jsonb_agg(jsonb_build_object('nombre', polname, 'cmd', polcmd) ORDER BY polname)
                FROM pg_policy WHERE polrelid = 'public.politicas_seguridad'::regclass),
  'funciones', (SELECT jsonb_object_agg(f, jsonb_build_object(
                         'anon', has_function_privilege('anon', f, 'EXECUTE'),
                         'authenticated', has_function_privilege('authenticated', f, 'EXECUTE')))
                FROM unnest(ARRAY['public.mfa_satisfecho()', 'public.mis_sesiones()',
                                  'public.cerrar_sesiones(uuid[])', 'public.es_admin_plataforma()']) f)
) AS verificacion;

-- ═══════════════════════════════════════════════════════════════════════════
-- VUELTA ATRÁS (nada depende de esto todavía; el frontend tratará «no se pudo
-- leer» como encendido, así que borrar la tabla no abre nada):
--
--   DROP TABLE IF EXISTS public.politicas_seguridad;
--   DROP FUNCTION IF EXISTS public.politicas_seguridad_sello();
--   DROP FUNCTION IF EXISTS public.es_admin_plataforma();
--   DROP FUNCTION IF EXISTS public.cerrar_sesiones(uuid[]);
--   DROP FUNCTION IF EXISTS public.mis_sesiones();
--   DROP FUNCTION IF EXISTS public.mfa_satisfecho();
--
-- (Cuando existan las restrictivas `_aal2` del paso 4, mfa_satisfecho() ya no
-- se puede borrar sin borrarlas antes a ellas.)
-- ═══════════════════════════════════════════════════════════════════════════
