-- ENSAYO de 20261027d_admin_plataforma_intocable.sql — NO deja nada en la base.
-- Termina en RAISE EXCEPTION: el error deshace la transacción.
--   ROJA : sin el bloque MIGRACIÓN ⇒ fallan 1, 2, 3, 5, 8 y 10.
--   VERDE: con el bloque ⇒ 10 de 10.
--   Tras aplicar: sin el bloque (ya está en la base) ⇒ 10 de 10.
-- Crea su propio admin de plataforma sintético (auth.users + profiles) para
-- poder cambiarlo y borrarlo; las filas reales solo se intentan cambiar.

BEGIN;

-- >>> MIGRACIÓN
CREATE OR REPLACE FUNCTION public.es_perfil_admin_plataforma(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = ''
AS $fn$
    SELECT EXISTS (
        SELECT 1
          FROM auth.users u
          JOIN public.profiles p ON p.id = u.id
         WHERE u.id = p_id
           AND p.organization_id = public.my_organization_id()
           AND coalesce(u.raw_app_meta_data ->> 'admin_plataforma', '') = 'true'
    );
$fn$;

REVOKE EXECUTE ON FUNCTION public.es_perfil_admin_plataforma(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_perfil_admin_plataforma(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.profiles_admin_plataforma_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $fn$
BEGIN
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.role IS NOT DISTINCT FROM OLD.role
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
        RETURN NEW;
    END IF;

    IF public.es_perfil_admin_plataforma(OLD.id)
       AND NOT (public.es_admin_plataforma()
                AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2') THEN
        RAISE EXCEPTION '% es administrador de la plataforma: su rol, su organización y su perfil solo los puede cambiar otro administrador de la plataforma.', OLD.name
            USING ERRCODE = '42501';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.profiles_admin_plataforma_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_admin_plataforma_guard ON public.profiles;
CREATE TRIGGER profiles_admin_plataforma_guard
    BEFORE UPDATE OF role, organization_id OR DELETE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.profiles_admin_plataforma_guard();
-- <<< MIGRACIÓN

DO $ensayo$
DECLARE
    v_ok int := 0; v_total int := 0; v_fallos text := ''; v_n int;
    v_org_admin uuid; v_plat uuid; v_kath uuid; v_org uuid; v_rol_kath text;
    v_sint uuid := gen_random_uuid();
    c_org_admin text; c_plat_aal2 text; c_plat_aal1 text;
BEGIN
    SELECT id, organization_id INTO v_org_admin, v_org FROM public.profiles WHERE name = 'Hermes Sánchez' AND role = 'admin' AND is_active;
    SELECT id INTO v_plat FROM public.profiles WHERE id = 'fc5decbb-58b6-4305-8448-c4b5d8dfe21a' AND role = 'admin' AND is_active AND organization_id = v_org;
    SELECT id, role INTO v_kath, v_rol_kath FROM public.profiles WHERE name = 'Katherine Sanchez' AND is_active AND organization_id = v_org;
    IF v_org_admin IS NULL OR v_plat IS NULL OR v_kath IS NULL
       OR (SELECT raw_app_meta_data ->> 'admin_plataforma' FROM auth.users WHERE id = v_plat) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'ENSAYO: censo distinto del esperado, no se prueba nada';
    END IF;

    -- Admin de plataforma sintético, en la misma organización.
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_sint, 'authenticated', 'authenticated', 'ensayo-plataforma@ejemplo.invalid',
            '{"provider":"email","providers":["email"],"admin_plataforma":true}'::jsonb, '{}'::jsonb, now(), now());
    INSERT INTO public.profiles (id, organization_id, email, name, role, is_active)
    VALUES (v_sint, v_org, 'ensayo-plataforma@ejemplo.invalid', 'Ensayo Plataforma', 'admin', true);

    c_org_admin := json_build_object('sub', v_org_admin, 'role', 'authenticated', 'aal', 'aal2',
                                     'app_metadata', json_build_object())::text;
    c_plat_aal2 := json_build_object('sub', v_plat, 'role', 'authenticated', 'aal', 'aal2',
                                     'app_metadata', json_build_object('admin_plataforma', true))::text;
    c_plat_aal1 := json_build_object('sub', v_plat, 'role', 'authenticated', 'aal', 'aal1',
                                     'app_metadata', json_build_object('admin_plataforma', true))::text;

    -- 1. Un admin de organización (con aal2) NO cambia el rol de un admin de plataforma.
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', c_org_admin, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET role = 'viewer' WHERE id = v_sint;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RESET ROLE;
        v_fallos := v_fallos || ' [1 cambió el rol, filas=' || v_n || ']';
        UPDATE public.profiles SET role = 'admin' WHERE id = v_sint;
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        IF SQLERRM LIKE '%administrador de la plataforma%' THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [1 otro 42501: ' || SQLERRM || ']'; END IF;
    END;

    -- 2. Un admin de organización NO borra el perfil de un admin de plataforma.
    v_total := v_total + 1;
    BEGIN
        BEGIN
            PERFORM set_config('request.jwt.claims', c_org_admin, true);
            SET LOCAL ROLE authenticated;
            DELETE FROM public.profiles WHERE id = v_sint;
            GET DIAGNOSTICS v_n = ROW_COUNT;
            RESET ROLE;
            v_fallos := v_fallos || ' [2 borró, filas=' || v_n || ']';
            RAISE EXCEPTION 'deshacer_prueba';
        EXCEPTION WHEN insufficient_privilege THEN
            RESET ROLE;
            IF SQLERRM LIKE '%administrador de la plataforma%'
               AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_sint)
            THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [2 otro 42501: ' || SQLERRM || ']'; END IF;
        END;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        IF SQLERRM <> 'deshacer_prueba' THEN v_fallos := v_fallos || ' [2 ' || SQLSTATE || ' ' || SQLERRM || ']'; END IF;
    END;

    -- 3. Un admin de organización NO cambia el rol del admin de plataforma REAL.
    v_total := v_total + 1;
    BEGIN
        BEGIN
            PERFORM set_config('request.jwt.claims', c_org_admin, true);
            SET LOCAL ROLE authenticated;
            UPDATE public.profiles SET role = 'viewer' WHERE id = v_plat;
            GET DIAGNOSTICS v_n = ROW_COUNT;
            RESET ROLE;
            v_fallos := v_fallos || ' [3 cambió el rol real, filas=' || v_n || ']';
            RAISE EXCEPTION 'deshacer_prueba';
        EXCEPTION WHEN insufficient_privilege THEN
            RESET ROLE;
            IF SQLERRM LIKE '%administrador de la plataforma%' THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [3 otro 42501: ' || SQLERRM || ']'; END IF;
        END;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        IF SQLERRM <> 'deshacer_prueba' THEN v_fallos := v_fallos || ' [3 ' || SQLSTATE || ' ' || SQLERRM || ']'; END IF;
    END;

    -- 4. El admin de plataforma con aal2 SÍ cambia el rol de otro admin de plataforma.
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', c_plat_aal2, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET role = 'supervisor' WHERE id = v_sint;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RESET ROLE;
        IF v_n = 1 AND (SELECT role FROM public.profiles WHERE id = v_sint) = 'supervisor'
        THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [4 no aplicado, filas=' || v_n || ']'; END IF;
        UPDATE public.profiles SET role = 'admin' WHERE id = v_sint;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE; v_fallos := v_fallos || ' [4 rechazado: ' || SQLERRM || ']';
    END;

    -- 5. El admin de plataforma SIN aal2 NO lo cambia: la marca sola no concede nada.
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', c_plat_aal1, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET role = 'viewer' WHERE id = v_sint;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RESET ROLE;
        v_fallos := v_fallos || ' [5 aal1 cambió el rol, filas=' || v_n || ']';
        UPDATE public.profiles SET role = 'admin' WHERE id = v_sint;
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        IF SQLERRM LIKE '%administrador de la plataforma%' THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [5 otro 42501: ' || SQLERRM || ']'; END IF;
    END;

    -- 6. El admin de plataforma con aal2 SÍ borra el perfil (y se deshace).
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', c_plat_aal2, true);
        SET LOCAL ROLE authenticated;
        DELETE FROM public.profiles WHERE id = v_sint;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RESET ROLE;
        IF v_n = 1 AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_sint)
        THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [6 no borró, filas=' || v_n || ']'; END IF;
        RAISE EXCEPTION 'deshacer_prueba';
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        IF SQLERRM <> 'deshacer_prueba' THEN v_fallos := v_fallos || ' [6 ' || SQLSTATE || ' ' || SQLERRM || ']'; END IF;
    END;

    -- 7. Cambiar el rol de un usuario normal sigue funcionando (Gobierno).
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', c_org_admin, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET role = 'auditor' WHERE id = v_kath;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RESET ROLE;
        IF v_n = 1 AND (SELECT role FROM public.profiles WHERE id = v_kath) = 'auditor'
        THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [7 no aplicado]'; END IF;
        UPDATE public.profiles SET role = v_rol_kath WHERE id = v_kath;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE; v_fallos := v_fallos || ' [7 rechazado: ' || SQLERRM || ']';
    END;

    -- 8. Cambiar la organización del admin de plataforma: lo para ESTA regla
    --    (en ROJA lo para la WITH CHECK de la RLS, con otro mensaje).
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', c_org_admin, true);
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET organization_id = gen_random_uuid() WHERE id = v_sint;
        RESET ROLE;
        v_fallos := v_fallos || ' [8 cambió la organización]';
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        IF SQLSTATE = '42501' AND SQLERRM LIKE '%administrador de la plataforma%' THEN v_ok := v_ok + 1;
        ELSE v_fallos := v_fallos || ' [8 ' || SQLSTATE || ' ' || SQLERRM || ']'; END IF;
    END;

    -- 9. La clave de servicio no entra en la regla.
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
        SET LOCAL ROLE service_role;
        UPDATE public.profiles SET role = 'supervisor' WHERE id = v_sint;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        UPDATE public.profiles SET role = 'admin' WHERE id = v_sint;
        RESET ROLE;
        IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [9 filas=' || v_n || ']'; END IF;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE; v_fallos := v_fallos || ' [9 servicio rechazado: ' || SQLERRM || ']';
    END;

    -- 10. Permisos: anon no ejecuta ninguna; authenticated solo la consulta.
    v_total := v_total + 1;
    IF to_regprocedure('public.profiles_admin_plataforma_guard()') IS NOT NULL
       AND to_regprocedure('public.es_perfil_admin_plataforma(uuid)') IS NOT NULL
       AND NOT has_function_privilege('anon', 'public.profiles_admin_plataforma_guard()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.profiles_admin_plataforma_guard()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.es_perfil_admin_plataforma(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.es_perfil_admin_plataforma(uuid)', 'EXECUTE')
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [10 funciones ausentes o permisos mal]'; END IF;

    RAISE EXCEPTION 'ENSAYO: % de % OK —%', v_ok, v_total,
        CASE WHEN v_fallos = '' THEN ' sin fallos' ELSE v_fallos END;
END
$ensayo$;
