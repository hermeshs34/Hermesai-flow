-- ENSAYO de 20261027b_mfa_funciones_e_interruptor.sql — ANTES de aplicarla.
-- NO deja nada en la base.
--
-- Dos pasadas con las mismas 25 pruebas:
--   ROJA  → sin la migración. Todas cubren el cambio: TIENEN que fallar.
--   VERDE → con el cuerpo de la migración pegado literal. Solo vale «25 de 25».
-- Esperado: «ROJA 0 de 25 … || VERDE 25 de 25 sin fallos».
--
-- Termina siempre en ERROR a propósito: el error deshace todo y el veredicto
-- viaja en el mensaje. Crea dentro tres usuarios de prueba y sus sesiones:
--   A — SIN factor, dos sesiones, solo contraseña (aal1);
--   B — CON factor verificado, una sesión aal1 y otra aal2, sin la marca;
--   P — CON la marca app_metadata.admin_plataforma, SIN factor, aal1 y aal2.
-- P sin factor es a propósito: así mfa_satisfecho() es cierta en su aal1 y la
-- prueba 17 demuestra que lo que lo frena es la exigencia de aal2.
-- No lee ni toca ninguna fila real. Generado desde la migración: el bloque
-- entre «>>> CUERPO» y «<<< CUERPO» es copia literal.
DO $ensayo$
DECLARE
  t_pasada  text;
  t_ok      int;
  t_total   int;
  t_fallos  text;
  t_res     text := '';
  t_b       boolean;
  t_b2      boolean;
  t_n       int;
  t_m       int;
  t_u       uuid;
  u_a uuid; u_b uuid; u_p uuid;
  s_a1 uuid; s_a2 uuid; s_b1 uuid; s_b2 uuid; s_p1 uuid; s_p2 uuid; s_muerta uuid;
  c_a jsonb; c_b_aal1 jsonb; c_b_aal2 jsonb; c_p_aal1 jsonb; c_p_aal2 jsonb;
  marca jsonb := jsonb_build_object('provider', 'email', 'admin_plataforma', true);
  ahora bigint := extract(epoch FROM now())::bigint;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'ENSAYO: correr como postgres (es %)', current_user;
  END IF;

  FOREACH t_pasada IN ARRAY ARRAY['ROJA', 'VERDE'] LOOP
    t_ok := 0; t_total := 0; t_fallos := '';
    BEGIN
      IF t_pasada = 'VERDE' THEN
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
        END;
      END IF;

      -- Datos de prueba
      u_a := gen_random_uuid(); u_b := gen_random_uuid(); u_p := gen_random_uuid();
      s_a1 := gen_random_uuid(); s_a2 := gen_random_uuid();
      s_b1 := gen_random_uuid(); s_b2 := gen_random_uuid();
      s_p1 := gen_random_uuid(); s_p2 := gen_random_uuid();
      s_muerta := gen_random_uuid();   -- no se inserta: sesión ya cerrada
      INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
      VALUES (u_a, 'ensayo-a-' || u_a || '@ensayo.invalid', 'authenticated', 'authenticated', now(), now()),
             (u_b, 'ensayo-b-' || u_b || '@ensayo.invalid', 'authenticated', 'authenticated', now(), now()),
             (u_p, 'ensayo-p-' || u_p || '@ensayo.invalid', 'authenticated', 'authenticated', now(), now());
      INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
      VALUES (s_a1, u_a, now(), now(), 'aal1'), (s_a2, u_a, now(), now(), 'aal1'),
             (s_b1, u_b, now(), now(), 'aal2'), (s_b2, u_b, now(), now(), 'aal1'),
             (s_p1, u_p, now(), now(), 'aal1'), (s_p2, u_p, now(), now(), 'aal2');
      INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
      VALUES (gen_random_uuid(), u_b, 'ensayo', 'totp', 'verified', now(), now());

      c_a      := jsonb_build_object('sub', u_a, 'role', 'authenticated', 'session_id', s_a1, 'aal', 'aal1',
                    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_b_aal1 := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b2, 'aal', 'aal1',
                    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_b_aal2 := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
                    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 3600),
                                             jsonb_build_object('method', 'password', 'timestamp', ahora - 3700)));
      c_p_aal1 := jsonb_build_object('sub', u_p, 'role', 'authenticated', 'session_id', s_p1, 'aal', 'aal1',
                    'app_metadata', marca,
                    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_p_aal2 := jsonb_build_object('sub', u_p, 'role', 'authenticated', 'session_id', s_p2, 'aal', 'aal2',
                    'app_metadata', marca,
                    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 600),
                                             jsonb_build_object('method', 'password', 'timestamp', ahora - 700)));

      -- ═══ mfa_satisfecho() ═══

      -- 1. A sin factor, sesión viva, aal1 → satisfecho (deja dar de alta el factor).
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_a::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.mfa_satisfecho()' INTO t_b;
        RESET ROLE;
        IF t_b THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [1 A sin factor rechazado]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [1 ' || SQLSTATE || ']';
      END;

      -- 2. A con una sesión que ya no existe → no satisfecho.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', jsonb_build_object(
          'sub', u_a, 'role', 'authenticated', 'session_id', s_muerta, 'aal', 'aal1')::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.mfa_satisfecho()' INTO t_b;
        RESET ROLE;
        IF NOT t_b THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [2 sesión cerrada aceptada]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [2 ' || SQLSTATE || ']';
      END;

      -- 3. B con factor, solo contraseña (aal1) → no satisfecho.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.mfa_satisfecho()' INTO t_b;
        RESET ROLE;
        IF NOT t_b THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [3 B aal1 aceptado]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [3 ' || SQLSTATE || ']';
      END;

      -- 4. B aal2, TOTP hace 1 h → satisfecho.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal2::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.mfa_satisfecho()' INTO t_b;
        RESET ROLE;
        IF t_b THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [4 B aal2 reciente rechazado]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [4 ' || SQLSTATE || ']';
      END;

      -- 5. B aal2, TOTP hace 7 h → caducado.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', jsonb_build_object(
          'sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
          'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 7 * 3600)))::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.mfa_satisfecho()' INTO t_b;
        RESET ROLE;
        IF NOT t_b THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [5 TOTP de hace 7 h aceptado]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [5 ' || SQLSTATE || ']';
      END;

      -- 6. B con aal2 en el claim pero sin método fuerte en amr → no satisfecho.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', jsonb_build_object(
          'sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
          'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)))::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.mfa_satisfecho()' INTO t_b;
        RESET ROLE;
        IF NOT t_b THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [6 aal2 sin TOTP aceptado]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [6 ' || SQLSTATE || ']';
      END;

      -- ═══ mis_sesiones() / cerrar_sesiones() ═══

      -- 7. A ve sus 2 sesiones, una marcada como actual, ninguna de otro.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_a::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT count(*), count(*) FILTER (WHERE actual) FROM public.mis_sesiones()' INTO t_n, t_m;
        RESET ROLE;
        IF t_n = 2 AND t_m = 1 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [7 A ve ' || t_n || ' sesiones, ' || t_m || ' actuales]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [7 ' || SQLSTATE || ']';
      END;

      -- 8. B solo con contraseña no ve sus sesiones.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT count(*) FROM public.mis_sesiones()' INTO t_n;
        RESET ROLE;
        IF t_n = 0 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [8 B aal1 ve ' || t_n || ' sesiones]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [8 ' || SQLSTATE || ']';
      END;

      -- 9. B solo con contraseña no puede cerrar sesiones (42501) y no se cierra ninguna.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.cerrar_sesiones()' INTO t_n;
        RESET ROLE;
        t_fallos := t_fallos || ' [9 B aal1 cerró ' || t_n || ' sesiones]';
      EXCEPTION
        WHEN insufficient_privilege THEN
          RESET ROLE;
          SELECT count(*) INTO t_n FROM auth.sessions WHERE user_id = u_b;
          IF t_n = 2 AND SQLERRM LIKE 'Hace falta una sesión verificada%' THEN t_ok := t_ok + 1;
          ELSE t_fallos := t_fallos || ' [9 rechazo con otro motivo: ' || SQLERRM || ']'; END IF;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [9 ' || SQLSTATE || ']';
      END;

      -- 10. A cierra «las demás»: cae A2; A1 (la actual) y las de B y P siguen.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_a::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.cerrar_sesiones()' INTO t_n;
        RESET ROLE;
        SELECT count(*) INTO t_m FROM auth.sessions
         WHERE id = s_a1 OR user_id IN (u_b, u_p);
        IF t_n = 1 AND t_m = 5 AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = s_a2) THEN
          t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [10 cerró ' || t_n || ', quedan ' || t_m || ' de 5]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [10 ' || SQLSTATE || ']';
      END;

      -- 11. anon no ejecuta mfa_satisfecho() (42501, no «no existe»).
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        SET LOCAL ROLE anon;
        EXECUTE 'SELECT public.mfa_satisfecho()' INTO t_b;
        RESET ROLE;
        t_fallos := t_fallos || ' [11 anon la ejecuta]';
      EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; t_ok := t_ok + 1;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [11 ' || SQLSTATE || ']';
      END;

      -- 12. anon no ejecuta cerrar_sesiones() (42501).
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        SET LOCAL ROLE anon;
        EXECUTE 'SELECT public.cerrar_sesiones()' INTO t_n;
        RESET ROLE;
        t_fallos := t_fallos || ' [12 anon la ejecuta]';
      EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; t_ok := t_ok + 1;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [12 ' || SQLSTATE || ']';
      END;

      -- ═══ Interruptor politicas_seguridad / es_admin_plataforma() ═══

      -- 13. A (sin factor, aal1, sin marca) LEE la política: una fila, encendida.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_a::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT count(*), bool_and(exigir_mfa) FROM public.politicas_seguridad' INTO t_n, t_b;
        RESET ROLE;
        IF t_n = 1 AND t_b THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [13 A lee ' || t_n || ' filas, exigir ' || coalesce(t_b::text, 'null') || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [13 ' || SQLSTATE || ']';
      END;

      -- 14. anon no la lee: 42501 por falta de GRANT.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        SET LOCAL ROLE anon;
        EXECUTE 'SELECT count(*) FROM public.politicas_seguridad' INTO t_n;
        RESET ROLE;
        t_fallos := t_fallos || ' [14 anon leyó ' || t_n || ']';
      EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; t_ok := t_ok + 1;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [14 ' || SQLSTATE || ']';
      END;

      -- 15. A sin marca no la cambia: 0 filas y sigue encendida.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_a::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'UPDATE public.politicas_seguridad SET exigir_mfa = false';
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        EXECUTE 'SELECT exigir_mfa FROM public.politicas_seguridad' INTO t_b;
        IF t_n = 0 AND t_b THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [15 A cambió ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [15 ' || SQLSTATE || ']';
      END;

      -- 16. B con factor y aal2 pero sin marca tampoco.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal2::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'UPDATE public.politicas_seguridad SET exigir_mfa = false';
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        EXECUTE 'SELECT exigir_mfa FROM public.politicas_seguridad' INTO t_b;
        IF t_n = 0 AND t_b THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [16 B aal2 sin marca cambió ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [16 ' || SQLSTATE || ']';
      END;

      -- 17. P con marca pero solo contraseña (aal1; sin factor, así que
      --     mfa_satisfecho() es cierta): no la cambia.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_p_aal1::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'UPDATE public.politicas_seguridad SET exigir_mfa = false';
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        EXECUTE 'SELECT exigir_mfa FROM public.politicas_seguridad' INTO t_b;
        IF t_n = 0 AND t_b THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [17 P aal1 cambió ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [17 ' || SQLSTATE || ']';
      END;

      -- 18. es_admin_plataforma(): cierta con la marca, falsa sin ella.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_p_aal2::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'SELECT public.es_admin_plataforma()' INTO t_b;
        PERFORM set_config('request.jwt.claims', c_b_aal2::text, true);
        EXECUTE 'SELECT public.es_admin_plataforma()' INTO t_b2;
        RESET ROLE;
        IF t_b AND NOT t_b2 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [18 es_admin_plataforma no distingue]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [18 ' || SQLSTATE || ']';
      END;

      -- 19. anon no ejecuta es_admin_plataforma(): 42501.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        SET LOCAL ROLE anon;
        EXECUTE 'SELECT public.es_admin_plataforma()' INTO t_b;
        RESET ROLE;
        t_fallos := t_fallos || ' [19 anon ejecutó]';
      EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; t_ok := t_ok + 1;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [19 ' || SQLSTATE || ']';
      END;

      -- 20. P con marca y aal2 no puede INSERTAR otra fila: 42501.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_p_aal2::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'INSERT INTO public.politicas_seguridad (id, exigir_mfa) VALUES (true, false)';
        RESET ROLE;
        t_fallos := t_fallos || ' [20 P insertó]';
      EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; t_ok := t_ok + 1;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [20 ' || SQLSTATE || ']';
      END;

      -- 21. P con marca y aal2 no puede BORRAR la fila: 42501 y la fila sigue.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_p_aal2::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'DELETE FROM public.politicas_seguridad';
        RESET ROLE;
        t_fallos := t_fallos || ' [21 P borró]';
      EXCEPTION
        WHEN insufficient_privilege THEN
          RESET ROLE;
          EXECUTE 'SELECT count(*) FROM public.politicas_seguridad' INTO t_n;
          IF t_n = 1 THEN t_ok := t_ok + 1;
          ELSE t_fallos := t_fallos || ' [21 la fila no está]'; END IF;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [21 ' || SQLSTATE || ']';
      END;

      -- 22. Nadie autenticado puede vaciarla (el RLS no cubre TRUNCATE): 42501.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_p_aal2::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'TRUNCATE public.politicas_seguridad';
        RESET ROLE;
        t_fallos := t_fallos || ' [22 P vació la tabla]';
      EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; t_ok := t_ok + 1;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [22 ' || SQLSTATE || ']';
      END;

      -- 23. P con marca y aal2 no puede falsear updated_by: sin GRANT de columna, 42501.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_p_aal2::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE format('UPDATE public.politicas_seguridad SET updated_by = %L', u_a);
        RESET ROLE;
        t_fallos := t_fallos || ' [23 P escribió updated_by]';
      EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; t_ok := t_ok + 1;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [23 ' || SQLSTATE || ']';
      END;

      -- 24. Una sola fila por construcción: la clave solo admite true (23514).
      t_total := t_total + 1;
      BEGIN
        EXECUTE 'INSERT INTO public.politicas_seguridad (id, exigir_mfa) VALUES (false, false)';
        t_fallos := t_fallos || ' [24 entró una segunda fila]';
      EXCEPTION
        WHEN check_violation THEN t_ok := t_ok + 1;
        WHEN OTHERS THEN t_fallos := t_fallos || ' [24 ' || SQLSTATE || ']';
      END;

      -- 25. P con marca y aal2 SÍ la apaga; el trigger sella quién.
      --     (La última: cambia la fila.)
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_p_aal2::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE 'UPDATE public.politicas_seguridad SET exigir_mfa = false';
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        EXECUTE 'SELECT exigir_mfa, updated_by FROM public.politicas_seguridad' INTO t_b, t_u;
        IF t_n = 1 AND NOT t_b AND t_u = u_p THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [25 P aal2 cambió ' || t_n || ', exigir ' || coalesce(t_b::text, 'null')
                         || ', sello ' || coalesce(t_u::text, 'null') || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [25 ' || SQLSTATE || ' ' || SQLERRM || ']';
      END;

      RAISE EXCEPTION 'deshacer_pasada';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'deshacer_pasada' THEN
        t_fallos := t_fallos || ' [error inesperado: ' || SQLSTATE || ' ' || SQLERRM || ']';
      END IF;
    END;
    t_res := t_res || t_pasada || ' ' || t_ok || ' de ' || t_total
             || CASE WHEN t_fallos = '' THEN ' sin fallos' ELSE t_fallos END || '  ||  ';
  END LOOP;

  RAISE EXCEPTION 'ENSAYO: %', t_res;
END
$ensayo$;
