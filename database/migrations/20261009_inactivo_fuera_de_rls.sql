-- HermesAI Flow - Un perfil desactivado no es nadie para la RLS
-- Fecha: 09/10/2026
--
-- Hasta hoy `profiles.is_active = false` solo lo miraba la pantalla de entrada
-- (auth.service.ts). Las 25 politicas RLS de `public` cuelgan de tres funciones
-- -- my_organization_id(), my_role(), is_admin() -- y ninguna miraba is_active,
-- asi que una persona desactivada con un token valido (Supabase Auth no se
-- entera de la desactivacion) seguia leyendo y escribiendo todo por API.
-- Lo peor: un admin desactivado pasaba `profiles_admin_manage` y podia
-- reactivarse a si mismo con un UPDATE.
--
-- Arreglo en el unico sitio que cubre todas las politicas a la vez: las tres
-- funciones responden "nadie" (NULL / false) si el perfil no esta activo.
-- `organization_id = NULL` es NULL y la politica descarta la fila; no hace
-- falta tocar ninguna politica.
--
-- `is_active IS TRUE`, no `is_active`: un NULL no puede acabar diciendo que si
-- (misma familia que token !== '' y la huella NULL de CLAUDE.md).
--
-- Se anade `SET search_path = ''`: son SECURITY DEFINER y no lo tenian. Los
-- cuerpos ya cualifican todo (public.profiles, auth.uid()).
--
-- No cambian los permisos de EXECUTE: anon los conserva porque la RLS los
-- evalua tambien para anon, y sin EXECUTE una consulta anonima daria error en
-- vez de salir vacia.
--
-- Las llamadas con la clave de servicio no pasan por aqui (auth.uid() es NULL
-- y ademas la service role se salta la RLS): el motor no cambia.
--
-- Ensayo: database/ensayos/20261009_inactivo_fuera_de_rls.ensayo.sql

BEGIN;

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

COMMIT;
