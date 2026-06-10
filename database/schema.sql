-- ═══════════════════════════════════════════════════════════════════════════
-- HermesAI Flow — Schema Principal (fuente de verdad)
-- Última actualización: 10 Junio 2026
-- Sincronizado con migraciones: 20260528_branch_column, 20260528_execution_runs,
--   20260531_f1_gobierno, 20260601_f2_aprobaciones, 20260601_f2_timeout_cron,
--   20260601_fix_rls_*, 20260601_notification_settings, 20260601_org_update_policy,
--   20260602_f3_matriz_autorización, 20260602_rol_cumplimiento, 20260609_kpi_params
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensiones requeridas ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Organizaciones (tenant raíz) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    slug            text NOT NULL UNIQUE,
    plan            text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- F2.2: Preferencias de notificación por organización
    notif_email     text,
    notif_errors    boolean NOT NULL DEFAULT true,
    notif_success   boolean NOT NULL DEFAULT false,
    -- F4: Parámetros KPI configurables
    kpi_sla_ms          integer NOT NULL DEFAULT 30000,
    kpi_min_por_tarea   integer NOT NULL DEFAULT 15,
    kpi_costo_hora_usd  integer NOT NULL DEFAULT 25
);

COMMENT ON COLUMN public.organizations.kpi_sla_ms        IS 'Umbral SLA en milisegundos (default 30s)';
COMMENT ON COLUMN public.organizations.kpi_min_por_tarea IS 'Minutos ahorrados por tarea exitosa (default 15)';
COMMENT ON COLUMN public.organizations.kpi_costo_hora_usd IS 'Costo hora-hombre en USD para calcular ahorro (default 25)';

-- ── Perfiles de usuario ───────────────────────────────────────────────────
-- Roles BPM (F1) + roles legacy (compatibilidad con usuarios existentes)
CREATE TABLE IF NOT EXISTS public.profiles (
    id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email           text NOT NULL,
    name            text NOT NULL,
    role            text NOT NULL DEFAULT 'operador'
                    CHECK (role IN (
                        -- Roles BPM F1
                        'admin', 'dueno_proceso', 'supervisor', 'operador',
                        'autorizador', 'cumplimiento', 'auditor',
                        -- Roles legacy (no ofrecer en UI pero mantener compatibilidad)
                        'editor', 'operator', 'viewer'
                    )),
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
                    CHECK (status IN ('idle', 'active', 'running', 'error', 'paused')),
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
    -- branch: rama del nodo Decisión ('true' = SI, 'false' = NO, NULL = sin condición)
    branch          text CHECK (branch IN ('true', 'false')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(source_node_id, target_node_id)
);

-- ── Registro de ejecuciones (raíz de cada run) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.execution_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    workflow_id         uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    triggered_by        text NOT NULL DEFAULT 'manual',  -- email | 'cron' | 'webhook' | 'approval'
    status              text NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'success', 'error', 'esperando_aprobacion', 'cancelled')),
    started_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    duration_ms         integer,
    logs_count          integer NOT NULL DEFAULT 0,
    error_message       text,
    -- Estado persistido para reanudación post-aprobación
    context_json        jsonb,
    completed_node_ids  text[],
    paused_node_id      uuid REFERENCES public.workflow_nodes(id) ON DELETE SET NULL
);

-- ── Log de ejecuciones (detalle por nodo) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.execution_logs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id         uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    execution_run_id    uuid REFERENCES public.execution_runs(id) ON DELETE CASCADE,
    node_id             uuid REFERENCES public.workflow_nodes(id) ON DELETE SET NULL,
    status              text NOT NULL CHECK (status IN ('success', 'error', 'warning', 'info')),
    message             text NOT NULL,
    details_json        jsonb,
    duration_ms         integer,
    executed_at         timestamptz NOT NULL DEFAULT now()
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

-- ── Audit Log (F1 — inmutable) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    usuario_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    usuario_email   text,
    accion          text NOT NULL
                    CHECK (accion IN ('crear', 'modificar', 'eliminar', 'ejecutar', 'aprobar', 'rechazar', 'login', 'cambio_rol')),
    entidad         text NOT NULL
                    CHECK (entidad IN ('workflow', 'usuario', 'integracion', 'aprobacion', 'sesion')),
    entidad_id      uuid,
    descripcion     text,
    datos_antes     jsonb,
    datos_despues   jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Tareas de Aprobación (F2 — bandeja de aprobadores) ───────────────────
CREATE TABLE IF NOT EXISTS public.tareas_aprobacion (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    workflow_id         uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    execution_run_id    uuid NOT NULL REFERENCES public.execution_runs(id) ON DELETE CASCADE,
    node_id             uuid REFERENCES public.workflow_nodes(id) ON DELETE SET NULL,
    node_title          text,
    solicitante_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    aprobador_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    rol_aprobador       text NOT NULL,
    descripcion         text,
    monto               numeric,
    categoria           text,
    estado              text NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'vencido')),
    comentario          text,
    vence_at            timestamptz,
    resuelto_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Matriz de Aprobación (F3.3 — umbrales y aprobadores) ─────────────────
CREATE TABLE IF NOT EXISTS public.matriz_aprobacion (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    nombre                  text NOT NULL,
    categoria               text,
    operador                text NOT NULL DEFAULT '>='
                            CHECK (operador IN ('>=', '>', '<=', '<', '==', 'entre')),
    umbral_monto            numeric NOT NULL DEFAULT 0,
    umbral_max              numeric,
    moneda                  text NOT NULL DEFAULT 'USD',
    rol_aprobador           text NOT NULL,
    nivel                   integer NOT NULL DEFAULT 1,
    activa                  boolean NOT NULL DEFAULT true,
    condicion_extra         text,
    aprobadores_multiples   integer NOT NULL DEFAULT 1
                            CHECK (aprobadores_multiples BETWEEN 1 AND 5),
    escalamiento_horas      integer NOT NULL DEFAULT 48,
    aplica_automatico       boolean NOT NULL DEFAULT false,
    descripcion_regulatoria text,
    -- Métricas de uso (actualizadas por trigger / Edge Function)
    veces_activada          integer NOT NULL DEFAULT 0,
    aprobaciones_count      integer NOT NULL DEFAULT 0,
    rechazos_count          integer NOT NULL DEFAULT 0,
    tiempo_promedio_hs      numeric,
    created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.matriz_aprobacion.operador             IS '>= | > | <= | < | == | entre (rango umbral_monto..umbral_max)';
COMMENT ON COLUMN public.matriz_aprobacion.aprobadores_multiples IS 'Cuántos aprobadores distintos deben autorizar (doble control = 2)';
COMMENT ON COLUMN public.matriz_aprobacion.aplica_automatico    IS 'Si true, el Agente IA puede decidir sin aprobador humano';
COMMENT ON COLUMN public.matriz_aprobacion.descripcion_regulatoria IS 'Referencia normativa: SUDEBAN Circular 7, OFAC 50% Rule, etc.';

-- ── Índices de performance ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workflows_org            ON public.workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow  ON public.workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_workflow  ON public.execution_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_org_date ON public.execution_runs(organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_logs_run      ON public.execution_logs(execution_run_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_workflow  ON public.execution_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_org_date ON public.execution_logs(organization_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_date      ON public.audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tareas_org_estado       ON public.tareas_aprobacion(organization_id, estado);
CREATE INDEX IF NOT EXISTS idx_tareas_run              ON public.tareas_aprobacion(execution_run_id);
CREATE INDEX IF NOT EXISTS idx_matriz_org              ON public.matriz_aprobacion(organization_id);

-- ── Función helper: my_organization_id() ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_organization_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ── Función helper: my_role() ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

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

-- ── RLS: habilitar en todas las tablas ───────────────────────────────────
ALTER TABLE public.organizations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_nodes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tareas_aprobacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matriz_aprobacion ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies básicas de aislamiento multi-tenant ─────────────────────
-- NOTA: Las políticas detalladas de escritura por rol están en database/policies/
--       Las migraciones fix_rls_* añaden políticas granulares por operación.

-- organizations: todos leen la propia, admin puede actualizar
CREATE POLICY "org_read" ON public.organizations
    FOR SELECT TO authenticated
    USING (id = public.my_organization_id());

CREATE POLICY "org_admin_update" ON public.organizations
    FOR UPDATE TO authenticated
    USING (id = public.my_organization_id() AND public.my_role() = 'admin')
    WITH CHECK (id = public.my_organization_id() AND public.my_role() = 'admin');

-- profiles: leen los de su organización
CREATE POLICY "profiles_read" ON public.profiles
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

-- workflows: todos los autenticados leen los de su org
CREATE POLICY "workflows_read" ON public.workflows
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "workflows_editor_write" ON public.workflows
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor'));

CREATE POLICY "workflows_editor_update" ON public.workflows
    FOR UPDATE TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

CREATE POLICY "workflows_admin_delete" ON public.workflows
    FOR DELETE TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() = 'admin');

-- workflow_nodes / connections: todos los roles BPM
CREATE POLICY "nodes_read" ON public.workflow_nodes
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "nodes_editor_write" ON public.workflow_nodes
    FOR ALL TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.id = workflow_id AND w.organization_id = public.my_organization_id()
    ) AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

CREATE POLICY "connections_read" ON public.workflow_connections
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.workflows w
        WHERE w.id = workflow_id AND w.organization_id = public.my_organization_id()
    ));

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

-- execution_runs / execution_logs: todos los roles leen su org
CREATE POLICY "runs_read" ON public.execution_runs
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "logs_read" ON public.execution_logs
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

-- audit_log: solo admin y auditor
CREATE POLICY "audit_read" ON public.audit_log
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'auditor', 'cumplimiento'));

-- tareas_aprobacion: todos los roles con 'approve_tasks' pueden ver y actualizar las suyas
CREATE POLICY "tareas_read" ON public.tareas_aprobacion
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

-- matriz_aprobacion: todos leen, admin gestiona
CREATE POLICY "matriz_read" ON public.matriz_aprobacion
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "matriz_admin_write" ON public.matriz_aprobacion
    FOR ALL TO authenticated
    USING (organization_id = public.my_organization_id() AND public.my_role() = 'admin')
    WITH CHECK (organization_id = public.my_organization_id() AND public.my_role() = 'admin');

-- integrations: solo admin gestiona
CREATE POLICY "integrations_read" ON public.integrations
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY "integrations_admin_write" ON public.integrations
    FOR ALL TO authenticated
    USING (organization_id = public.my_organization_id() AND public.my_role() = 'admin')
    WITH CHECK (organization_id = public.my_organization_id() AND public.my_role() = 'admin');
