-- ═══════════════════════════════════════════════════════════════════════════
-- HermesAI Flow — Schema Principal
-- Última actualización: Mayo 2026
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Organizaciones (tenant raíz) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    slug        text NOT NULL UNIQUE,
    plan        text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Perfiles de usuario ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email           text NOT NULL,
    name            text NOT NULL,
    role            text NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('admin', 'editor', 'operator', 'viewer')),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Flujos de trabajo ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflows (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            text NOT NULL,
    description     text,
    is_active       boolean NOT NULL DEFAULT false,
    schedule_type   text CHECK (schedule_type IN ('manual', 'cron', 'webhook', 'event')),
    schedule_value  text,
    status          text NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle', 'running', 'error', 'paused')),
    created_by      uuid REFERENCES public.profiles(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    last_run_at     timestamptz,
    execution_count integer NOT NULL DEFAULT 0
);

-- ── Nodos de un flujo ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_nodes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id     uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    type            text NOT NULL CHECK (type IN ('trigger', 'connector', 'processor', 'output')),
    category        text NOT NULL,
    title           text NOT NULL,
    position_x      integer NOT NULL DEFAULT 0,
    position_y      integer NOT NULL DEFAULT 0,
    config_json     jsonb NOT NULL DEFAULT '{}',
    status          text NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle', 'running', 'success', 'error')),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Conexiones entre nodos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_connections (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id     uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    source_node_id  uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
    target_node_id  uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(source_node_id, target_node_id)
);

-- ── Log de ejecuciones ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.execution_logs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id     uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    node_id         uuid REFERENCES public.workflow_nodes(id) ON DELETE SET NULL,
    status          text NOT NULL CHECK (status IN ('success', 'error', 'warning', 'info')),
    message         text NOT NULL,
    details_json    jsonb,
    duration_ms     integer,
    executed_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Configuración de integraciones ───────────────────────────────────────
-- config_json contiene solo metadata NO sensible (URLs base, nombres de tablas)
-- Las API keys van en Supabase Secrets, nunca aquí
CREATE TABLE IF NOT EXISTS public.integrations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    system_name     text NOT NULL
                    CHECK (system_name IN ('riskguard', 'eeff', 'indicadores', 'legaltech')),
    config_json     jsonb NOT NULL DEFAULT '{}',
    is_active       boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(organization_id, system_name)
);

-- ── Índices de performance ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workflows_org ON public.workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow ON public.workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_workflow ON public.execution_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_org_date ON public.execution_logs(organization_id, executed_at DESC);

-- ── Trigger updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_workflows_updated
    BEFORE UPDATE ON public.workflows
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_integrations_updated
    BEFORE UPDATE ON public.integrations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
