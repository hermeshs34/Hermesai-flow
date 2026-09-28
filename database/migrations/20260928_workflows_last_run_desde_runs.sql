-- 20260928 — Rellenar workflows.last_run_at y execution_count desde execution_runs
--
-- execute-workflow escribía status='active' al cerrar un run correcto, valor que
-- el CHECK workflows_status_check (idle|running|error|paused) no admite. La base
-- rechazaba el UPDATE entero y nadie leía el { error }, así que last_run_at y
-- execution_count se congelaron en todo run correcto. Síntoma: el filtro
-- «Últ. 7d» del Constructor no encontraba flujos que corrían a diario.
--
-- El motor ya escribe 'idle'. Esto corrige el histórico con la fuente de verdad,
-- execution_runs. No toca estado_definicion, is_active ni la definición, así que
-- no dispara los guardas de §6.7.

UPDATE public.workflows w
SET    last_run_at     = r.ultima,
       execution_count = r.n
FROM  (SELECT workflow_id, max(started_at) AS ultima, count(*)::int AS n
       FROM   public.execution_runs
       GROUP  BY workflow_id) r
WHERE  r.workflow_id = w.id
  AND (w.last_run_at IS DISTINCT FROM r.ultima OR w.execution_count IS DISTINCT FROM r.n);

-- Comprobación (sentencia propia y la última: el SQL Editor solo muestra esta)
SELECT name, last_run_at, execution_count
FROM   public.workflows
ORDER  BY last_run_at DESC NULLS LAST;
