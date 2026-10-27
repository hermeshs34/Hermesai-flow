-- 20261027_sin_truncate_ni_anon_en_funciones_rls.sql
--
-- Dos permisos que sobraban, hallados por el diagnóstico de /blindar-seguridad
-- (27/10/2026). Paso 1 del blindaje: no le cambia nada a nadie que use la app.
--
-- 1. TRUNCATE. Supabase concede a `anon` y `authenticated` todos los permisos
--    de tabla por defecto (`pg_default_acl`), TRUNCATE incluido, y el RLS no
--    cubre TRUNCATE: vacía la tabla entera sin mirar ni una política. Lo tenían
--    11 de las 16 tablas de `public`, `audit_log` y `profiles` entre ellas (las
--    otras 5 ya lo perdieron en 20260925 y 20260928). PostgREST no expone
--    TRUNCATE, así que hoy no se alcanza por API; se quita igual, porque una
--    función INVOKER o una vía nueva mañana lo pondría a un paso.
--    Se quita también de los permisos por defecto de `postgres`, para que la
--    próxima tabla no nazca con él. Los de `supabase_admin` no los puede tocar
--    `postgres`: una tabla creada por ese rol seguiría naciendo con TRUNCATE, y
--    el diagnóstico (`truncate_para_authenticated`) lo vuelve a cazar.
--
-- 2. EXECUTE de `anon` (y de PUBLIC) en is_admin(), my_organization_id() y
--    my_role(). Son SECURITY DEFINER y de ellas cuelgan las 25 políticas de
--    `public`, todas para `authenticated`; ninguna política para `public` o
--    `anon` las usa. Sin sesión devuelven NULL/false, así que no filtraban nada:
--    sobran. `authenticated` y `service_role` las conservan — sin ellas la RLS
--    entera dejaría de funcionar.
--    `REVOKE … FROM PUBLIC` no basta: Supabase concede EXECUTE a `anon` por su
--    nombre (CLAUDE.md §6.4). Por eso se nombra.

BEGIN;

DO $mig$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT c.oid::regclass AS tabla
          FROM pg_class c
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
    LOOP
        EXECUTE format('REVOKE TRUNCATE ON TABLE %s FROM PUBLIC, anon, authenticated', t.tabla);
    END LOOP;
END
$mig$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_organization_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_role()            FROM PUBLIC, anon;

COMMIT;
