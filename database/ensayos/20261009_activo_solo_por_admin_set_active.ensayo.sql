-- ENSAYO de 20261009_activo_solo_por_admin_set_active.sql — NO deja nada en la base.
-- Termina en RAISE EXCEPTION: el error deshace la transacción.
--   ROJA : sin el bloque MIGRACIÓN ⇒ las pruebas 1, 2 y 3 deben FALLAR.
--   VERDE: con el bloque ⇒ 7 de 7.
--   Tras aplicar: sin el bloque (ya está en la base) ⇒ 7 de 7.
-- Usa filas reales SOLO para intentar cambiarlas: todo se deshace.

BEGIN;

-- >>> MIGRACIÓN
CREATE OR REPLACE FUNCTION public.profiles_activo_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $fn$
BEGIN
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'Los usuarios se dan de alta desde Gobierno → Usuarios, no directamente: así la cuenta de acceso y el perfil se crean juntos.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'Para activar o desactivar a un usuario use Gobierno → Usuarios: así también se bloquea o desbloquea su acceso, y queda en la auditoría.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.profiles_activo_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_activo_guard ON public.profiles;
CREATE TRIGGER profiles_activo_guard
    BEFORE INSERT OR UPDATE OF is_active ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.profiles_activo_guard();
-- <<< MIGRACIÓN

DO $ensayo$
DECLARE
    v_ok int := 0; v_total int := 0; v_fallos text := ''; v_n int;
    v_admin uuid; v_kath uuid; v_nahum uuid; v_org uuid; v_rol text;
BEGIN
    SELECT id, organization_id INTO v_admin, v_org FROM public.profiles WHERE name = 'Hermes Sánchez';
    SELECT id, role INTO v_kath, v_rol FROM public.profiles WHERE name = 'Katherine Sanchez' AND is_active;
    SELECT id INTO v_nahum FROM public.profiles WHERE name = 'Nahum Azevedo' AND NOT is_active;
    IF v_admin IS NULL OR v_kath IS NULL OR v_nahum IS NULL THEN
        RAISE EXCEPTION 'ENSAYO: censo distinto del esperado, no se prueba nada';
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

    -- 1. Un admin con su sesión NO desactiva por API.
    v_total := v_total + 1;
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET is_active = false WHERE id = v_kath;
        RESET ROLE;
        v_fallos := v_fallos || ' [1 desactivó por API]';
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        IF SQLERRM LIKE '%Gobierno%' THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [1 otro 42501: ' || SQLERRM || ']'; END IF;
    END;

    -- 2. Un admin con su sesión NO reactiva por API.
    v_total := v_total + 1;
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET is_active = true WHERE id = v_nahum;
        RESET ROLE;
        v_fallos := v_fallos || ' [2 reactivó por API]';
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        IF SQLERRM LIKE '%Gobierno%' THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [2 otro 42501: ' || SQLERRM || ']'; END IF;
    END;

    -- 3. Un admin con su sesión NO crea un perfil por API.
    v_total := v_total + 1;
    BEGIN
        SET LOCAL ROLE authenticated;
        INSERT INTO public.profiles (id, organization_id, email, name, role, is_active)
        VALUES (gen_random_uuid(), v_org, 'ensayo@ejemplo.invalid', 'Ensayo', 'viewer', true);
        RESET ROLE;
        v_fallos := v_fallos || ' [3 creó un perfil por API]';
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        IF SQLERRM LIKE '%Gobierno%' THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [3 otro 42501: ' || SQLERRM || ']'; END IF;
    WHEN OTHERS THEN
        RESET ROLE;
        v_fallos := v_fallos || ' [3 falló por otra causa: ' || SQLSTATE || ' ' || SQLERRM || ']';
    END;

    -- 4. Cambiar el ROL sigue funcionando (lo hace Gobierno desde el navegador).
    v_total := v_total + 1;
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET role = 'auditor' WHERE id = v_kath;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RESET ROLE;
        IF v_n = 1 AND (SELECT role FROM public.profiles WHERE id = v_kath) = 'auditor'
        THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [4 cambio de rol no aplicado]'; END IF;
        UPDATE public.profiles SET role = v_rol WHERE id = v_kath;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE; v_fallos := v_fallos || ' [4 cambio de rol rechazado: ' || SQLERRM || ']';
    END;

    -- 5. Reenviar is_active con el MISMO valor no es un cambio: pasa.
    v_total := v_total + 1;
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE public.profiles SET is_active = true WHERE id = v_kath;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RESET ROLE;
        IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [5 filas=' || v_n || ']'; END IF;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE; v_fallos := v_fallos || ' [5 rechazado: ' || SQLERRM || ']';
    END;

    -- 6. La clave de servicio (admin-set-active) SÍ desactiva y reactiva.
    v_total := v_total + 1;
    BEGIN
        SET LOCAL ROLE service_role;
        UPDATE public.profiles SET is_active = false WHERE id = v_kath;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        UPDATE public.profiles SET is_active = true WHERE id = v_kath;
        RESET ROLE;
        IF v_n = 1 AND (SELECT is_active FROM public.profiles WHERE id = v_kath)
        THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [6 servicio no pudo]'; END IF;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE; v_fallos := v_fallos || ' [6 servicio rechazado: ' || SQLERRM || ']';
    END;

    -- 7. Nadie ejecuta la función del trigger por su nombre.
    v_total := v_total + 1;
    IF to_regprocedure('public.profiles_activo_guard()') IS NOT NULL
       AND NOT has_function_privilege('anon', 'public.profiles_activo_guard()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.profiles_activo_guard()', 'EXECUTE')
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [7 función ausente o ejecutable]'; END IF;

    RAISE EXCEPTION 'ENSAYO: % de % OK —%', v_ok, v_total,
        CASE WHEN v_fallos = '' THEN ' sin fallos' ELSE v_fallos END;
END
$ensayo$;
