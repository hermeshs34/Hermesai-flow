-- 20260812 — La RLS de edición deja de ser más ancha que la pantalla.
--
-- Las políticas de escritura de flujos admitían `operador` y `operator`, que NO
-- tienen el permiso `manage_workflows` de `ROLE_PERMISSIONS`. Resultado: no ven
-- el botón de guardar y sin embargo podían escribir llamando a la API. Y no solo
-- nodos: `workflows_editor_update` gobierna `is_active` y `schedule_value`, así
-- que un operador podía **activar un flujo y cambiarle la hora del cron**.
--
-- Es el mismo desajuste de dos capas que ya costó `audit_log` y
-- `execute-workflow`, esta vez en sentido permisivo: una regla que solo vive en
-- la pantalla no es una regla. Aquí se alinean las dos.
--
-- La lista queda EXACTAMENTE igual a los roles con `manage_workflows` en
-- `src/core/user.types.ts`: admin, dueno_proceso, supervisor, editor.
-- `editor` es legacy y hoy no lo tiene nadie, pero se conserva porque el permiso
-- sí lo tiene: las dos capas deben decir lo mismo, no parecerse.
--
-- ⚠️ Cuando exista el ciclo de vida borrador → autorizado → publicado,
-- `supervisor` debe SALIR de esta lista: si autoriza, no edita. No se hace ahora
-- porque hoy no hay permiso de autorizar que ponga en su lugar.
--
-- Se usa ALTER POLICY y no DROP+CREATE: reescribe en el sitio y no deja la tabla
-- sin política ni un instante.

ALTER POLICY "nodes_editor_write" ON public.workflow_nodes
    USING (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'supervisor', 'editor']))
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'supervisor', 'editor']));

ALTER POLICY "connections_editor_write" ON public.workflow_connections
    USING (EXISTS (
            SELECT 1 FROM public.workflows w
            WHERE w.id = workflow_connections.workflow_id
              AND w.organization_id = public.my_organization_id())
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'supervisor', 'editor']))
    WITH CHECK (EXISTS (
            SELECT 1 FROM public.workflows w
            WHERE w.id = workflow_connections.workflow_id
              AND w.organization_id = public.my_organization_id())
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'supervisor', 'editor']));

ALTER POLICY "workflows_editor_update" ON public.workflows
    USING (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'supervisor', 'editor']))
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'supervisor', 'editor']));

-- `workflows_editor_write` (INSERT) ya estaba en esta lista: no se toca.
