-- ═══════════════════════════════════════════════════════════════════════════
-- HermesAI Flow — Esquema real de producción
-- Proyecto kbscaxcokxwdbnrltkup — regenerado el 02/08/2026
--
-- ESTE ARCHIVO DESCRIBE LO QUE HAY EN LA BASE, NO LO QUE DEBERÍA HABER.
--
-- La versión anterior se mantenía a mano y se declaraba "fuente de verdad".
-- No lo era: divergía de producción en más de treinta puntos y ninguno daba
-- error, porque todas las tablas se declaraban con CREATE TABLE IF NOT EXISTS
-- y una declaración posterior sobre una tabla que ya existe no hace nada.
-- Esa mentira silenciosa costó, entre el 11/06 y el 01/08/2026, un millón de
-- filas basura y 743 MB (cron-runner escribía contra columnas que solo
-- existían en este archivo), y dos meses de auditoría de aprobaciones perdida
-- (resolve-approval insertaba actor_id, columna inexistente).
--
-- Por eso ahora se usa CREATE TABLE a secas. Si este archivo se aplica sobre
-- una base donde el objeto ya existe, tiene que reventar: un fallo ruidoso es
-- barato, uno silencioso ya sabemos lo que cuesta.
--
-- CÓMO REGENERARLO
--   Opción A (preferible, pg_dump real):
--     supabase link --project-ref kbscaxcokxwdbnrltkup
--     supabase db dump --linked --schema public --keep-comments -f database/schema.sql
--     (la conexión directa es solo IPv6; link configura el pooler IPv4)
--   Opción B: consultar pg_attribute / pg_constraint / pg_indexes / pg_policies
--     y reconstruir, que es como se hizo esta versión.
--
-- REGLA: antes de escribir una columna desde una Edge Function, comprobarla
-- contra la base, no contra este archivo. Y comprobar siempre el { error } que
-- devuelve supabase-js: no lanza excepción, la devuelve, y si nadie la lee el
-- fallo se convierte en silencio.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensiones ───────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══ TABLAS ════════════════════════════════════════════════════════════════

-- ── Organizaciones (tenant raíz) ──────────────────────────────────────────
CREATE TABLE public.organizations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text NOT NULL,
    slug                text NOT NULL UNIQUE,
    plan                text NOT NULL DEFAULT 'free'
                        CHECK (plan IN ('free', 'pro', 'enterprise')),
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- F2.2: preferencias de notificación
    notif_email         text,
    notif_errors        boolean NOT NULL DEFAULT true,
    notif_success       boolean NOT NULL DEFAULT false,
    -- F4: parámetros KPI configurables
    kpi_sla_ms          integer NOT NULL DEFAULT 30000,
    kpi_min_por_tarea   integer NOT NULL DEFAULT 15,
    kpi_costo_hora_usd  integer NOT NULL DEFAULT 25
);

COMMENT ON COLUMN public.organizations.kpi_sla_ms          IS 'Umbral SLA en milisegundos (default 30s)';
COMMENT ON COLUMN public.organizations.kpi_min_por_tarea   IS 'Minutos ahorrados por tarea exitosa (default 15)';
COMMENT ON COLUMN public.organizations.kpi_costo_hora_usd  IS 'Costo hora-hombre en USD para calcular ahorro (default 25)';

-- ── Perfiles de usuario ───────────────────────────────────────────────────
-- Roles BPM (F1) + roles legacy, que siguen en uso por usuarios existentes.
-- El DEFAULT real es 'viewer'. Este archivo decía 'operador' — nunca se aplicó.
CREATE TABLE public.profiles (
    id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email               text NOT NULL,
    name                text NOT NULL,
    role                text NOT NULL DEFAULT 'viewer'
                        CHECK (role IN (
                            -- Roles BPM F1
                            'admin', 'dueno_proceso', 'supervisor', 'operador',
                            'autorizador', 'cumplimiento', 'auditor',
                            -- Roles legacy: no ofrecer en UI, mantener compatibilidad
                            'editor', 'operator', 'viewer'
                        )),
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Flujos de trabajo ─────────────────────────────────────────────────────
-- OJO: status NO admite 'active' en producción, aunque este archivo lo
-- declaraba. Si algo intenta escribir 'active', falla.
CREATE TABLE public.workflows (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name                text NOT NULL,
    description         text,
    is_active           boolean NOT NULL DEFAULT false,
    schedule_type       text CHECK (schedule_type IN ('manual', 'cron', 'webhook', 'event')),
    schedule_value      text,
    status              text NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle', 'running', 'error', 'paused')),
    created_by          uuid REFERENCES public.profiles(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    last_run_at         timestamptz,
    execution_count     integer NOT NULL DEFAULT 0
);

-- ── Nodos de un flujo ─────────────────────────────────────────────────────
CREATE TABLE public.workflow_nodes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id         uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    type                text NOT NULL CHECK (type IN ('trigger', 'connector', 'processor', 'output')),
    category            text NOT NULL,
    title               text NOT NULL,
    position_x          integer NOT NULL DEFAULT 0,
    position_y          integer NOT NULL DEFAULT 0,
    config_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
    status              text NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle', 'running', 'success', 'error')),
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Conexiones entre nodos ────────────────────────────────────────────────
CREATE TABLE public.workflow_connections (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id         uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    source_node_id      uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
    target_node_id      uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- Rama del nodo Decisión: 'true' = SI, 'false' = NO, NULL = sin condición
    branch              text CHECK (branch IN ('true', 'false')),
    UNIQUE (source_node_id, target_node_id)
);

-- ── Ejecuciones (raíz de cada run) ────────────────────────────────────────
-- status NO tiene CHECK en producción. Se documentan aquí los valores que
-- escribe el código —execute-workflow, cron-runner, resolve-approval— pero la
-- base acepta cualquier texto. Añadir el CHECK exige incluir 'rechazado' y
-- 'pending', que también se usan.
CREATE TABLE public.execution_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    workflow_id         uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    triggered_by        text NOT NULL DEFAULT 'manual',   -- manual | cron | webhook | approval
    status              text NOT NULL DEFAULT 'running',  -- running | success | error | esperando_aprobacion | rechazado | pending
    started_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    duration_ms         integer,
    error_message       text,
    logs_count          integer NOT NULL DEFAULT 0,
    created_by          uuid REFERENCES public.profiles(id),
    -- Estado persistido para reanudar tras una aprobación
    context_json        jsonb,
    completed_node_ids  text[] DEFAULT '{}'::text[],
    -- text, no uuid, y sin FK: guarda el id de nodo tal como lo maneja el
    -- canvas. Este archivo lo declaraba uuid REFERENCES workflow_nodes.
    paused_node_id      text
);

-- ── Log de ejecuciones (detalle por nodo) ─────────────────────────────────
CREATE TABLE public.execution_logs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id         uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    node_id             uuid REFERENCES public.workflow_nodes(id) ON DELETE SET NULL,
    status              text NOT NULL CHECK (status IN ('success', 'error', 'warning', 'info')),
    message             text NOT NULL,
    details_json        jsonb,
    duration_ms         integer,
    executed_at         timestamptz NOT NULL DEFAULT now(),
    execution_run_id    uuid REFERENCES public.execution_runs(id) ON DELETE CASCADE
);

-- ── Integraciones ─────────────────────────────────────────────────────────
-- config_json solo lleva metadata NO sensible (URLs base, nombres de tablas).
-- Las API keys van en Supabase Secrets, nunca aquí.
CREATE TABLE public.integrations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    system_name         text NOT NULL
                        CHECK (system_name IN ('riskguard', 'eeff', 'indicadores', 'legaltech')),
    config_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active           boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, system_name)
);

-- ── Audit Log (F1) ────────────────────────────────────────────────────────
-- Los dos CHECK los aplicó 20260801_alinear_esquema_real.sql. Antes la tabla
-- no tenía ninguno: la creó 20260531_f1_gobierno.sql sin ellos y este archivo
-- los declaraba en vano.
-- La columna de actor es usuario_id. No existe actor_id: resolve-approval lo
-- usaba y por eso ninguna resolución de aprobación se auditó desde F2.
CREATE TABLE public.audit_log (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    usuario_id          uuid REFERENCES public.profiles(id),
    usuario_email       text,
    accion              text NOT NULL
                        CHECK (accion IN ('crear', 'modificar', 'eliminar', 'ejecutar',
                                          'aprobar', 'rechazar', 'login', 'cambio_rol',
                                          'escalamiento', 'vencimiento')),
    entidad             text NOT NULL
                        CHECK (entidad IN ('workflow', 'usuario', 'integracion',
                                           'aprobacion', 'sesion')),
    entidad_id          uuid,
    descripcion         text,
    datos_antes         jsonb,
    datos_despues       jsonb,
    ip_address          text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Tareas de Aprobación (F2 + escalamiento F4) ───────────────────────────
-- node_id es text NOT NULL y sin FK, no uuid: guarda el id del nodo tal como
-- lo maneja el canvas. solicitante_id y aprobador_id tampoco tienen FK.
-- Y organization_id tampoco: es la ÚNICA tabla de negocio cuyo organization_id
-- no referencia organizations. Borrar una organización deja aquí filas
-- huérfanas, y nada impide escribir un organization_id inexistente. El
-- aislamiento depende por completo de la política RLS de más abajo.
CREATE TABLE public.tareas_aprobacion (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         uuid NOT NULL,
    workflow_id             uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    execution_run_id        uuid NOT NULL REFERENCES public.execution_runs(id) ON DELETE CASCADE,
    node_id                 text NOT NULL,
    node_title              text,
    solicitante_id          uuid,
    rol_aprobador           text NOT NULL,
    aprobador_id            uuid,
    monto                   numeric,
    categoria               text,
    descripcion             text,
    -- 'expirado', no 'vencido'. Y la columna de cierre es resolved_at, no
    -- resuelto_at. cron-runner usaba los nombres equivocados: el UPDATE fallaba
    -- en silencio, la tarea seguía 'pendiente' con vence_at pasado y el cron la
    -- reprocesaba cada minuto durante 51 días.
    estado                  text NOT NULL DEFAULT 'pendiente'
                            CHECK (estado IN ('pendiente', 'aprobado', 'rechazado',
                                              'devuelto', 'expirado')),
    comentario              text,
    vence_at                timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    resolved_at             timestamptz,
    -- F4: escalamiento automático
    nivel_escalamiento      integer NOT NULL DEFAULT 0,
    escalado_at             timestamptz,
    rol_aprobador_original  text
);

-- ── Matriz de Aprobación (F3.3) ───────────────────────────────────────────
-- umbral_monto y moneda son NULLABLE en producción, pese a llevar DEFAULT.
CREATE TABLE public.matriz_aprobacion (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    nombre                  text NOT NULL,
    categoria               text,
    umbral_monto            numeric DEFAULT 0,
    moneda                  text DEFAULT 'USD',
    rol_aprobador           text NOT NULL,
    nivel                   integer NOT NULL DEFAULT 1,
    activa                  boolean NOT NULL DEFAULT true,
    created_at              timestamptz NOT NULL DEFAULT now(),
    created_by              uuid REFERENCES public.profiles(id),
    operador                text NOT NULL DEFAULT '>='
                            CHECK (operador IN ('>=', '>', '<=', '<', '==', 'entre')),
    umbral_max              numeric,
    condicion_extra         text,
    aprobadores_multiples   integer NOT NULL DEFAULT 1
                            CHECK (aprobadores_multiples >= 1 AND aprobadores_multiples <= 5),
    escalamiento_horas      integer NOT NULL DEFAULT 48,
    aplica_automatico       boolean NOT NULL DEFAULT false,
    descripcion_regulatoria text,
    -- Métricas de uso
    veces_activada          integer NOT NULL DEFAULT 0,
    aprobaciones_count      integer NOT NULL DEFAULT 0,
    rechazos_count          integer NOT NULL DEFAULT 0,
    tiempo_promedio_hs      numeric
);

COMMENT ON COLUMN public.matriz_aprobacion.operador                 IS '>= | > | <= | < | == | entre (rango umbral_monto..umbral_max)';
COMMENT ON COLUMN public.matriz_aprobacion.aprobadores_multiples    IS 'Cuántos aprobadores distintos deben autorizar (doble control = 2)';
COMMENT ON COLUMN public.matriz_aprobacion.aplica_automatico        IS 'Si true, el Agente IA puede decidir sin aprobador humano';
COMMENT ON COLUMN public.matriz_aprobacion.descripcion_regulatoria  IS 'Referencia normativa: SUDEBAN Circular 7, OFAC 50% Rule, etc.';

-- ── Delegaciones (F1 — suplencias de aprobador) ───────────────────────────
-- Tabla que este archivo no declaraba en absoluto, pese a llevar en producción
-- desde 20260531_f1_gobierno.sql.
CREATE TABLE public.delegaciones (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    usuario_id          uuid NOT NULL REFERENCES public.profiles(id),
    suplente_id         uuid NOT NULL REFERENCES public.profiles(id),
    desde               timestamptz NOT NULL,
    hasta               timestamptz NOT NULL,
    motivo              text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ═══ ÍNDICES ═══════════════════════════════════════════════════════════════
CREATE INDEX idx_workflows_org               ON public.workflows (organization_id);
CREATE INDEX idx_workflow_nodes_workflow     ON public.workflow_nodes (workflow_id);
CREATE INDEX idx_execution_runs_workflow     ON public.execution_runs (workflow_id);
CREATE INDEX idx_execution_runs_org          ON public.execution_runs (organization_id, started_at DESC);
CREATE INDEX idx_execution_logs_run          ON public.execution_logs (execution_run_id);
CREATE INDEX idx_execution_logs_workflow     ON public.execution_logs (workflow_id);
CREATE INDEX idx_execution_logs_org_date     ON public.execution_logs (organization_id, executed_at DESC);
CREATE INDEX idx_audit_org_date              ON public.audit_log (organization_id, created_at DESC);
CREATE INDEX idx_audit_entidad               ON public.audit_log (entidad, entidad_id);
CREATE INDEX idx_tareas_aprobacion_estado    ON public.tareas_aprobacion (organization_id, estado);
CREATE INDEX idx_tareas_aprobacion_rol       ON public.tareas_aprobacion (organization_id, rol_aprobador, estado);
CREATE INDEX idx_tareas_aprobacion_run       ON public.tareas_aprobacion (execution_run_id);
CREATE INDEX idx_matriz_org                  ON public.matriz_aprobacion (organization_id, nivel);

-- ═══ FUNCIONES HELPER ══════════════════════════════════════════════════════
-- Hubo dos funciones idénticas, my_org_id() y my_organization_id(), nacidas de
-- migraciones distintas, y las políticas usaban una u otra sin criterio.
-- Unificadas en my_organization_id() el 02/08/2026 por la migración
-- 20260803_unificar_my_organization_id.sql: my_org_id() ya no existe.

CREATE OR REPLACE FUNCTION public.my_organization_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ═══ TRIGGERS ══════════════════════════════════════════════════════════════
CREATE TRIGGER trg_workflows_updated
    BEFORE UPDATE ON public.workflows
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_integrations_updated
    BEFORE UPDATE ON public.integrations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══ RLS ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_nodes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tareas_aprobacion    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matriz_aprobacion    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delegaciones         ENABLE ROW LEVEL SECURITY;

-- ═══ POLÍTICAS ═════════════════════════════════════════════════════════════
-- Transcritas de pg_policies. Los nombres son los reales, que no coinciden con
-- los que declaraba la versión anterior de este archivo.

-- organizations
CREATE POLICY org_read_own ON public.organizations
    FOR SELECT TO authenticated
    USING (id = public.my_organization_id());

CREATE POLICY org_admin_update ON public.organizations
    FOR UPDATE TO authenticated
    USING      (id = public.my_organization_id() AND public.my_role() = 'admin')
    WITH CHECK (id = public.my_organization_id() AND public.my_role() = 'admin');

-- profiles
CREATE POLICY profiles_read_own_org ON public.profiles
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY profiles_admin_manage ON public.profiles
    FOR ALL TO authenticated
    USING      (organization_id = public.my_organization_id() AND public.is_admin())
    WITH CHECK (organization_id = public.my_organization_id() AND public.is_admin());

-- workflows
CREATE POLICY workflows_tenant_read ON public.workflows
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY workflows_editor_write ON public.workflows
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id()
                AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor'));

CREATE POLICY workflows_editor_update ON public.workflows
    FOR UPDATE TO authenticated
    USING      (organization_id = public.my_organization_id()
                AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'))
    WITH CHECK (organization_id = public.my_organization_id()
                AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

CREATE POLICY workflows_admin_delete ON public.workflows
    FOR DELETE TO authenticated
    USING (organization_id = public.my_organization_id() AND public.my_role() = 'admin');

-- workflow_nodes
CREATE POLICY nodes_tenant_read ON public.workflow_nodes
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY nodes_editor_write ON public.workflow_nodes
    FOR ALL TO authenticated
    USING      (organization_id = public.my_organization_id()
                AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'))
    WITH CHECK (organization_id = public.my_organization_id()
                AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

-- workflow_connections
CREATE POLICY connections_tenant_read ON public.workflow_connections
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.workflows w
                   WHERE w.id = workflow_connections.workflow_id
                     AND w.organization_id = public.my_organization_id()));

CREATE POLICY connections_editor_write ON public.workflow_connections
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM public.workflows w
                        WHERE w.id = workflow_connections.workflow_id
                          AND w.organization_id = public.my_organization_id())
                AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w
                        WHERE w.id = workflow_connections.workflow_id
                          AND w.organization_id = public.my_organization_id())
                AND public.my_role() IN ('admin', 'editor', 'dueno_proceso', 'supervisor', 'operador', 'operator'));

-- execution_runs
CREATE POLICY runs_tenant_read ON public.execution_runs
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY runs_system_insert ON public.execution_runs
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id());

-- Sin WITH CHECK: se puede mover una fila fuera de la propia organización.
CREATE POLICY runs_system_update ON public.execution_runs
    FOR UPDATE TO authenticated
    USING (organization_id = public.my_organization_id());

-- execution_logs
CREATE POLICY logs_tenant_read ON public.execution_logs
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY logs_system_insert ON public.execution_logs
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id());

-- audit_log
-- Hasta el 03/08/2026 esta política solo comprobaba organization_id: cualquier
-- usuario autenticado de la organización, incluido un 'viewer', leía la
-- auditoría completa. El archivo afirmaba desde F1 que estaba restringida, pero
-- esa política nunca llegó a existir. Cerrado por
-- 20260803_audit_read_por_rol.sql.
-- La lista de roles es la del permiso 'view_audit' de src/core/user.types.ts.
-- Si cambia una, tiene que cambiar la otra: son la misma decisión.
CREATE POLICY audit_read_org ON public.audit_log
    FOR SELECT TO authenticated
    USING (
        organization_id = public.my_organization_id()
        AND public.my_role() IN ('admin', 'dueno_proceso', 'cumplimiento', 'auditor')
    );

CREATE POLICY audit_insert ON public.audit_log
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_organization_id());

-- tareas_aprobacion
-- Única política de la tabla, y la única concedida a `public` (que incluye
-- anon) en vez de a `authenticated`. En la práctica anon no pasa:
-- my_organization_id() devuelve NULL sin perfil y la comparación no da ninguna fila.
CREATE POLICY org_isolation ON public.tareas_aprobacion
    FOR ALL TO public
    USING (organization_id = public.my_organization_id());

-- matriz_aprobacion
CREATE POLICY matriz_read_org ON public.matriz_aprobacion
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY matriz_admin_write ON public.matriz_aprobacion
    FOR ALL TO authenticated
    USING      (organization_id = public.my_organization_id() AND public.is_admin())
    WITH CHECK (organization_id = public.my_organization_id() AND public.is_admin());

-- integrations
CREATE POLICY integrations_tenant_read ON public.integrations
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY integrations_admin_manage ON public.integrations
    FOR ALL TO authenticated
    USING      (organization_id = public.my_organization_id() AND public.my_role() = 'admin')
    WITH CHECK (organization_id = public.my_organization_id() AND public.my_role() = 'admin');

-- delegaciones
CREATE POLICY deleg_read_org ON public.delegaciones
    FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

CREATE POLICY deleg_write ON public.delegaciones
    FOR ALL TO authenticated
    USING      (organization_id = public.my_organization_id()
                AND (public.is_admin() OR usuario_id = auth.uid()))
    WITH CHECK (organization_id = public.my_organization_id()
                AND (public.is_admin() OR usuario_id = auth.uid()));
