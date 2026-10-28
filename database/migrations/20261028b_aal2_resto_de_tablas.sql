-- ═══════════════════════════════════════════════════════════════════════════
-- 20261028b — El segundo factor en la base para el RESTO de tablas
--
-- APLICADA el 28/10/2026 con el sí de Hermes. Ensayo:
-- database/ensayos/20261028b_aal2_resto_de_tablas.ensayo.sql →
-- ROJA 5 de 14 || VERDE 14 de 14 antes; APLICADA 14 de 14 después, fuera de
-- la transacción. Verificación: 15 restrictivas en public; sin restrictiva
-- solo profiles y politicas_seguridad; audit_log solo con la de SELECT.
--
-- Sigue al piloto `20261028_matriz_aprobacion_aal2_piloto.sql` (aplicado y
-- probado por Hermes en Gobierno → Matriz el 28/10/2026). Misma política, misma
-- función (`public.mfa_satisfecho()`, 20261027b), ahora en las tablas de
-- negocio. Las restrictivas se combinan con AND: las permisivas de cada tabla
-- siguen decidiendo QUÉ filas y QUIÉN escribe; estas deciden SI la sesión puede
-- tocar alguna. No se toca ninguna política existente.
--
-- LISTA EXPLÍCITA, comprobada en los dos sentidos contra la base: si aparece
-- una tabla nueva en `public` o falta una de aquí, ABORTA sin crear nada.
--
--   Con `<tabla>_aal2` (FOR ALL, 13): delegaciones, execution_logs,
--     execution_runs, integrations, organizations, tareas_aprobacion,
--     vigilante_reloj, webhook_recepciones, workflow_autorizaciones,
--     workflow_connections, workflow_nodes, workflow_webhooks, workflows.
--   Ya la tiene (piloto): matriz_aprobacion.
--   Solo LECTURA (`audit_log_aal2_lectura`, FOR SELECT): audit_log.
--     `App.tsx` (`handleLogin`) escribe la traza `login` ANTES de pedir el
--     código, en aal1: el INSERT tiene que seguir abierto. Leer la auditoría
--     sí exige el segundo factor.
--   SIN restrictiva, a propósito (las lee el login en aal1):
--     profiles            — `authService.login` / `syncSession` leen el perfil.
--     politicas_seguridad — `mfa.ts` pregunta `exigir_mfa` para decidir si
--                           obliga al alta del factor.
--   `organizations` SÍ la lleva: comprobado en `src/` que solo la leen
--   Dashboard y Settings, que no se pintan hasta `estadoMfa === 'ok'`.
--
-- LO QUE NO CIERRA (dicho para que no se lea de más):
--   • Quien aún no tiene factor verificado pasa (rama «sin factor» de
--     `mfa_satisfecho()`, de la que depende el alta).
--   • La clave de servicio se salta la RLS: las Edge Functions lo preguntan
--     ellas (`exigirMfa`, 28/10/2026).
--   • Las RPC `SECURITY DEFINER` también se la saltan. Tres actúan por un
--     usuario sin preguntar el segundo factor: `transicionar_flujo`,
--     `generar_secreto_webhook` y `configurar_webhook_url`. Otra migración.
--
-- CÓMO SE CORRE: dos sentencias. La 1 es un solo bloque DO, atómico. La 2 es
-- la verificación de solo lectura y es lo que se ve.
--
-- ESPERADO (sentencia 2): restrictivas_en_public = 15; cada tabla de la lista
-- con la suya; profiles y politicas_seguridad con 0; audit_log solo con la de
-- SELECT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── SENTENCIA 1 de 2 ──────────────────────────────
DO $mig$
DECLARE
  v_lista    text[] := ARRAY['delegaciones', 'execution_logs', 'execution_runs', 'integrations',
                             'organizations', 'tareas_aprobacion', 'vigilante_reloj',
                             'webhook_recepciones', 'workflow_autorizaciones',
                             'workflow_connections', 'workflow_nodes', 'workflow_webhooks',
                             'workflows'];
  v_resto    text[] := ARRAY['matriz_aprobacion', 'audit_log', 'profiles', 'politicas_seguridad'];
  v_esperado text[];
  v_en_base  text[];
  v_t        text;
  v_n        int;
BEGIN
  -- GUARDA 1: la función es la de 20261027b.
  IF to_regprocedure('public.mfa_satisfecho()') IS NULL
     OR NOT (SELECT p.prosecdef AND coalesce(p.proconfig @> ARRAY['search_path=""'], false)
               FROM pg_proc p WHERE p.oid = to_regprocedure('public.mfa_satisfecho()')) THEN
    RAISE EXCEPTION 'ABORTA - public.mfa_satisfecho() no existe o no es la de 20261027b';
  END IF;

  -- GUARDA 2: la lista casa con la base EN LOS DOS SENTIDOS.
  SELECT array_agg(x ORDER BY x) INTO v_esperado FROM unnest(v_lista || v_resto) x;
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO v_en_base
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
  IF v_en_base IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'ABORTA - las tablas de public no son las de la lista. Sobran: %. Faltan: %',
      (SELECT array_agg(x) FROM unnest(v_en_base) x WHERE x <> ALL (v_esperado)),
      (SELECT array_agg(x) FROM unnest(v_esperado) x WHERE x <> ALL (v_en_base));
  END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ABORTA - % tablas de public sin RLS activo', v_n;
  END IF;

  -- GUARDA 3: la única restrictiva que hay es la del piloto.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                     AND tablename = 'matriz_aprobacion' AND policyname = 'matriz_aprobacion_aal2'
                     AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'ABORTA - las restrictivas de public no son solo la del piloto: mirar antes';
  END IF;

  FOREACH v_t IN ARRAY v_lista LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING ( (SELECT public.mfa_satisfecho()) ) WITH CHECK ( (SELECT public.mfa_satisfecho()) )',
      v_t || '_aal2', v_t);
  END LOOP;

  CREATE POLICY audit_log_aal2_lectura ON public.audit_log
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING ( (SELECT public.mfa_satisfecho()) );

  -- GUARDA 4: quedó lo que se esperaba, ni una más.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE') <> 15 THEN
    RAISE EXCEPTION 'ABORTADA - no hay 15 restrictivas en public';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = ANY (v_lista)
     AND policyname = tablename || '_aal2' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL'
     AND roles = ARRAY['authenticated']::name[]
     AND qual LIKE '%mfa_satisfecho()%' AND with_check LIKE '%mfa_satisfecho()%';
  IF v_n <> 13 THEN
    RAISE EXCEPTION 'ABORTADA - solo % de 13 tablas con su _aal2 correcta', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
              AND tablename IN ('profiles', 'politicas_seguridad'))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log'
          AND permissive = 'RESTRICTIVE') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log'
                     AND policyname = 'audit_log_aal2_lectura' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'ABORTADA - el login quedaría tocado (profiles, politicas_seguridad o audit_log)';
  END IF;
END
$mig$;

-- ─────────────────────────── SENTENCIA 2 de 2 ──────────────────────────────
-- Verificación de solo lectura. Mide el estado FINAL.
SELECT jsonb_build_object(
  'restrictivas_en_public', (SELECT count(*) FROM pg_policies
                              WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'),
  'restrictivas', (SELECT jsonb_object_agg(tablename, policyname || ' ' || cmd)
                     FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'),
  'tablas_sin_restrictiva', (SELECT jsonb_agg(c.relname ORDER BY c.relname)
                               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                                AND NOT EXISTS (SELECT 1 FROM pg_policies p
                                                 WHERE p.schemaname = 'public' AND p.tablename = c.relname
                                                   AND p.permissive = 'RESTRICTIVE'))
) AS verificacion;

-- ═══════════════════════════════════════════════════════════════════════════
-- rollback:
--   (Deja el segundo factor solo en la matriz, como tras el piloto.)
--
--   DO $r$ DECLARE t text; BEGIN
--     FOREACH t IN ARRAY ARRAY['delegaciones','execution_logs','execution_runs','integrations',
--       'organizations','tareas_aprobacion','vigilante_reloj','webhook_recepciones',
--       'workflow_autorizaciones','workflow_connections','workflow_nodes',
--       'workflow_webhooks','workflows'] LOOP
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_aal2', t);
--     END LOOP;
--     DROP POLICY IF EXISTS audit_log_aal2_lectura ON public.audit_log;
--   END $r$;
-- ═══════════════════════════════════════════════════════════════════════════
