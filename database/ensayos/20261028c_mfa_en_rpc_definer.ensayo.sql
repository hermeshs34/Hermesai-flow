-- ENSAYO de 20261028c_mfa_en_rpc_definer.sql — ANTES de aplicarla.
-- NO deja nada en la base.
--
-- Dos pasadas con las mismas 8 pruebas:
--   ROJA  → sin la migración. Las que cubren el cambio TIENEN que fallar.
--   VERDE → con la migración pegada literal. Solo vale «8 de 8».
-- Esperado: «ROJA 3 de 8 … || VERDE 8 de 8 sin fallos».
-- (En ROJA pasan solo 5, 6 y 8: lo que NO debe cambiar.)
--
-- Re-ensayo tras aplicar: cambiar el ARRAY de pasadas a ARRAY['APLICADA'] →
-- «APLICADA 8 de 8 sin fallos» (el bloque de la migración solo corre en VERDE).
--
-- Termina siempre en ERROR a propósito: el error deshace todo y el veredicto
-- viaja en el mensaje. Crea dentro una organización de prueba, dos admins
-- (A sin factor, B con TOTP verificado), sus sesiones, un flujo en borrador y
-- su fila de webhook; todo se deshace. Cada llamada que tiene éxito se deshace
-- además en su sub-bloque (`deshacer_prueba`), para que no contamine la
-- siguiente.
DO $ensayo$
DECLARE
  t_pasada  text;
  t_ok      int;
  t_total   int;
  t_fallos  text;
  t_res     text := '';
  t_n       int;
  t_err     text;
  t_txt     text;
  t_txt2    text;
  v_org uuid; v_wf uuid;
  u_a uuid; u_b uuid;
  s_a1 uuid; s_b1 uuid; s_b2 uuid;
  c_a jsonb; c_b_aal1 jsonb; c_b_aal2 jsonb; c_b_viejo jsonb;
  ahora bigint := extract(epoch FROM now())::bigint;
  v_md5 jsonb := '{"configurar_webhook_url(uuid,boolean)": "50dd458d369ef03bf07225e08ebc0f7b",
                   "generar_secreto_webhook(uuid)": "5992ef6935f80f94bbdaa3dce43340a0",
                   "transicionar_flujo(uuid,text,text)": "901729bbf9657766c9319d0fed976b17"}';
BEGIN
  FOREACH t_pasada IN ARRAY ARRAY['ROJA', 'VERDE'] LOOP
    t_ok := 0; t_total := 0; t_fallos := '';
    BEGIN

      -- ═══ MIGRACIÓN (solo en VERDE) — sentencia 1 de 20261028c, literal ═══
      IF t_pasada = 'VERDE' THEN
      DECLARE
        -- md5(pg_get_functiondef) leído en producción el 28/10/2026.
        v_original jsonb := '{"configurar_webhook_url(uuid,boolean)": "50dd458d369ef03bf07225e08ebc0f7b",
                              "generar_secreto_webhook(uuid)": "5992ef6935f80f94bbdaa3dce43340a0",
                              "transicionar_flujo(uuid,text,text)": "901729bbf9657766c9319d0fed976b17"}';
        -- El ancla y el bloque. `\2` es el salto de línea que usa la propia función
        -- (las tres están guardadas con CRLF): el bloque sale con el mismo.
        v_ancla    text := '(RAISE EXCEPTION ''Tu usuario no está activo\.'';(\r?\n)    END IF;\r?\n)';
        v_bloque   text := '\2    -- >>> 20261028c: segundo factor. DEFINER se salta la RLS, incluidas las'
                        || '\2    --     restrictivas `_aal2`: la comprobación tiene que estar escrita aquí.'
                        || '\2    IF NOT public.mfa_satisfecho() THEN'
                        || '\2        RAISE EXCEPTION ''Falta el segundo factor o tu sesión caducó. Cierra sesión y vuelve a entrar.'';'
                        || '\2    END IF;'
                        || '\2    -- <<< 20261028c\2';
        -- Lo que quita el bloque (vuelta atrás y guarda de identidad).
        v_quitar   text := '\r?\n    -- >>> 20261028c[^<]*    -- <<< 20261028c\r?\n';
        v_firma    text;
        v_md5      text;
        v_oid      oid;
        v_def      text;
        v_acl      text;
      BEGIN
        -- GUARDA 1: la función es la de 20261027b.
        IF to_regprocedure('public.mfa_satisfecho()') IS NULL
           OR NOT (SELECT p.prosecdef AND coalesce(p.proconfig @> ARRAY['search_path=""'], false)
                     FROM pg_proc p WHERE p.oid = to_regprocedure('public.mfa_satisfecho()')) THEN
          RAISE EXCEPTION 'ABORTA - public.mfa_satisfecho() no existe o no es la de 20261027b';
        END IF;
      
        -- GUARDA 2: las tres son EXACTAMENTE las leídas, con el ancla una sola vez.
        -- Se comprueban todas antes de tocar ninguna.
        FOR v_firma, v_md5 IN SELECT key, value FROM jsonb_each_text(v_original) LOOP
          v_oid := to_regprocedure('public.' || v_firma);
          IF v_oid IS NULL THEN
            RAISE EXCEPTION 'ABORTA - no existe public.%', v_firma;
          END IF;
          v_def := pg_get_functiondef(v_oid);
          IF md5(v_def) <> v_md5 THEN
            RAISE EXCEPTION 'ABORTA - public.% cambió desde el 28/10/2026 (md5 %): volver a leerla', v_firma, md5(v_def);
          END IF;
          IF regexp_count(v_def, v_ancla) <> 1 OR position('mfa_satisfecho' IN v_def) > 0 THEN
            RAISE EXCEPTION 'ABORTA - public.%: el ancla no está una sola vez o ya pregunta el segundo factor', v_firma;
          END IF;
        END LOOP;
      
        FOR v_firma, v_md5 IN SELECT key, value FROM jsonb_each_text(v_original) LOOP
          v_oid := to_regprocedure('public.' || v_firma);
          SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_oid;
      
          EXECUTE regexp_replace(pg_get_functiondef(v_oid), v_ancla, '\1' || v_bloque);
      
          -- GUARDA 3: quedó lo que se esperaba, ni una coma más.
          v_def := pg_get_functiondef(v_oid);
          IF position('IF NOT public.mfa_satisfecho() THEN' IN v_def) = 0 THEN
            RAISE EXCEPTION 'ABORTADA - public.% no quedó con el segundo factor', v_firma;
          END IF;
          IF md5(regexp_replace(v_def, v_quitar, '')) <> v_md5 THEN
            RAISE EXCEPTION 'ABORTADA - public.% cambió en algo más que el bloque', v_firma;
          END IF;
          IF NOT (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public']
                         AND p.proacl::text = v_acl
                    FROM pg_proc p WHERE p.oid = v_oid) THEN
            RAISE EXCEPTION 'ABORTADA - public.% perdió DEFINER, su search_path o sus permisos', v_firma;
          END IF;
        END LOOP;
      END;
      END IF;
      -- ═══ FIN MIGRACIÓN ═══

      -- Datos de prueba (sin claims: los inserta postgres, no una sesión)
      PERFORM set_config('request.jwt.claims', '', true);
      v_org := gen_random_uuid(); v_wf := gen_random_uuid();
      u_a := gen_random_uuid(); u_b := gen_random_uuid();
      s_a1 := gen_random_uuid(); s_b1 := gen_random_uuid(); s_b2 := gen_random_uuid();
      INSERT INTO public.organizations (id, name, slug)
      VALUES (v_org, 'ENSAYO 20261028c', 'ensayo-' || v_org);
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
      INSERT INTO public.workflows (id, organization_id, name, estado_definicion)
      VALUES (v_wf, v_org, 'Flujo de ensayo', 'borrador');
      INSERT INTO public.workflow_webhooks (workflow_id, organization_id, secreto_hash)
      VALUES (v_wf, v_org, encode(sha256('hash-de-ensayo'::bytea), 'hex'));

      c_a       := jsonb_build_object('sub', u_a, 'role', 'authenticated', 'session_id', s_a1, 'aal', 'aal1',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_b_aal1  := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b2, 'aal', 'aal1',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ahora)));
      c_b_aal2  := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 3600),
                                              jsonb_build_object('method', 'password', 'timestamp', ahora - 3700)));
      c_b_viejo := jsonb_build_object('sub', u_b, 'role', 'authenticated', 'session_id', s_b1, 'aal', 'aal2',
                     'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', ahora - 7 * 3600)));

      -- 1. B con factor, solo contraseña: no envía el flujo a revisión.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        PERFORM public.transicionar_flujo(v_wf, 'enviar');
        RESET ROLE;
        RAISE EXCEPTION 'deshacer_prueba';
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err LIKE 'Falta el segundo factor%' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [1 B aal1 transicionar_flujo: ' || t_err || ']'; END IF;

      -- 2. B aal1: no genera ni rota el secreto del webhook.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        PERFORM public.generar_secreto_webhook(v_wf);
        RESET ROLE;
        RAISE EXCEPTION 'deshacer_prueba';
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err LIKE 'Falta el segundo factor%' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [2 B aal1 generar_secreto_webhook: ' || t_err || ']'; END IF;

      -- 3. B aal1: no permite el secreto en la URL.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal1::text, true);
        SET LOCAL ROLE authenticated;
        PERFORM public.configurar_webhook_url(v_wf, true);
        RESET ROLE;
        RAISE EXCEPTION 'deshacer_prueba';
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err LIKE 'Falta el segundo factor%' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [3 B aal1 configurar_webhook_url: ' || t_err || ']'; END IF;

      -- 4. B con el TOTP de hace 7 h (caducado): tampoco genera el secreto.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_viejo::text, true);
        SET LOCAL ROLE authenticated;
        PERFORM public.generar_secreto_webhook(v_wf);
        RESET ROLE;
        RAISE EXCEPTION 'deshacer_prueba';
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err LIKE 'Falta el segundo factor%' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [4 TOTP de hace 7 h: ' || t_err || ']'; END IF;

      -- 5. B aal2 con TOTP de hace 1 h: las tres funcionan y dejan su efecto.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_b_aal2::text, true);
        SET LOCAL ROLE authenticated;
        PERFORM public.transicionar_flujo(v_wf, 'enviar');
        t_txt := public.generar_secreto_webhook(v_wf);
        PERFORM public.configurar_webhook_url(v_wf, true);
        RESET ROLE;
        SELECT w.estado_definicion INTO t_txt2 FROM public.workflows w WHERE w.id = v_wf;
        SELECT count(*) INTO t_n FROM public.workflow_webhooks h
         WHERE h.workflow_id = v_wf AND h.permite_secreto_url
           AND h.secreto_hash = encode(sha256(convert_to(t_txt, 'UTF8')), 'hex');
        IF t_txt LIKE 'hfw\_%' AND t_txt2 = 'en_revision' AND t_n = 1 THEN
          RAISE EXCEPTION 'deshacer_prueba';
        END IF;
        RAISE EXCEPTION 'efecto inesperado: estado %, webhook %', t_txt2, t_n;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err = 'deshacer_prueba' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [5 B aal2: ' || t_err || ']'; END IF;

      -- 6. A SIN factor, solo contraseña: genera el secreto y envía el flujo.
      --    Es la rama «sin factor» de mfa_satisfecho(), de la que depende el alta.
      t_total := t_total + 1;
      BEGIN
        PERFORM set_config('request.jwt.claims', c_a::text, true);
        SET LOCAL ROLE authenticated;
        t_txt := public.generar_secreto_webhook(v_wf);
        PERFORM public.transicionar_flujo(v_wf, 'enviar');
        RESET ROLE;
        RAISE EXCEPTION 'deshacer_prueba';
      EXCEPTION WHEN OTHERS THEN RESET ROLE; t_err := SQLERRM;
      END;
      IF t_err = 'deshacer_prueba' THEN t_ok := t_ok + 1;
      ELSE t_fallos := t_fallos || ' [6 A sin factor: ' || t_err || ']'; END IF;

      -- 7. Catálogo: las tres preguntan el segundo factor, siguen DEFINER con
      --    search_path=public, anon sin EXECUTE y authenticated con él.
      t_total := t_total + 1;
      SELECT count(*) INTO t_n
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('transicionar_flujo', 'generar_secreto_webhook', 'configurar_webhook_url')
         AND position('IF NOT public.mfa_satisfecho() THEN' IN pg_get_functiondef(p.oid)) > 0
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']
         AND p.proacl::text NOT LIKE '%anon=%' AND p.proacl::text LIKE '%authenticated=X/%';
      IF t_n = 3 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [7 catálogo: ' || t_n || ' de 3]'; END IF;

      -- 8. Identidad: quitando el bloque marcado, las tres son las del 28/10/2026
      --    byte a byte (no cambió nada más).
      t_total := t_total + 1;
      SELECT count(*) INTO t_n
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('transicionar_flujo', 'generar_secreto_webhook', 'configurar_webhook_url')
         AND md5(regexp_replace(pg_get_functiondef(p.oid),
                                '\r?\n    -- >>> 20261028c[^<]*    -- <<< 20261028c\r?\n', ''))
             = v_md5 ->> (p.oid::regprocedure::text);
      IF t_n = 3 THEN t_ok := t_ok + 1; ELSE t_fallos := t_fallos || ' [8 identidad: ' || t_n || ' de 3]'; END IF;

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
