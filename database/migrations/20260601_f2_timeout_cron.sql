-- ═══════════════════════════════════════════════════════════════════════════
-- F2.2 — Timeout y escalamiento de aprobaciones vencidas
-- Requiere extensión pg_cron (habilitada en Supabase por defecto)
-- Ejecutar en Supabase SQL Editor (proyecto kbscaxcokxwdbnrltkup)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Función que procesa tareas vencidas ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.procesar_aprobaciones_vencidas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    tarea RECORD;
BEGIN
    FOR tarea IN
        SELECT t.id, t.execution_run_id, t.workflow_id, t.organization_id,
               t.rol_aprobador, t.descripcion, t.node_title
        FROM public.tareas_aprobacion t
        WHERE t.estado = 'pendiente'
          AND t.vence_at < now()
    LOOP
        -- Marcar tarea como vencida
        UPDATE public.tareas_aprobacion
        SET estado = 'vencido'
        WHERE id = tarea.id;

        -- Marcar run como error por timeout
        UPDATE public.execution_runs
        SET status        = 'error',
            finished_at   = now(),
            error_message = 'Aprobación vencida sin respuesta del aprobador'
        WHERE id = tarea.execution_run_id
          AND status IN ('esperando_aprobacion', 'error');

        -- Registrar en audit_log
        INSERT INTO public.audit_log (organization_id, accion, entidad, entidad_id, descripcion)
        VALUES (
            tarea.organization_id,
            'vencimiento',
            'aprobacion',
            tarea.id,
            'Tarea "' || tarea.node_title || '" vencida sin aprobación — flujo cancelado'
        );
    END LOOP;
END;
$$;

-- ── Programar ejecución cada hora ───────────────────────────────────────────
-- Requiere que pg_cron esté habilitado en Extensions del proyecto
SELECT cron.schedule(
    'aprobaciones-vencidas',          -- nombre del job (único)
    '0 * * * *',                      -- cada hora en punto
    'SELECT public.procesar_aprobaciones_vencidas();'
);

-- Para verificar que el cron quedó registrado:
-- SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'aprobaciones-vencidas';

-- rollback:
-- SELECT cron.unschedule('aprobaciones-vencidas');
-- DROP FUNCTION IF EXISTS public.procesar_aprobaciones_vencidas();
