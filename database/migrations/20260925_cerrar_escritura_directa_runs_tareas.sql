-- 20260925_cerrar_escritura_directa_runs_tareas.sql
--
-- Cierra la escritura DIRECTA por API sobre las tres tablas que son evidencia
-- de ejecución y de aprobación. Quienes las escriben de verdad —execute-workflow,
-- cron-runner y resolve-approval— usan la clave de servicio, que no pasa por
-- RLS, así que nada legítimo depende de estas políticas. Ninguna función SQL
-- escribe en ellas (comprobado contra pg_proc el 25/09/2026).
--
-- LO QUE HABÍA, y por qué era un hueco:
--
-- 1. tareas_aprobacion · `org_isolation` para ALL (y para {public}): cualquier
--    usuario de la organización podía, por API, BORRAR tareas, CREARLAS, y
--    sobre todo ACTUALIZARLAS: poner `estado='aprobado'` a una tarea de AML sin
--    pasar por resolve-approval, que es la única capa que aplica la regla del
--    Oficial de Cumplimiento (CLAUDE.md §6.2) y la segregación de funciones.
--    La regla estaba en la función y la puerta de al lado, abierta en la tabla.
--
-- 2. execution_runs · `runs_system_update` (UPDATE sin WITH CHECK) y
--    `runs_system_insert`: cualquiera podía reescribir `context_json` de un run
--    pausado —p. ej. `en_lista` del nodo AML— o su `definicion_huella`, que es
--    justo lo que protege §9.5 al reanudar. Y fabricar runs.
--
-- 3. execution_logs · `logs_system_insert`: cualquiera podía fabricar líneas de
--    registro de ejecución, que son el audit trail de §7.
--
-- LO ÚNICO QUE LA PANTALLA ESCRIBE: el Dashboard marca un run con error como
-- resuelto (`update({ status: 'cancelled' })`). Eso se conserva, y solo eso:
-- UPDATE únicamente de la columna `status`, únicamente desde `error` y
-- únicamente hacia `cancelled`.

BEGIN;

-- 1. tareas_aprobacion: solo lectura para la organización.
DROP POLICY IF EXISTS org_isolation ON public.tareas_aprobacion;
CREATE POLICY tareas_tenant_read ON public.tareas_aprobacion
    FOR SELECT TO authenticated
    USING (organization_id = my_organization_id());

-- 2. execution_runs: fuera INSERT; UPDATE reducido a «marcar resuelto».
DROP POLICY IF EXISTS runs_system_insert ON public.execution_runs;
DROP POLICY IF EXISTS runs_system_update ON public.execution_runs;
CREATE POLICY runs_marcar_resuelto ON public.execution_runs
    FOR UPDATE TO authenticated
    USING      (organization_id = my_organization_id() AND status = 'error')
    WITH CHECK (organization_id = my_organization_id() AND status = 'cancelled');
-- RLS filtra filas, no columnas: sin esto, quien puede pasar un run de error a
-- cancelado podría de paso reescribir su context_json en el mismo UPDATE.
REVOKE UPDATE ON public.execution_runs FROM authenticated, anon;
GRANT  UPDATE (status) ON public.execution_runs TO authenticated;

-- 3. execution_logs: fuera INSERT.
DROP POLICY IF EXISTS logs_system_insert ON public.execution_logs;

-- 4. Y además sin el permiso de tabla. Quitar la política ya basta —sin
--    política, RLS no deja escribir—, pero las tres tablas tenían concedido
--    TODO a `anon` y `authenticated`, y una sola política permisiva que alguien
--    añada mañana reabriría la puerta. Sin el GRANT, la base contesta
--    «permission denied» aunque aparezca esa política. `anon` va por su NOMBRE:
--    REVOKE FROM PUBLIC no quita lo concedido por nombre (CLAUDE.md §6.4).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tareas_aprobacion FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.execution_logs    FROM anon, authenticated;
REVOKE INSERT,         DELETE, TRUNCATE ON public.execution_runs    FROM anon, authenticated;

COMMIT;
