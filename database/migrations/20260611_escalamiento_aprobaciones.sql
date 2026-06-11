-- ═══════════════════════════════════════════════════════════════════════════
-- F4 — Escalamiento automático de aprobaciones vencidas
-- Ejecutar en Supabase SQL Editor (proyecto kbscaxcokxwdbnrltkup)
--
-- Reemplaza el comportamiento de 20260601_f2_timeout_cron.sql (que CANCELABA
-- la tarea al vencer). Ahora la lógica vive en la Edge Function cron-runner:
--   nivel 0 vencida -> ESCALA al rol superior + email + nuevo plazo
--   nivel 1 vencida -> 'vencido' + run en error + notifica solicitante
--
-- NOTA: no usar "$$" en comentarios — el SQL Editor de Supabase los interpreta
-- como apertura de dollar-quote aunque estén comentados y rompe el parseo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas de escalamiento en tareas_aprobacion ────────────────────────
ALTER TABLE public.tareas_aprobacion
    ADD COLUMN IF NOT EXISTS nivel_escalamiento     int  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS escalado_at            timestamptz,
    ADD COLUMN IF NOT EXISTS rol_aprobador_original text;

-- ── 2. Retirar el job SQL viejo que cancelaba sin escalar ───────────────────
-- (si nunca se aplicó la migración 20260601_f2_timeout_cron, no hace nada)
DO $do$
BEGIN
    PERFORM cron.unschedule('aprobaciones-vencidas');
EXCEPTION WHEN OTHERS THEN
    NULL; -- job inexistente o pg_cron no habilitado
END $do$;

DROP FUNCTION IF EXISTS public.procesar_aprobaciones_vencidas();

-- ── 3. Programar cron-runner cada minuto ─────────────────────────────────────
-- cron-runner ahora hace DOS cosas: disparar flujos cron + procesar vencidas.
-- Requiere extensiones pg_cron y pg_net habilitadas (Database -> Extensions).
-- Ejecutar EN UNA CONSULTA APARTE, reemplazando <SERVICE_ROLE_KEY>.
-- (Comando como string con comillas simples dobladas — sin dollar-quotes,
--  porque el splitter del SQL Editor también los detecta dentro de comentarios)
--
--   SELECT cron.schedule(
--       'cron-runner-cada-minuto',
--       '* * * * *',
--       'SELECT net.http_post(
--           url     := ''https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/cron-runner'',
--           headers := ''{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}''::jsonb,
--           body    := ''{}''::jsonb
--       );'
--   );
--
-- Verificar: SELECT jobid, jobname, schedule, active FROM cron.job;

-- ── Rollback ─────────────────────────────────────────────────────────────────
--   ALTER TABLE public.tareas_aprobacion
--       DROP COLUMN IF EXISTS nivel_escalamiento,
--       DROP COLUMN IF EXISTS escalado_at,
--       DROP COLUMN IF EXISTS rol_aprobador_original;
--   SELECT cron.unschedule('cron-runner-cada-minuto');
