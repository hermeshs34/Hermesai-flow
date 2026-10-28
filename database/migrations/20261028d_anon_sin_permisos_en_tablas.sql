-- ═══════════════════════════════════════════════════════════════════════════
-- 20261028d — `anon` sin permisos en las tablas de `public`
--
-- APLICADA en producción el 28/10/2026. Ensayo:
-- database/ensayos/20261028d_anon_sin_permisos_en_tablas.ensayo.sql
--   antes de aplicar: ROJA 3 de 9 → VERDE 9 de 9 sin fallos
--   después (pasada APLICADA, sin el bloque): APLICADA 9 de 9 sin fallos
--   sentencia 2: tablas_con_anon, defaults_postgres_anon y funciones_con_anon
--   vacíos; authenticated conserva sus cuatro permisos en la matriz. Sin residuo.
--
-- Diagnóstico del 28/10/2026 (solo lectura): `anon` —la clave pública, la que
-- va en el bundle del navegador— tiene concedidos SELECT/INSERT/UPDATE/DELETE
-- en 11 tablas y SELECT en otras 3. Ninguna política de RLS nombra a `anon`,
-- así que hoy no entra a nada: la RLS le devuelve vacío. Pero la RLS es la
-- ÚNICA capa, y una política permisiva escrita mañana `TO public` (o sin `TO`)
-- le abriría la puerta sin que nadie lo note. Misma doctrina que §6.7: «sin
-- política Y sin GRANT».
--
-- Nadie usa `anon` contra estas tablas: el frontend solo consulta tras iniciar
-- sesión (`auth.service.ts`, `mfa.ts`), `request-password-reset` usa la clave
-- de servicio y ninguna Edge Function monta un cliente con la anon.
--
-- QUÉ HACE:
--   1. REVOKE ALL a `anon` en las 14 tablas que lo tienen — lista EXPLÍCITA,
--      comparada con la base en los dos sentidos: si aparece otra tabla con
--      permisos de `anon`, o falta una de la lista, ABORTA sin tocar nada.
--   2. Quita a `anon` de los permisos por defecto de `postgres` en `public`
--      (tablas, secuencias y funciones): cada tabla o función nueva nacía con
--      `anon` dentro — la trampa de §6.4 («REVOKE FROM PUBLIC no basta»).
--   3. REVOKE EXECUTE a `PUBLIC` y `anon` en `set_updated_at()`, la única de las
--      23 funciones de `public` que los tenía (función de trigger: el permiso no
--      se comprueba al dispararse, así que no le hace falta a nadie).
--
-- LO QUE NO CIERRA:
--   • Los permisos por defecto de `supabase_admin` (también dan todo a `anon`):
--     `postgres` no puede cambiarlos. Solo afectan a objetos que cree
--     `supabase_admin`, y en `public` no crea ninguno. Medido: el paso 4 del
--     ensayo crea una tabla como `postgres`, que es como se crean aquí.
--   • Una función NUEVA sigue naciendo con EXECUTE para `PUBLIC` (y `anon` es
--     miembro de `PUBLIC`): es el defecto global de Postgres y solo se quita sin
--     `IN SCHEMA`, para todos los esquemas — demasiado ancho para esta migración.
--     Lo que sí se quita es el EXECUTE concedido a `anon` POR NOMBRE. La regla
--     de §6.4 sigue valiendo: cada función nueva lleva su
--     `REVOKE ... FROM PUBLIC, anon`. Medido el 28/10/2026: las otras 22
--     funciones de `public` ya lo cumplen.
--   • `authenticated` y `service_role` no se tocan.
--
-- CÓMO SE CORRE: dos sentencias. La 1 es un solo bloque DO, atómico. La 2 es
-- la verificación de solo lectura y es lo que se ve.
--
-- ESPERADO (sentencia 2): tablas_con_anon = [], defaults_postgres_anon = [],
-- funciones_con_anon = [], y authenticated_matriz con sus cuatro permisos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── SENTENCIA 1 de 2 ──────────────────────────────
DO $mig$
DECLARE
  -- Las 14 tablas con permisos de `anon`, leídas en producción el 28/10/2026.
  v_lista   text[] := ARRAY['audit_log', 'delegaciones', 'execution_logs', 'execution_runs',
                            'integrations', 'matriz_aprobacion', 'organizations', 'profiles',
                            'tareas_aprobacion', 'vigilante_reloj', 'workflow_autorizaciones',
                            'workflow_connections', 'workflow_nodes', 'workflows'];
  v_base    text[];
  v_tabla   text;
BEGIN
  -- GUARDA: la lista y la base coinciden en los dos sentidos.
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_base
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
     AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 'anon'::regrole);
  IF NOT (v_base @> v_lista AND v_lista @> v_base) THEN
    RAISE EXCEPTION 'ABORTA - las tablas con permisos de anon no son las 14 leídas el 28/10/2026: %', v_base;
  END IF;

  -- 1. Tablas.
  FOREACH v_tabla IN ARRAY v_lista LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_tabla);
  END LOOP;

  -- 2. Permisos por defecto de `postgres` en `public`.
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

  -- 3. La única función con EXECUTE para `PUBLIC`/`anon`.
  REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;

  -- GUARDA FINAL: no queda nada de `anon` en `public` (ni EXECUTE vía PUBLIC).
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 'anon'::regrole))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'
                   AND has_function_privilege('anon', p.oid, 'EXECUTE'))
     OR EXISTS (SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace,
                       aclexplode(d.defaclacl) a
                 WHERE n.nspname = 'public' AND d.defaclrole = 'postgres'::regrole
                   AND a.grantee = 'anon'::regrole) THEN
    RAISE EXCEPTION 'ABORTADA - a anon le queda algún permiso en public';
  END IF;
END
$mig$;

-- ─────────────────────────── SENTENCIA 2 de 2 ──────────────────────────────
-- Verificación de solo lectura. Mide el estado FINAL.
SELECT jsonb_build_object(
  'tablas_con_anon', (SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname), '[]')
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 'anon'::regrole)),
  'defaults_postgres_anon', (SELECT coalesce(jsonb_agg(d.defaclobjtype::text || ':' || a.privilege_type), '[]')
       FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
      WHERE n.nspname = 'public' AND d.defaclrole = 'postgres'::regrole AND a.grantee = 'anon'::regrole),
  'funciones_con_anon', (SELECT coalesce(jsonb_agg(p.oid::regprocedure::text), '[]')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  'authenticated_matriz', (SELECT jsonb_agg(a.privilege_type ORDER BY a.privilege_type)
       FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'public.matriz_aprobacion'::regclass AND a.grantee = 'authenticated'::regrole
        AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
) AS verificacion;

-- ═══════════════════════════════════════════════════════════════════════════
-- rollback:
--   (Devuelve a `anon` exactamente lo que tenía el 28/10/2026. TRUNCATE no:
--    ya se le quitó en 20261027.)
--
--   GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN
--     ON public.audit_log, public.delegaciones, public.integrations,
--        public.matriz_aprobacion, public.organizations, public.profiles,
--        public.vigilante_reloj, public.workflow_autorizaciones,
--        public.workflow_connections, public.workflow_nodes, public.workflows
--     TO anon;
--   GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN
--     ON public.execution_logs, public.execution_runs, public.tareas_aprobacion
--     TO anon;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT SELECT, UPDATE, USAGE ON SEQUENCES TO anon;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO anon;
--   GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC, anon;
-- ═══════════════════════════════════════════════════════════════════════════
