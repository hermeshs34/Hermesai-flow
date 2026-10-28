-- ENSAYO de 20261028_matriz_aprobacion_aal2_piloto.sql — ANTES de aplicarla.
-- NO deja nada en la base.
--
-- Dos pasadas con las mismas 11 pruebas:
--   ROJA  → sin la migración. Las que cubren el cambio TIENEN que fallar.
--   VERDE → con la migración pegada literal. Solo vale «11 de 11».
-- Esperado: «ROJA 5 de 11 … || VERDE 11 de 11 sin fallos».
-- (En ROJA pasan solo 4, 5, 6, 7 y 10, que no dependen de la política.)
--
-- Re-ensayo tras aplicar: cambiar el ARRAY de pasadas a ARRAY['APLICADA'] →
-- «APLICADA 11 de 11 sin fallos» (el bloque de la migración solo corre en VERDE).
--
-- Termina siempre en ERROR a propósito: el error deshace todo y el veredicto
-- viaja en el mensaje. Crea dentro una organización de prueba, dos admins
-- (A sin factor, B con TOTP verificado), sus sesiones y una regla de la
-- matriz; todo se deshace. No lee ni toca ninguna fila real.
DO $ensayo$
DECLARE
  t_pasada  text;
  t_ok      int;
  t_total   int;
  t_fallos  text;
  t_res     text := '';
  t_n       int;
  t_v       int;
  t_txt     text;
  v_org uuid; v_regla uuid;
  u_a uuid; u_b uuid;
  s_a1 uuid; s_b1 uuid; s_b2 uuid;
  c_a jsonb; c_b_aal1 jsonb; c_b_aal2 jsonb; c_b_viejo jsonb;
  ahora bigint := extract(epoch FROM now())::bigint;
BEGIN
  FOREACH t_pasada IN ARRAY ARRAY['ROJA', 'VERDE'] LOOP
    t_ok := 0; t_total := 0; t_fallos := '';
    BEGIN

      -- ═══ MIGRACIÓN (solo en VERDE) — sentencia 1 de 20261028, literal ═══
      IF t_pasada = 'VERDE' THEN
        IF to_regprocedure('public.mfa_satisfecho()') IS NULL
           OR NOT (SELECT p.prosecdef AND coalesce(p.proconfig @> ARRAY['search_path=""'], false)
                     FROM pg_proc p WHERE p.oid = to_regprocedure('public.mfa_satisfecho()')) THEN
          RAISE EXCEPTION 'ABORTA - public.mfa_satisfecho() no existe o no es la de 20261027b';
        END IF;
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.matriz_aprobacion'::regclass) THEN
          RAISE EXCEPTION 'ABORTA - matriz_aprobacion sin RLS activo';
        END IF;
        SELECT count(*) INTO t_n FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE';
        IF t_n <> 0 THEN
          RAISE EXCEPTION 'ABORTA - ya hay % politicas restrictivas en public: mirar antes', t_n;
        END IF;

        CREATE POLICY matriz_aprobacion_aal2 ON public.matriz_aprobacion
          AS RESTRICTIVE FOR ALL TO authenticated
          USING      ( (SELECT public.mfa_satisfecho()) )
          WITH CHECK ( (SELECT public.mfa_satisfecho()) );

        IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE') <> 1
           OR NOT EXISTS (SELECT 1 FROM pg_policies
                           WHERE schemaname = 'public' AND tablename = 'matriz_aprobacion'
                             AND policyname = 'matriz_aprobacion_aal2'
                             AND permissive = 'RESTRICTIVE' AND cmd = 'ALL' AND roles = ARRAY['authenticated']::name[])
           OR NOT EXISTS (SELECT 1 FROM pg_policies
                           WHERE schemaname = 'public' AND tablename = 'matriz_aprobacion'
                             AND policyname = 'matriz_read_org' AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
                             AND qual = '(organization_id = my_organization_id())')
           OR NOT EXISTS (SELECT 1 FROM pg_policies
                           WHERE schemaname = 'public' AND tablename = 'matriz_aprobacion'
                             AND policyname = 'matriz_admin_write' AND permissive = 'PERMISSIVE' AND cmd = 'ALL'
                             AND qual = '((organization_id = my_organization_id()) AND is_admin())'
                             AND with_check = '((organization_id = my_organization_id()) AND is_admin())') THEN
          RAISE EXCEPTION 'ABORTADA - las politicas de matriz_aprobacion no quedaron como se esperaba';
        END IF;
      END IF;
      -- ═══ FIN MIGRACIÓN ═══

      -- Datos de prueba (sin claims: los inserta postgres, no una sesión)
      PERFORM set_config('request.jwt.claims', '', true);
      v_org := gen_random_uuid(); v_regla := gen_random_uuid();
      u_a := gen_random_uuid(); u_b := gen_random_uuid();
      s_a1 := gen_random_uuid(); s_b1 := gen_random_uuid(); s_b2 := gen_random_uuid();
      INSERT INTO public.organizations (id, name, slug)
      VALUES (v_org, 'ENSAYO 20261028', 'ensayo-' || v_org);
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
      INSERT INTO public.matriz_aprobacion (id, organization_id, nombre, categoria, rol_aprobador, escalamiento_horas)
      VALUES (v_regla, v_org, 'Regla de ensayo', 'ensayo', 'admin', 48);

      c_a       := jsonb_build_object('sub', u_a, 'role', 'authenticated', 'session_id', s_a1, 'aal', 'aal1',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_b_aal1  := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b2, 'aal', 'aal1',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_b_aal2  := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 3600),
                                              jsonb_build_object('method', 'password', 'timestamp', ahora - 3700)));
      c_b_viejo := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 7 * 3600)));

      -- 1. B con factor, solo contraseña (aal1): no ve ninguna regla.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.matriz_aprobacion;
        RESET ROLE;
        IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [1 B aal1 ve ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [1 ' || SQLSTATE || ']';
      END;

      -- 2. B aal1: el UPDATE no toca nada y el dato sigue igual.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.matriz_aprobacion SET escalamiento_horas = 1 WHERE id = v_regla;
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        SELECT escalamiento_horas INTO t_v FROM public.matriz_aprobacion WHERE id = v_regla;
        IF t_n = 0 AND t_v = 48 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [2 B aal1 actualizó ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [2 ' || SQLSTATE || ']';
      END;

      -- 3. B aal1: el INSERT lo rechaza la RLS (42501), no otra cosa.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        INSERT INTO public.matriz_aprobacion (organization_id, nombre, rol_aprobador)
        VALUES (v_org, 'Insertada sin segundo factor', 'admin');
        RESET ROLE;
        t_fallos := t_fallos || ' [3 B aal1 insertó]';
      EXCEPTION
        WHEN insufficient_privilege THEN
          RESET ROLE;
          IF SQLERRM LIKE '%row-level security%' THEN t_ok := t_ok + 1;
          ELSE t_fallos := t_fallos || ' [3 rechazo con otro motivo: ' || SQLERRM || ']'; END IF;
        WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [3 ' || SQLSTATE || ']';
      END;

      -- 4. B aal2 con TOTP de hace 1 h: ve SU regla y ninguna de otra organización.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal2::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) FILTER (WHERE id = v_regla), count(*) FILTER (WHERE organization_id <> v_org)
          INTO t_n, t_v FROM public.matriz_aprobacion;
        RESET ROLE;
        IF t_n = 1 AND t_v = 0 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [4 B aal2 ve la suya ' || t_n || ', ajenas ' || t_v || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [4 ' || SQLSTATE || ']';
      END;

      -- 5. B aal2: el UPDATE pasa y queda escrito.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal2::text, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.matriz_aprobacion SET escalamiento_horas = 24 WHERE id = v_regla;
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        SELECT escalamiento_horas INTO t_v FROM public.matriz_aprobacion WHERE id = v_regla;
        IF t_n = 1 AND t_v = 24 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [5 B aal2 actualizó ' || t_n || ', horas ' || t_v || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [5 ' || SQLSTATE || ']';
      END;

      -- 6. B aal2: el INSERT pasa el WITH CHECK.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal2::text, true);
        SET LOCAL ROLE authenticated;
        INSERT INTO public.matriz_aprobacion (organization_id, nombre, rol_aprobador)
        VALUES (v_org, 'Insertada con segundo factor', 'admin');
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        IF t_n = 1 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [6 B aal2 insertó ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [6 ' || SQLSTATE || ' ' || SQLERRM || ']';
      END;

      -- 7. A SIN factor, solo contraseña: ve la regla de su organización.
      --    Es la rama «sin factor» de mfa_satisfecho(), no un fallo de la política.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_a::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) FILTER (WHERE id = v_regla), count(*) FILTER (WHERE organization_id <> v_org)
          INTO t_n, t_v FROM public.matriz_aprobacion;
        RESET ROLE;
        IF t_n = 1 AND t_v = 0 THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [7 A sin factor ve la suya ' || t_n || ', ajenas ' || t_v || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [7 ' || SQLSTATE || ']';
      END;

      -- 8. B aal2 con el TOTP de hace 7 h: caducado, no ve nada.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_viejo::text, true);
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO t_n FROM public.matriz_aprobacion;
        RESET ROLE;
        IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [8 TOTP de hace 7 h ve ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [8 ' || SQLSTATE || ']';
      END;

      -- 9. Catálogo: matriz_aprobacion_aal2 restrictiva, solo authenticated, para todo.
      t_total := t_total + 1;
      IF EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'matriz_aprobacion'
                    AND policyname = 'matriz_aprobacion_aal2'
                    AND permissive = 'RESTRICTIVE' AND cmd = 'ALL' AND roles = ARRAY['authenticated']::name[]
                    AND qual LIKE '%mfa_satisfecho()%' AND with_check LIKE '%mfa_satisfecho()%') THEN
        t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [9 matriz_aprobacion_aal2 no está o no es la esperada]'; END IF;

      -- 10. Lo que el login lee en aal1 sigue sin restrictivas.
      t_total := t_total + 1;
      SELECT count(*) INTO t_n FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('profiles', 'organizations', 'politicas_seguridad')
         AND permissive = 'RESTRICTIVE';
      IF t_n = 0 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [10 ' || t_n || ' restrictivas en tablas del login]'; END IF;

      -- 11. B aal1: el DELETE no borra nada y la fila sigue ahí. (La última: destructiva.)
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        DELETE FROM public.matriz_aprobacion WHERE id = v_regla;
        GET DIAGNOSTICS t_n = ROW_COUNT;
        RESET ROLE;
        IF t_n = 0 AND EXISTS (SELECT 1 FROM public.matriz_aprobacion WHERE id = v_regla) THEN t_ok := t_ok + 1;
        ELSE t_fallos := t_fallos || ' [11 B aal1 borró ' || t_n || ']'; END IF;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_fallos := t_fallos || ' [11 ' || SQLSTATE || ']';
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
