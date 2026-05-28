-- Sprint S2: rama SI/NO para conexiones de nodos Decisión
ALTER TABLE workflow_connections
    ADD COLUMN IF NOT EXISTS branch TEXT CHECK (branch IN ('true', 'false'));

-- rollback: ALTER TABLE workflow_connections DROP COLUMN IF EXISTS branch;
