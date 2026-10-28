-- ═══════════════════════════════════════════════════════════════════════════
-- 20261028c — El segundo factor dentro de las tres RPC SECURITY DEFINER
--
-- APLICADA en producción el 28/10/2026. Ensayo:
-- database/ensayos/20261028c_mfa_en_rpc_definer.ensayo.sql
--   antes de aplicar: ROJA 3 de 8 → VERDE 8 de 8 sin fallos
--   después (pasada APLICADA, sin el bloque): APLICADA 8 de 8 sin fallos
--   sentencia 2: las tres con con_mfa, DEFINER, search_path=public, misma
--   ACL (sin anon) y sin_bloque_igual_al_original = true. Sin residuo.
--
-- Cierra el tercer punto de «LO QUE NO CIERRA» de 20261028b. Las restrictivas
-- `_aal2` no alcanzan a una función DEFINER: corre como su dueño y se salta la
-- RLS entera. Tres actúan por un usuario sin preguntar el segundo factor:
--
--   transicionar_flujo(uuid,text,text)   — enviar / autorizar / rechazar
--   generar_secreto_webhook(uuid)        — genera o rota el secreto
--   configurar_webhook_url(uuid,boolean) — permite el secreto en la URL
--
-- Con solo la contraseña de alguien que SÍ tiene factor, hoy se puede publicar
-- un flujo o sacar un secreto de webhook nuevo llamando a la RPC por API.
--
-- QUÉ HACE: inserta en cada una, justo después de «Tu usuario no está activo»,
-- este bloque y nada más:
--
--     IF NOT public.mfa_satisfecho() THEN
--         RAISE EXCEPTION 'Falta el segundo factor o tu sesión caducó. …';
--     END IF;
--
-- Es el mismo texto que dan las Edge Functions (`_shared/salvaguardas.ts`).
-- Va como RAISE normal (P0001), NO como 42501: `mensajeDeRpc` enseña tal cual
-- un P0001, y un 42501 lo traduciría `mensajeDeEscritura` como «tu rol no
-- puede», que sería mentira.
--
-- POR QUÉ NO SE REESCRIBEN A MANO: cada función se lee del catálogo, se le
-- añade el bloque y se vuelve a crear. Dos guardas de identidad:
--   • ANTES: el md5 de su definición tiene que ser el leído el 28/10/2026. Si
--     alguien la cambió desde entonces, ABORTA sin tocar ninguna.
--   • DESPUÉS: quitando el bloque, el md5 vuelve a ser el original. Prueba que
--     no cambió nada más (ni una coma).
-- Además comprueba que siguen siendo DEFINER, con `search_path=public`, y con
-- los mismos permisos que antes (CREATE OR REPLACE los conserva; se mide).
--
-- LO QUE NO CIERRA:
--   • Quien no tiene factor verificado pasa (rama «sin factor» de
--     `mfa_satisfecho()`), igual que en las tablas.
--   • Las demás DEFINER (`guardar_lienzo` es INVOKER y ya la cubre la RLS;
--     `marcar_clave_cambiada` y `mfa_satisfecho` se usan durante el login).
--
-- CÓMO SE CORRE: dos sentencias. La 1 es un solo bloque DO, atómico. La 2 es
-- la verificación de solo lectura y es lo que se ve.
--
-- ESPERADO (sentencia 2): las tres con con_mfa=true, definer=true,
-- config={search_path=public}, acl sin anon, y sin_bloque_igual_al_original=true.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── SENTENCIA 1 de 2 ──────────────────────────────
DO $mig$
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
END
$mig$;

-- ─────────────────────────── SENTENCIA 2 de 2 ──────────────────────────────
-- Verificación de solo lectura. Mide el estado FINAL.
SELECT jsonb_object_agg(x.firma, jsonb_build_object(
  'con_mfa',     position('IF NOT public.mfa_satisfecho() THEN' IN x.d) > 0,
  'definer',     x.prosecdef,
  'config',      x.proconfig,
  'acl',         x.proacl::text,
  'sin_bloque_igual_al_original',
                 md5(regexp_replace(x.d, '\r?\n    -- >>> 20261028c[^<]*    -- <<< 20261028c\r?\n', ''))
                   = CASE x.firma
                       WHEN 'configurar_webhook_url(uuid,boolean)' THEN '50dd458d369ef03bf07225e08ebc0f7b'
                       WHEN 'generar_secreto_webhook(uuid)'        THEN '5992ef6935f80f94bbdaa3dce43340a0'
                       WHEN 'transicionar_flujo(uuid,text,text)'   THEN '901729bbf9657766c9319d0fed976b17'
                     END
)) AS verificacion
FROM (SELECT p.oid::regprocedure::text AS firma, p.prosecdef, p.proconfig, p.proacl,
             pg_get_functiondef(p.oid) AS d
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('transicionar_flujo', 'generar_secreto_webhook', 'configurar_webhook_url')) x;

-- ═══════════════════════════════════════════════════════════════════════════
-- rollback:
--   (Quita el bloque marcado y deja las tres como estaban: mismo md5.)
--
--   DO $r$ DECLARE f text; BEGIN
--     FOREACH f IN ARRAY ARRAY['transicionar_flujo(uuid,text,text)',
--       'generar_secreto_webhook(uuid)', 'configurar_webhook_url(uuid,boolean)'] LOOP
--       EXECUTE regexp_replace(pg_get_functiondef(to_regprocedure('public.' || f)),
--         '\r?\n    -- >>> 20261028c[^<]*    -- <<< 20261028c\r?\n', '');
--     END LOOP;
--   END $r$;
-- ═══════════════════════════════════════════════════════════════════════════
