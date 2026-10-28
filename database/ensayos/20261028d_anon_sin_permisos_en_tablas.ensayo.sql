-- ENSAYO de 20261028d_anon_sin_permisos_en_tablas.sql — ANTES de aplicarla.
-- NO deja nada en la base.
--
-- Dos pasadas con las mismas 9 pruebas:
--   ROJA  → sin la migración. Las que cubren el cambio TIENEN que fallar.
--   VERDE → con la migración pegada literal. Solo vale «9 de 9».
-- Esperado: «ROJA 3 de 9 … || VERDE 9 de 9 sin fallos».
-- (En ROJA pasan solo 7, 8 y 9: lo que NO debe cambiar.)
--
-- Re-ensayo tras aplicar: cambiar el ARRAY de pasadas a ARRAY['APLICADA'] →
-- «APLICADA 9 de 9 sin fallos» (el bloque de la migración solo corre en VERDE).
--
-- Termina siempre en ERROR a propósito: el error deshace todo y el veredicto
-- viaja en el mensaje. Las pruebas 1–3 distinguen el rechazo por PERMISO
-- («permission denied for table») del rechazo por RLS («row-level security»)
-- o del vacío sin error: los dos últimos son lo que pasa hoy.
DO $ensayo$
DECLARE
  t_pasada  text;
  t_ok      int;
  t_total   int;
  t_fallos  text;
  t_res     text := '';
  t_n       int;
  t_err     text;
  v_tablas  text[] := ARRAY['audit_log', 'delegaciones', 'execution_logs', 'execution_runs',
                            'integrations', 'matriz_aprobacion', 'organizations', 'profiles',
                            'tareas_aprobacion', 'vigilante_reloj', 'workflow_autorizaciones',
                            'workflow_connections', 'workflow_nodes', 'workflows'];
  c_auth    jsonb := jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'aal', 'aal1');
BEGIN
  FOREACH t_pasada IN ARRAY ARRAY['ROJA', 'VERDE'] LOOP
    t_ok := 0; t_total := 0; t_fallos := '';
    BEGIN

      -- ═══ MIGRACIÓN (solo en VERDE) — sentencia 1 de 20261028d, literal ═══
      IF t_pasada = 'VERDE' THEN
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
      END;
      END IF;
      -- ═══ FIN MIGRACIÓN ═══

      -- 1. anon no puede ni leer matriz_aprobacion (hoy: vacío sin error).
      t_total := t_total + 1; t_err := 'sin error';
      BEGIN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        SET LOCAL ROLE anon;
        PERFORM count(*) FROM public.matriz_aprobacion;
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err LIKE 'permission denied for table matriz_aprobacion%' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [1 anon SELECT matriz: ' || t_err || ']'; END IF;

      -- 2. anon no puede insertar en workflows (hoy: lo para la RLS).
      t_total := t_total + 1; t_err := 'sin error';
      BEGIN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        SET LOCAL ROLE anon;
        INSERT INTO public.workflows (organization_id, name) VALUES (gen_random_uuid(), 'ensayo anon');
        RESET ROLE;
        RAISE EXCEPTION 'deshacer_prueba: insertó';
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err LIKE 'permission denied for table workflows%' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [2 anon INSERT workflows: ' || t_err || ']'; END IF;

      -- 3. anon no puede actualizar profiles (hoy: 0 filas sin error).
      t_total := t_total + 1; t_err := 'sin error';
      BEGIN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        SET LOCAL ROLE anon;
        UPDATE public.profiles SET name = name WHERE false;
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err LIKE 'permission denied for table profiles%' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [3 anon UPDATE profiles: ' || t_err || ']'; END IF;

      -- 4. Una tabla NUEVA creada como postgres nace sin anon.
      t_total := t_total + 1;
      CREATE TABLE public.ensayo_20261028d (x int);
      IF NOT EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class
                       WHERE oid = 'public.ensayo_20261028d'::regclass)) a
                      WHERE a.grantee = 'anon'::regrole) THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [4 tabla nueva con anon, dueño ' ||
             (SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.ensayo_20261028d'::regclass) || ']'; END IF;

      -- 5. Una función NUEVA creada como postgres nace sin EXECUTE POR NOMBRE
      --    para anon. (Por PUBLIC sí: defecto global de Postgres, fuera de esta
      --    migración — ver «LO QUE NO CIERRA».)
      t_total := t_total + 1;
      CREATE FUNCTION public.ensayo_20261028d_f() RETURNS int LANGUAGE sql AS 'SELECT 1';
      IF NOT EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc
                       WHERE oid = 'public.ensayo_20261028d_f()'::regprocedure)) a
                      WHERE a.grantee = 'anon'::regrole) THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [5 función nueva con EXECUTE para anon por nombre]'; END IF;
      DROP FUNCTION public.ensayo_20261028d_f();

      -- 6. Catálogo: ninguna tabla con anon y ninguna función que anon pueda
      --    ejecutar (ni por nombre ni vía PUBLIC).
      t_total := t_total + 1;
      SELECT count(*) INTO t_n FROM (
        SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 'anon'::regrole)
        UNION ALL
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND has_function_privilege('anon', p.oid, 'EXECUTE')) x;
      IF t_n = 0 THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [6 objetos con anon: ' || t_n || ']'; END IF;

      -- 7. authenticated sigue leyendo (la RLS decide; sin error de permiso).
      t_total := t_total + 1; t_err := 'ok';
      BEGIN
        PERFORM set_config('request.jwt.claims', c_auth::text, true);
        SET LOCAL ROLE authenticated;
        PERFORM count(*) FROM public.workflows;
        PERFORM count(*) FROM public.matriz_aprobacion;
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err = 'ok' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [7 authenticated SELECT: ' || t_err || ']'; END IF;

      -- 8. authenticated conserva SELECT en las 14 tablas.
      t_total := t_total + 1;
      SELECT count(*) INTO t_n FROM unnest(v_tablas) t
       WHERE has_table_privilege('authenticated', 'public.' || t, 'SELECT');
      IF t_n = 14 THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [8 authenticated con SELECT: ' || t_n || ' de 14]'; END IF;

      -- 9. service_role conserva SELECT/INSERT/UPDATE/DELETE en las 14.
      t_total := t_total + 1;
      SELECT count(*) INTO t_n FROM unnest(v_tablas) t
       WHERE has_table_privilege('service_role', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE');
      IF t_n = 14 THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [9 service_role completo: ' || t_n || ' de 14]'; END IF;

      RAISE EXCEPTION 'deshacer_pasada';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'deshacer_pasada' THEN
        t_fallos := t_fallos || ' [ERROR INESPERADO: ' || SQLERRM || ']';
      END IF;
    END;
    t_res := t_res || t_pasada || ' ' || t_ok || ' de ' || t_total
             || CASE WHEN t_fallos = '' THEN ' sin fallos' ELSE ' FALLOS:' || t_fallos END || '  ||  ';
  END LOOP;
  RAISE EXCEPTION 'ENSAYO: %', t_res;
END
$ensayo$;
