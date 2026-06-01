-- Fix Bug 2: workflow_nodes y workflow_connections — misma restricción que workflows
-- Los roles BPM (dueno_proceso, supervisor, operador) deben poder crear/editar nodos
-- Ejecutar en Supabase SQL Editor (proyecto kbscaxcokxwdbnrltkup)

-- ── workflow_nodes ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "nodes_editor_write" ON public.workflow_nodes;

CREATE POLICY "nodes_editor_write" ON public.workflow_nodes
    FOR ALL TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'))
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

-- ── workflow_connections ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "connections_editor_write" ON public.workflow_connections;

CREATE POLICY "connections_editor_write" ON public.workflow_connections
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.id = workflow_id AND w.organization_id = public.my_organization_id()
    ) AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.id = workflow_id AND w.organization_id = public.my_organization_id()
    ) AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

-- rollback:
-- DROP POLICY "nodes_editor_write" ON public.workflow_nodes;
-- DROP POLICY "connections_editor_write" ON public.workflow_connections;
-- (re-crear con los roles originales: admin, editor)
