-- ═══════════════════════════════════════════════════════════════════════════
-- Permitir al admin actualizar configuración de su organización
-- Ejecutar en Supabase SQL Editor (proyecto kbscaxcokxwdbnrltkup)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "org_admin_update" ON public.organizations
    FOR UPDATE TO authenticated
    USING (id = public.my_organization_id() AND public.my_role() = 'admin')
    WITH CHECK (id = public.my_organization_id() AND public.my_role() = 'admin');

-- rollback:
-- DROP POLICY "org_admin_update" ON public.organizations;
