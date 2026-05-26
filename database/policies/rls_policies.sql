-- ═══════════════════════════════════════════════════════════════════════════
-- HermesAI Flow — Políticas RLS
-- Patrón: aislamiento total por organization_id
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Habilitar RLS en todas las tablas ────────────────────────────────────
ALTER TABLE public.organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_nodes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations       ENABLE ROW LEVEL SECURITY;

-- ── Helper: organization_id del usuario autenticado ───────────────────────
CREATE OR REPLACE FUNCTION public.my_organization_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- ── organizations ─────────────────────────────────────────────────────────
CREATE POLICY "org_read_own" ON public.organizations
    FOR SELECT TO authenticated
    USING (id = public.my_organization_id());

-- ── profiles ──────────────────────────────────────────────────────────────
CREATE POLICY "profiles_read_own_org" ON public.profiles
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "profiles_admin_manage" ON public.profiles
    FOR ALL TO authenticated
    USING (organization_id = public.my_organization_id() AND public.my_role() = 'admin')
    WITH CHECK (organization_id = public.my_organization_id() AND public.my_role() = 'admin');

-- ── workflows ─────────────────────────────────────────────────────────────
CREATE POLICY "workflows_tenant_read" ON public.workflows
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "workflows_editor_write" ON public.workflows
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor'));

CREATE POLICY "workflows_editor_update" ON public.workflows
    FOR UPDATE TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'operator'));

CREATE POLICY "workflows_admin_delete" ON public.workflows
    FOR DELETE TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() = 'admin');

-- ── workflow_nodes ────────────────────────────────────────────────────────
CREATE POLICY "nodes_tenant_read" ON public.workflow_nodes
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "nodes_editor_write" ON public.workflow_nodes
    FOR ALL TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor'))
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor'));

-- ── workflow_connections ──────────────────────────────────────────────────
CREATE POLICY "connections_tenant_read" ON public.workflow_connections
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.id = workflow_id AND w.organization_id = public.my_organization_id()
    ));

CREATE POLICY "connections_editor_write" ON public.workflow_connections
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.id = workflow_id AND w.organization_id = public.my_organization_id()
    ) AND public.my_role() IN ('admin', 'editor'))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.id = workflow_id AND w.organization_id = public.my_organization_id()
    ) AND public.my_role() IN ('admin', 'editor'));

-- ── execution_logs ────────────────────────────────────────────────────────
CREATE POLICY "logs_tenant_read" ON public.execution_logs
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "logs_system_insert" ON public.execution_logs
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id());

-- ── integrations ──────────────────────────────────────────────────────────
CREATE POLICY "integrations_tenant_read" ON public.integrations
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "integrations_admin_manage" ON public.integrations
    FOR ALL TO authenticated
    USING (organization_id = public.my_organization_id() AND public.my_role() = 'admin')
    WITH CHECK (organization_id = public.my_organization_id() AND public.my_role() = 'admin');
