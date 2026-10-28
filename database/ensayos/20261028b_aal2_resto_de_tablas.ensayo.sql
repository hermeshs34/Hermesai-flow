-- ENSAYO de 20261028b_aal2_resto_de_tablas.sql — ANTES de aplicarla.
-- NO deja nada en la base.
--
-- Dos pasadas con las mismas 14 pruebas:
--   ROJA  → sin la migración. Las que cubren el cambio TIENEN que fallar.
--   VERDE → con la migración pegada literal. Solo vale «14 de 14».
-- Esperado: «ROJA 5 de 14 … || VERDE 14 de 14 sin fallos».
-- (En ROJA pasan solo 7, 8, 9, 10 y 13: lo que NO debe cambiar.)
--
-- Re-ensayo tras aplicar: cambiar el ARRAY de pasadas a ARRAY['APLICADA'] →
-- «APLICADA 14 de 14 sin fallos» (el bloque de la migración solo corre en VERDE).
--
-- Termina siempre en ERROR a propósito: el error deshace todo y el veredicto
-- viaja en el mensaje. Crea dentro una organización de prueba, dos admins
-- (A sin factor, B con TOTP verificado), sus sesiones, un flujo y una fila de
-- auditoría; todo se deshace. Solo LEE una fila real: la única de
-- `vigilante_reloj` (global), y no la toca.
DO $ensayo$
DECLARE
  t_pasada  text;
  t_ok      int;
  t_total   int;
  t_fallos  text;
  t_res     text := '';
  t_n       int;
  t_v       int;
  t_w       int;
  t_x       int;
  t_n2      int;
  t_txt     text;
  v_org uuid; v_wf uuid;
  u_a uuid; u_b uuid;
  s_a1 uuid; s_b1 uuid; s_b2 uuid;
  c_a jsonb; c_b_aal1 jsonb; c_b_aal2 jsonb; c_b_viejo jsonb;
  ahora bigint := extract(epoch FROM now())::bigint;
  v_lista text[] := ARRAY['delegaciones', 'execution_logs', 'execution_runs', 'integrations',
                          'organizations', 'tareas_aprobacion', 'vigilante_reloj',
                          'webhook_recepciones', 'workflow_autorizaciones',
                          'workflow_connections', 'workflow_nodes', 'workflow_webhooks',
                          'workflows'];
BEGIN
  FOREACH t_pasada IN ARRAY ARRAY['ROJA', 'VERDE'] LOOP
    t_ok := 0; t_total := 0; t_fallos := '';
    BEGIN

      -- ═══ MIGRACIÓN (solo en VERDE) — sentencia 1 de 20261028b, literal ═══
      IF t_pasada = 'VERDE' THEN
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
      END;
      END IF;
      -- ═══ FIN MIGRACIÓN ═══

      -- Datos de prueba (sin claims: los inserta postgres, no una sesión)
      PERFORM set_config('request.jwt.claims', '', true);
      v_org := gen_random_uuid(); v_wf := gen_random_uuid();
      u_a := gen_random_uuid(); u_b := gen_random_uuid();
      s_a1 := gen_random_uuid(); s_b1 := gen_random_uuid(); s_b2 := gen_random_uuid();
      INSERT INTO public.organizations (id, name, slug)
      VALUES (v_org, 'ENSAYO 20261028b', 'ensayo-' || v_org);
      INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
      VALUES (u_a, 'ensayo-a-' || u_a || '@ensayo.invalid', 'authenticated', 'authenticated', now(), now()),
             (u_b, 'ensayo-b-' || u_b || '@ensayo.invalid', 'authenticated', 'authenticated', now(), now());
      INSERT INTO public.profiles (id, organization_id, email, name, role, is_active)
      VALUES (u_a, v_org, 'ensayo-a-' || u_a || '@ensayo.invalid', 'Ensayo A', 'admin', true),
             (u_b, v_org, 'ensayo-b-' || u_b || '@ensayo.invalid', 'Ensayo B', 'admin', true);
      INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
      VALUES (s_a1, u_a, now(), now(), 'aal1'),
             (s_b1, u_b, now(), now(), 'aal2'),
             (s_b2, u_b, now(), now(), 'aal1');
      INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
      VALUES (gen_random_uuid(), u_b, 'ensayo', 'totp', 'verified', now(), now());
      INSERT INTO public.workflows (id, organization_id, name)
      VALUES (v_wf, v_org, 'Flujo de ensayo');
      INSERT INTO public.audit_log (organization_id, accion, entidad, descripcion)
      VALUES (v_org, 'login', 'sesion', 'Traza de ensayo');

      c_a       := jsonb_build_object('sub', u_a, 'role', 'authenticated', 'session_id', s_a1, 'aal', 'aal1',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_b_aal1  := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b2, 'aal', 'aal1',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_b_aal2  := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 3600),
                                              jsonb_build_object('method', 'password', 'timestamp', ahora - 3700)));
      c_b_viejo := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 7 * 3600)));

      -- 1. B con factor, solo contraseña (aal1): no ve su flujo.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.workflows;
        RESET ROLE;
        IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [1 B aal1 ve ' || t_n || ' flujos]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [1 ' || SQLSTATE || ']';
      END;

      -- 2. B aal1: el UPDATE del flujo no toca nada y el nombre sigue igual.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.workflows SET name = 'Renombrado sin segundo factor' WHERE id = v_wf;
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        SELECT name INTO t_txt FROM public.workflows WHERE id = v_wf;
        IF t_n = 0 AND t_txt = 'Flujo de ensayo' THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [2 B aal1 actualizó ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [2 ' || SQLSTATE || ']';
      END;

      -- 3. B aal1: crear un nodo lo rechaza la RLS (42501), no otra cosa.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        INSERT INTO public.workflow_nodes (workflow_id, organization_id, type, category, title)
        VALUES (v_wf, v_org, 'trigger', 'manual', 'Nodo sin segundo factor');
        RESET ROLE;
        t_fallos := t_fallos || ' [3 B aal1 creó un nodo]';
      EXCEPTION
        WHEN insufficient_privilege THEN
          RESET ROLE;
          IF SQLERRM LIKE '%row-level security%' THEN t_ok := t_ok + 1;
          ELSE t_fallos := t_fallos || ' [3 rechazo con otro motivo: ' || SQLERRM || ']'; END IF;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [3 ' || SQLSTATE || ' ' || SQLERRM || ']';
      END;

      -- 4. B aal1: no ve su organización.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.organizations;
        RESET ROLE;
        IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [4 B aal1 ve ' || t_n || ' organizaciones]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [4 ' || SQLSTATE || ']';
      END;

      -- 5. B aal1: no ve el estado del reloj (tabla global, `using true`).
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.vigilante_reloj;
        RESET ROLE;
        IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [5 B aal1 ve el reloj]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [5 ' || SQLSTATE || ']';
      END;

      -- 6. B aal1: no LEE la auditoría.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.audit_log;
        RESET ROLE;
        IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [6 B aal1 lee ' || t_n || ' trazas]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [6 ' || SQLSTATE || ']';
      END;

      -- 7. B aal1: SÍ escribe la traza del login (App.tsx la manda antes del código).
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        INSERT INTO public.audit_log (organization_id, usuario_id, accion, entidad, descripcion)
        VALUES (v_org, u_b, 'login', 'sesion', 'Inicio de sesión de ensayo');
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        IF t_n = 1 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [7 traza de login ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [7 traza de login rechazada: ' || SQLSTATE || ' ' || SQLERRM || ']';
      END;

      -- 8. B aal1: SÍ lee su perfil y la política de seguridad (los lee el login).
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.profiles WHERE id = u_b;
        SELECT count(*) INTO t_v FROM public.politicas_seguridad;
        RESET ROLE;
        IF t_n = 1 AND t_v = 1 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [8 login: perfil ' || t_n || ', política ' || t_v || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [8 ' || SQLSTATE || ']';
      END;

      -- 9. B aal2 con TOTP de hace 1 h: ve flujo, organización, reloj y
      --    auditoría, y renombra el flujo.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal2::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.workflows WHERE id = v_wf;
        SELECT count(*) INTO t_v FROM public.organizations WHERE id = v_org;
        SELECT count(*) INTO t_w FROM public.vigilante_reloj;
        SELECT count(*) INTO t_x FROM public.audit_log WHERE organization_id = v_org;
        UPDATE public.workflows SET name = 'Renombrado con segundo factor' WHERE id = v_wf;
        GET DIAGNOSTICS t_n2 = ROW_COUNT;
        RESET ROLE;
        IF t_n = 1 AND t_v = 1 AND t_w = 1 AND t_x >= 1 AND t_n2 = 1 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [9 B aal2: flujo ' || t_n || ', org ' || t_v || ', reloj ' || t_w
                         || ', trazas ' || t_x || ', renombró ' || t_n2 || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [9 ' || SQLSTATE || ' ' || SQLERRM || ']';
      END;

      -- 10. A SIN factor, solo contraseña: ve su flujo y la auditoría.
      --     Es la rama «sin factor» de mfa_satisfecho(), no un fallo de la política.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_a::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.workflows WHERE id = v_wf;
        SELECT count(*) INTO t_v FROM public.audit_log WHERE organization_id = v_org;
        RESET ROLE;
        IF t_n = 1 AND t_v >= 1 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [10 A sin factor: flujo ' || t_n || ', trazas ' || t_v || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [10 ' || SQLSTATE || ']';
      END;

      -- 11. B aal2 con el TOTP de hace 7 h: caducado, no ve su flujo.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_viejo::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.workflows;
        RESET ROLE;
        IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [11 TOTP de hace 7 h ve ' || t_n || ' flujos]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [11 ' || SQLSTATE || ']';
      END;

      -- 12. Catálogo: las 13 `_aal2` restrictivas FOR ALL + la de lectura de
      --     audit_log + la del piloto = 15 en public.
      t_total := t_total + 1;
      SELECT count(*) INTO t_n FROM pg_policies
       WHERE schemaname = 'public' AND tablename = ANY (v_lista)
         AND policyname = tablename || '_aal2' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL'
         AND roles = ARRAY['authenticated']::name[]
         AND qual LIKE '%mfa_satisfecho()%' AND with_check LIKE '%mfa_satisfecho()%';
      SELECT count(*) INTO t_v FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE';
      IF t_n = 13 AND t_v = 15
         AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log'
                      AND policyname = 'audit_log_aal2_lectura' AND permissive = 'RESTRICTIVE'
                      AND cmd = 'SELECT' AND qual LIKE '%mfa_satisfecho()%') THEN
        t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [12 catálogo: ' || t_n || ' de 13 _aal2, ' || t_v || ' restrictivas]'; END IF;

      -- 13. Lo que el login usa en aal1: profiles y politicas_seguridad sin
      --     restrictivas; audit_log sin ninguna que cubra INSERT.
      t_total := t_total + 1;
      SELECT count(*) INTO t_n FROM pg_policies
       WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
         AND (tablename IN ('profiles', 'politicas_seguridad')
              OR (tablename = 'audit_log' AND cmd IN ('ALL', 'INSERT')));
      IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [13 ' || t_n || ' restrictivas tocan el login]'; END IF;

      -- 14. B aal1: el DELETE del flujo no borra nada y sigue ahí. (La última: destructiva.)
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        DELETE FROM public.workflows WHERE id = v_wf;
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        IF t_n = 0 AND EXISTS (SELECT 1 FROM public.workflows WHERE id = v_wf) THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [14 B aal1 borró ' || t_n || ' flujos]'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [14 ' || SQLSTATE || ']';
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
