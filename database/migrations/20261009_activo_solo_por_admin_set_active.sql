-- 20261009_activo_solo_por_admin_set_active.sql
--
-- `profiles.is_active` solo lo cambia la Edge Function `admin-set-active`
-- (CLAUDE.md §6.8), que mueve el perfil Y el ban de Auth a la vez.
--
-- Hasta hoy `profiles_admin_manage` (ALL) dejaba a un admin hacer el UPDATE
-- por API con su propia sesión. Medido el 09/10/2026 en un ensayo:
--   - desactivar así  ⇒ fuera por la RLS, pero SIN ban: podía iniciar sesión;
--   - reactivar así   ⇒ is_active = true con el ban hasta 2126: «activo que no
--     puede entrar».
-- Dos caminos que escriben el mismo hecho y solo uno lo escribe entero.
--
-- La regla: una sesión de usuario (`authenticated` / `anon`) no puede cambiar
-- `is_active` ni crear perfiles. La clave de servicio sí — es la de
-- `admin-set-active` y la de `admin-create-user`, que crea el perfil junto con
-- la cuenta de Auth. El navegador no escribe ninguna de las dos cosas: solo
-- cambia `role` (governance.service.ts), y eso sigue permitido.
--
-- Va en un trigger y no en la política: la RLS decide filas, no columnas, y
-- quitarle el UPDATE al admin le quitaría también cambiar el rol.

BEGIN;

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

COMMIT;
