-- ═══════════════════════════════════════════════════════════════════════════
-- 20261028 — Piloto del segundo factor EN LA BASE: `matriz_aprobacion_aal2`
--
-- APLICADA el 28/10/2026 con el sí de Hermes. Ensayo:
-- database/ensayos/20261028_matriz_aprobacion_aal2_piloto.ensayo.sql →
-- ROJA 5 de 11 || VERDE 11 de 11 antes; APLICADA 11 de 11 después, fuera de
-- la transacción. Verificación: 1 restrictiva en public, la nuestra; las dos
-- permisivas intactas; 0 restrictivas en las tablas del login.
--
-- Paso 4 del blindaje (TAREAS_PENDIENTES), portado de RiskGuard
-- (`20261026d_riesgos_aal2_piloto.sql`). Hasta hoy el segundo factor es una
-- pantalla: la sesión de Supabase existe ANTES de teclear el código, así que
-- quien llame a la API con solo la contraseña lee lo que la RLS le deje.
-- Esta política convierte el `aal2` en la barrera para esta tabla.
--
-- QUÉ HACE. Una política RESTRICTIVA sobre `matriz_aprobacion`, `for all to
-- authenticated`, que exige `public.mfa_satisfecho()` (20261027b). Las
-- restrictivas se combinan con AND sobre las permisivas: `matriz_read_org` y
-- `matriz_admin_write` siguen decidiendo QUÉ filas y QUIÉN escribe; esta decide
-- SI la sesión puede tocar alguna. No se toca ninguna política existente.
--
-- `(select public.mfa_satisfecho())` envuelto: se evalúa una vez por consulta.
--
-- POR QUÉ `matriz_aprobacion` DE PILOTO: tabla de negocio, 2 filas, dos
-- políticas, no se lee durante el login y se ve en pantalla (Gobierno →
-- Matriz). El motor (`execute-workflow`) la lee con la clave de servicio, que
-- se salta la RLS: los flujos no notan nada.
--
-- LO QUE NO CIERRA (dicho para que no se lea de más):
--   • Quien aún no tiene factor verificado pasa: `mfa_satisfecho()` es cierta
--     para él (rama «sin factor», de la que depende el alta). Medido el
--     28/10/2026: 2 de 7 con factor; la pantalla obliga a los otros 5 al alta
--     en su próximo login (`politicas_seguridad.exigir_mfa` = true).
--   • La clave de servicio se salta la RLS: las Edge Functions lo preguntan
--     ellas (`exigirMfa`, en las 6 que actúan por un usuario, 28/10/2026).
--
-- CÓMO SE CORRE: dos sentencias. La 1 es un solo bloque DO, atómico. La 2 es
-- la verificación de solo lectura y es lo que se ve.
--
-- ESPERADO: sentencia 2 → matriz_aprobacion_aal2 RESTRICTIVE, {authenticated},
-- ALL; las dos permisivas intactas; 1 restrictiva en todo public; profiles,
-- organizations y politicas_seguridad sin restrictivas.
-- Después: el ensayo sin el bloque de la migración → «APLICADA 11 de 11», y la
-- prueba en pantalla.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── SENTENCIA 1 de 2 ──────────────────────────────
DO $mig$
DECLARE
  v_n int;
BEGIN
  -- GUARDA 1: la función existe, es DEFINER con search_path vacío; la tabla
  -- tiene RLS; no hay restrictivas todavía en public.
  IF to_regprocedure('public.mfa_satisfecho()') IS NULL
     OR NOT (SELECT p.prosecdef AND coalesce(p.proconfig @> ARRAY['search_path=""'], false)
               FROM pg_proc p WHERE p.oid = to_regprocedure('public.mfa_satisfecho()')) THEN
    RAISE EXCEPTION 'ABORTA - public.mfa_satisfecho() no existe o no es la de 20261027b';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.matriz_aprobacion'::regclass) THEN
    RAISE EXCEPTION 'ABORTA - matriz_aprobacion sin RLS activo';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ABORTA - ya hay % politicas restrictivas en public: mirar antes', v_n;
  END IF;

  CREATE POLICY matriz_aprobacion_aal2 ON public.matriz_aprobacion
    AS RESTRICTIVE FOR ALL TO authenticated
    USING      ( (SELECT public.mfa_satisfecho()) )
    WITH CHECK ( (SELECT public.mfa_satisfecho()) );

  -- GUARDA 2: una sola restrictiva, la nuestra, y las permisivas siguen igual.
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
END
$mig$;

-- ─────────────────────────── SENTENCIA 2 de 2 ──────────────────────────────
-- Verificación de solo lectura. Mide el estado FINAL.
SELECT jsonb_build_object(
  'politicas_matriz', (SELECT jsonb_agg(jsonb_build_object(
                          'nombre', policyname, 'tipo', permissive, 'cmd', cmd,
                          'roles', roles, 'using', qual, 'check', with_check) ORDER BY policyname)
                         FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matriz_aprobacion'),
  'restrictivas_en_public', (SELECT count(*) FROM pg_policies
                              WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'),
  'login_restrictivas', (SELECT count(*) FROM pg_policies
                          WHERE schemaname = 'public'
                            AND tablename IN ('profiles', 'organizations', 'politicas_seguridad')
                            AND permissive = 'RESTRICTIVE')
) AS verificacion;

-- ═══════════════════════════════════════════════════════════════════════════
-- rollback:
--   (Vuelve a dejar el segundo factor solo en pantalla para `matriz_aprobacion`.)
--
--   DROP POLICY IF EXISTS matriz_aprobacion_aal2 ON public.matriz_aprobacion;
-- ═══════════════════════════════════════════════════════════════════════════
