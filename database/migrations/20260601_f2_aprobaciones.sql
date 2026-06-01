-- F2 Aprobaciones Reales — Human-in-the-loop
-- Ejecutar en Supabase SQL Editor del proyecto HermesAI Flow (kbscaxcokxwdbnrltkup)

-- 1. Tabla de tareas de aprobación
CREATE TABLE IF NOT EXISTS tareas_aprobacion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL,
    workflow_id         UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    execution_run_id    UUID NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
    node_id             TEXT NOT NULL,
    node_title          TEXT,
    solicitante_id      UUID,                          -- auth.uid() del usuario que disparó el flujo
    rol_aprobador       TEXT NOT NULL,                 -- rol requerido para aprobar (de matriz_aprobacion)
    aprobador_id        UUID,                          -- auth.uid() del aprobador (se llena al resolver)
    monto               NUMERIC,
    categoria           TEXT,
    descripcion         TEXT,
    estado              TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','aprobado','rechazado','devuelto','expirado')),
    comentario          TEXT,
    vence_at            TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ
);

-- 2. Columnas para reanudación en execution_runs
ALTER TABLE execution_runs
    ADD COLUMN IF NOT EXISTS context_json       JSONB,
    ADD COLUMN IF NOT EXISTS completed_node_ids TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS paused_node_id     TEXT;

-- Nuevo estado permitido para execution_runs (si tiene CHECK constraint, ampliarlo)
-- Si la columna status no tiene constraint, esto no es necesario.
-- ALTER TABLE execution_runs DROP CONSTRAINT IF EXISTS execution_runs_status_check;
-- ALTER TABLE execution_runs ADD CONSTRAINT execution_runs_status_check
--     CHECK (status IN ('running','success','error','esperando_aprobacion','rechazado'));

-- 3. RLS para tareas_aprobacion
ALTER TABLE tareas_aprobacion ENABLE ROW LEVEL SECURITY;

-- Solo miembros de la misma organización pueden ver tareas
CREATE POLICY "org_isolation" ON tareas_aprobacion
    FOR ALL
    USING (organization_id = my_org_id());

-- 4. Índices
CREATE INDEX IF NOT EXISTS idx_tareas_aprobacion_run    ON tareas_aprobacion(execution_run_id);
CREATE INDEX IF NOT EXISTS idx_tareas_aprobacion_estado ON tareas_aprobacion(organization_id, estado);
CREATE INDEX IF NOT EXISTS idx_tareas_aprobacion_rol    ON tareas_aprobacion(organization_id, rol_aprobador, estado);

-- rollback:
-- DROP TABLE IF EXISTS tareas_aprobacion;
-- ALTER TABLE execution_runs DROP COLUMN IF EXISTS context_json;
-- ALTER TABLE execution_runs DROP COLUMN IF EXISTS completed_node_ids;
-- ALTER TABLE execution_runs DROP COLUMN IF EXISTS paused_node_id;
