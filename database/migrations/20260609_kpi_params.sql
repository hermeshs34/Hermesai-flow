-- Parámetros KPI configurables por organización
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS kpi_sla_ms          integer NOT NULL DEFAULT 30000,
    ADD COLUMN IF NOT EXISTS kpi_min_por_tarea    integer NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS kpi_costo_hora_usd   integer NOT NULL DEFAULT 25;

COMMENT ON COLUMN public.organizations.kpi_sla_ms        IS 'Umbral SLA en milisegundos (default 30s)';
COMMENT ON COLUMN public.organizations.kpi_min_por_tarea IS 'Minutos ahorrados por tarea exitosa (default 15)';
COMMENT ON COLUMN public.organizations.kpi_costo_hora_usd IS 'Costo hora-hombre en USD para calcular ahorro (default 25)';

-- rollback:
-- ALTER TABLE public.organizations
--     DROP COLUMN IF EXISTS kpi_sla_ms,
--     DROP COLUMN IF EXISTS kpi_min_por_tarea,
--     DROP COLUMN IF EXISTS kpi_costo_hora_usd;
