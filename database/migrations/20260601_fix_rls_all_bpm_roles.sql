-- ═══════════════════════════════════════════════════════════════════════════
-- Fix definitivo: ampliar RLS en workflows, workflow_nodes y workflow_connections
-- para incluir TODOS los roles BPM de F1
-- EJECUTAR EN SUPABASE SQL EDITOR — proyecto kbscaxcokxwdbnrltkup
-- Esta migración reemplaza las dos anteriores (20260601_fix_rls_*.sql)
-- Es idempotente: puede ejecutarse varias veces sin problema
-- ═══════════════════════════════════════════════════════════════════════════

-- ── workflows ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "workflows_editor_write"  ON public.workflows;
DROP POLICY IF EXISTS "workflows_editor_update" ON public.workflows;

-- INSERT: dueno_proceso y supervisor pueden crear flujos
CREATE POLICY "workflows_editor_write" ON public.workflows
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor'));

-- UPDATE: todos los roles BPM pueden editar flujos
CREATE POLICY "workflows_editor_update" ON public.workflows
    FOR UPDATE TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'))
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

-- ── workflow_nodes ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "nodes_editor_write" ON public.workflow_nodes;

CREATE POLICY "nodes_editor_write" ON public.workflow_nodes
    FOR ALL TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'))
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

-- ── workflow_connections ──────────────────────────────────────────────────
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

-- ── Verificar resultado ───────────────────────────────────────────────────
-- Ejecuta esto para confirmar que las políticas quedaron bien:
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE tablename IN ('workflows','workflow_nodes','workflow_connections')
-- ORDER BY tablename, policyname;

-- rollback:
-- DROP POLICY "workflows_editor_write"   ON public.workflows;
-- DROP POLICY "workflows_editor_update"  ON public.workflows;
-- DROP POLICY "nodes_editor_write"       ON public.workflow_nodes;
-- DROP POLICY "connections_editor_write" ON public.workflow_connections;
-- (re-crear con roles originales: admin, editor)
