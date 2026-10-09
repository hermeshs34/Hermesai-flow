-- ENSAYO de 20261009_inactivo_fuera_de_rls.sql — NO deja nada en la base.
-- Termina en RAISE EXCEPTION: el error deshace la transacción y el veredicto
-- llega en el mensaje.
--
--   Pasada ROJA : comenta el bloque MIGRACIÓN. Deben fallar 1–6 (pasan 7–8).
--   Pasada VERDE: con el bloque. Solo vale «8 de 8 OK — sin fallos».
--   Tras aplicar: comenta el bloque otra vez (ya está en la base) → 8 de 8.
--
--   npx supabase db query --linked -f database/ensayos/20261009_inactivo_fuera_de_rls.ensayo.sql
--
-- Datos propios: una organización, dos usuarios admin (uno activo, otro no) y
-- un flujo. Ninguna fila real se toca.

BEGIN;

-- >>> MIGRACIÓN — pegada literal del fichero, sin su BEGIN/COMMIT

CREATE OR REPLACE FUNCTION public.my_organization_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
    SELECT organization_id FROM public.profiles
     WHERE id = auth.uid() AND is_active IS TRUE
$function$;

CREATE OR REPLACE FUNCTION public.my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
    SELECT role FROM public.profiles
     WHERE id = auth.uid() AND is_active IS TRUE
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
         WHERE id = auth.uid() AND role = 'admin' AND is_active IS TRUE
    )
$function$;

-- <<< MIGRACIÓN

DO $ensayo$
DECLARE
    v_ok int := 0; v_total int := 0; v_fallos text := '';
    v_n int; v_t text; v_b boolean; v_u uuid;
    v_org      uuid := gen_random_uuid();
    v_inactivo uuid := gen_random_uuid();
    v_activo   uuid := gen_random_uuid();
    v_wf       uuid := gen_random_uuid();
BEGIN
    INSERT INTO auth.users (id, email) VALUES
        (v_inactivo, 'ensayo-inactivo@ensayo.invalid'),
        (v_activo,   'ensayo-activo@ensayo.invalid');
    INSERT INTO public.organizations (id, name, slug)
        VALUES (v_org, 'Ensayo inactivo', 'ensayo-inactivo-' || v_org);
    INSERT INTO public.profiles (id, organization_id, email, name, role, is_active) VALUES
        (v_inactivo, v_org, 'ensayo-inactivo@ensayo.invalid', 'Inactivo', 'admin', false),
        (v_activo,   v_org, 'ensayo-activo@ensayo.invalid',   'Activo',   'admin', true);
    INSERT INTO public.workflows (id, organization_id, name) VALUES (v_wf, v_org, 'Flujo de ensayo');

    -- ── Como el admin DESACTIVADO ─────────────────────────────────────────
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_inactivo, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    -- 1. my_organization_id() no lo reconoce
    v_total := v_total + 1;
    v_u := public.my_organization_id();
    IF v_u IS NULL THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [1 my_organization_id devuelve su org]'; END IF;

    -- 2. my_role() no lo reconoce
    v_total := v_total + 1;
    v_t := public.my_role();
    IF v_t IS NULL THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [2 my_role devuelve ' || v_t || ']'; END IF;

    -- 3. is_admin() es false
    v_total := v_total + 1;
    v_b := public.is_admin();
    IF v_b IS FALSE THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [3 is_admin true]'; END IF;

    -- 4. No ve el flujo de su organización
    v_total := v_total + 1;
    SELECT count(*) INTO v_n FROM public.workflows WHERE id = v_wf;
    IF v_n = 0 THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [4 ve el flujo]'; END IF;

    -- 5. No puede reactivarse a sí mismo (se mide la fila, no el error)
    v_total := v_total + 1;
    UPDATE public.profiles SET is_active = true WHERE id = v_inactivo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [5 se reactivó solo]'; END IF;

    -- 6. No puede escribir en audit_log: rechazo de RLS (42501), no otro error
    v_total := v_total + 1;
    BEGIN
        INSERT INTO public.audit_log (organization_id, usuario_id, accion, entidad, descripcion)
            VALUES (v_org, v_inactivo, 'login', 'sesion', 'ensayo');
        v_fallos := v_fallos || ' [6 escribió en audit_log]';
    EXCEPTION WHEN insufficient_privilege THEN
        v_ok := v_ok + 1;
    END;

    RESET ROLE;

    -- ── Control: el admin ACTIVO sigue funcionando (pasa en roja y verde) ──
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_activo, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    -- 7. Ve el flujo y es admin
    v_total := v_total + 1;
    SELECT count(*) INTO v_n FROM public.workflows WHERE id = v_wf;
    IF v_n = 1 AND public.is_admin() AND public.my_role() = 'admin'
    THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [7 el admin activo perdió acceso]'; END IF;

    -- 8. Puede reactivar al otro (la vía legítima sigue abierta)
    v_total := v_total + 1;
    UPDATE public.profiles SET is_active = true WHERE id = v_inactivo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [8 el admin activo no puede reactivar]'; END IF;

    RESET ROLE;

    RAISE EXCEPTION 'ENSAYO: % de % OK —%', v_ok, v_total,
        CASE WHEN v_fallos = '' THEN ' sin fallos' ELSE v_fallos END;
END
$ensayo$;
