-- ═══════════════════════════════════════════════════════════════════════════
-- HermesAI Flow — Tabla execution_runs
-- Agrupa los logs por ejecución de flujo (run-level state)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.execution_runs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    workflow_id      uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    triggered_by     text NOT NULL DEFAULT 'manual',   -- 'manual' | 'cron' | 'webhook'
    status           text NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error' | 'cancelled'
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    duration_ms      int,
    error_message    text,
    logs_count       int NOT NULL DEFAULT 0,
    created_by       uuid REFERENCES public.profiles(id)
);

CREATE INDEX idx_execution_runs_workflow ON public.execution_runs(workflow_id);
CREATE INDEX idx_execution_runs_org ON public.execution_runs(organization_id, started_at DESC);

-- Vincular execution_logs a execution_runs
ALTER TABLE public.execution_logs
    ADD COLUMN IF NOT EXISTS execution_run_id uuid REFERENCES public.execution_runs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_execution_logs_run ON public.execution_logs(execution_run_id);

-- RLS
ALTER TABLE public.execution_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "runs_tenant_read" ON public.execution_runs
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "runs_system_insert" ON public.execution_runs
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id());

CREATE POLICY "runs_system_update" ON public.execution_runs
    FOR UPDATE TO authenticated
    USING (organization_id = public.my_organization_id());

-- rollback:
-- ALTER TABLE public.execution_logs DROP COLUMN IF EXISTS execution_run_id;
-- DROP TABLE IF EXISTS public.execution_runs;
