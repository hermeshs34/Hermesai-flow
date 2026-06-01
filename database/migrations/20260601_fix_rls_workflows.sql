-- Fix Bug 1: ampliar roles que pueden crear/editar flujos
-- Los roles BPM de F1 (dueno_proceso, supervisor) deben poder crear flujos
-- Ejecutar en Supabase SQL Editor (proyecto kbscaxcokxwdbnrltkup)

DROP POLICY IF EXISTS "workflows_editor_write"  ON public.workflows;
DROP POLICY IF EXISTS "workflows_editor_update" ON public.workflows;

CREATE POLICY "workflows_editor_write" ON public.workflows
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor'));

CREATE POLICY "workflows_editor_update" ON public.workflows
    FOR UPDATE TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

-- rollback:
-- DROP POLICY "workflows_editor_write" ON public.workflows;
-- DROP POLICY "workflows_editor_update" ON public.workflows;
-- (re-crear con los roles originales: admin, editor)
