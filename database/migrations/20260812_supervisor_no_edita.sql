-- 20260812 — Quien autoriza no edita: `supervisor` sale de la edición de flujos.
--
-- Decisión de negocio de Hermes (12/08/2026): «el supervisor no edita el flujo,
-- solo lo autoriza, porque se pierde el control; él debe remitir al dueño para
-- su edición y corrección». Si quien revisa puede corregir lo que revisa, los
-- cuatro ojos se rompen igual, solo que en el otro sentido.
--
-- Esta misma mañana, `20260812_rls_edicion_igual_que_manage_workflows.sql` dejó
-- a `supervisor` DENTRO a propósito y anotó que debía salir «cuando exista el
-- ciclo de vida». El razonamiento era que sin permiso de autorizar se quedaba
-- sin nada que hacer — cierto mientras el rol estaba VACÍO. Esa misma tarde se
-- dio de alta un supervisor real (Nahum Azevedo, 18:38 UTC) y la excusa se
-- acabó: a partir de aquí es una persona con permiso de edición que no debería
-- tenerlo. Un solape teórico y uno con alguien dentro no son el mismo riesgo.
--
-- `supervisor` conserva `approve_tasks` y `view_logs`, que es su papel: aprueba
-- tareas y mira ejecuciones. Cuando exista `authorize_workflows` y los estados
-- borrador → en_revision → publicado (CICLO_VIDA_FLUJOS.md), ese permiso es el
-- que ocupa el hueco que deja este.
--
-- La lista queda igual a los roles con `manage_workflows` en
-- src/core/user.types.ts tras el cambio: admin, dueno_proceso, editor.
-- `editor` es legacy y no lo tiene nadie, pero conserva el permiso: las dos
-- capas deben decir lo mismo, no parecerse.
--
-- ALTER POLICY y no DROP+CREATE: reescribe en el sitio y no deja la tabla sin
-- política ni un instante.

ALTER POLICY "nodes_editor_write" ON public.workflow_nodes
    USING (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'editor']))
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'editor']));

ALTER POLICY "connections_editor_write" ON public.workflow_connections
    USING (EXISTS (
            SELECT 1 FROM public.workflows w
            WHERE w.id = workflow_connections.workflow_id
              AND w.organization_id = public.my_organization_id())
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'editor']))
    WITH CHECK (EXISTS (
            SELECT 1 FROM public.workflows w
            WHERE w.id = workflow_connections.workflow_id
              AND w.organization_id = public.my_organization_id())
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'editor']));

ALTER POLICY "workflows_editor_update" ON public.workflows
    USING (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'editor']))
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'editor']));

-- ⚠️ `workflows_editor_write` (INSERT) también admitía `supervisor`: crear un
-- flujo es editar. Se alinea igual.
ALTER POLICY "workflows_editor_write" ON public.workflows
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'editor']));
