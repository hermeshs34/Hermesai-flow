-- 20261027d — Al administrador de la plataforma solo lo toca otro administrador
--             de la plataforma (decisión de Hermes, 27/10/2026)
--
-- POR QUÉ
--   Hermes lo cazó al probar: un admin de organización le podía cambiar el ROL
--   a hersan_romero (el único con app_metadata.admin_plataforma), y con eso
--   quitarle la administración a quien gobierna `politicas_seguridad.exigir_mfa`.
--   `profiles_admin_manage` (ALL, organización + is_admin()) no distingue a
--   nadie: también deja BORRAR su perfil por API.
--
-- ALCANCE (elegido por Hermes: «Rol + desactivar + borrar»)
--   · cambiar role u organization_id de un admin de plataforma  → bloqueado
--   · borrar su perfil                                           → bloqueado
--   · desactivarlo: va por admin-set-active (clave de servicio, un trigger no
--     lo ve) y se cierra en el CÓDIGO de esa función, no aquí.
--   · restablecerle la clave: PERMITIDO, a propósito.
--   Solo pasa quien sea admin de plataforma (es_admin_plataforma()) Y tenga
--   aal2 en ese JWT. La marca sin segundo factor no concede nada (igual que en
--   politicas_seguridad).
--
-- CÓMO
--   · Trigger SECURITY INVOKER: necesita ver `current_user` real para dejar
--     pasar a la clave de servicio y al SQL Editor (dentro de un DEFINER,
--     current_user sería el dueño de la función y la excepción no serviría).
--   · Para leer auth.users (que `authenticated` no ve) llama a
--     es_perfil_admin_plataforma(uuid), DEFINER, que solo contesta sobre
--     perfiles de la organización de quien pregunta: no enseña nada que
--     Gobierno no enseñe ya (la columna «2 pasos» marca a esas cuentas).
--   · BEFORE DELETE ⇒ RETURN OLD (NEW es NULL y cancelaría el borrado).
--   · EXECUTE retirado a `anon` POR SU NOMBRE (REVOKE FROM PUBLIC no basta).
--
-- VUELTA ATRÁS:
--   DROP TRIGGER IF EXISTS profiles_admin_plataforma_guard ON public.profiles;
--   DROP FUNCTION IF EXISTS public.profiles_admin_plataforma_guard();
--   DROP FUNCTION IF EXISTS public.es_perfil_admin_plataforma(uuid);

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
    -- Clave de servicio (Edge Functions) y SQL Editor: fuera de esta regla.
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
