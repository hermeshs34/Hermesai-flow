-- F3.3 — Matriz de Autorización mejorada
-- Nuevas columnas: operador, umbral_max, condicion_extra, aprobadores_multiples,
--                  escalamiento_horas, aplica_automatico, descripcion_regulatoria,
--                  métricas de uso

ALTER TABLE public.matriz_aprobacion
  ADD COLUMN IF NOT EXISTS operador             text    NOT NULL DEFAULT '>='
      CHECK (operador IN ('>=', '>', '<=', '<', '==', 'entre')),
  ADD COLUMN IF NOT EXISTS umbral_max           numeric,
  ADD COLUMN IF NOT EXISTS condicion_extra      text,
  ADD COLUMN IF NOT EXISTS aprobadores_multiples int    NOT NULL DEFAULT 1
      CHECK (aprobadores_multiples BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS escalamiento_horas   int     NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS aplica_automatico    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS descripcion_regulatoria text,
  -- métricas de uso (actualizadas por trigger / Edge Function)
  ADD COLUMN IF NOT EXISTS veces_activada       int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aprobaciones_count   int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rechazos_count        int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tiempo_promedio_hs   numeric;

COMMENT ON COLUMN public.matriz_aprobacion.operador             IS '>= | > | <= | < | == | entre (rango umbral_monto..umbral_max)';
COMMENT ON COLUMN public.matriz_aprobacion.aprobadores_multiples IS 'Cuántos aprobadores distintos deben autorizar (doble control = 2)';
COMMENT ON COLUMN public.matriz_aprobacion.aplica_automatico    IS 'Si true, el Agente IA puede decidir sin aprobador humano';
COMMENT ON COLUMN public.matriz_aprobacion.descripcion_regulatoria IS 'Referencia normativa: SUDEBAN Circular 7, OFAC 50% Rule, etc.';

-- rollback:
-- ALTER TABLE public.matriz_aprobacion
--   DROP COLUMN IF EXISTS operador,
--   DROP COLUMN IF EXISTS umbral_max,
--   DROP COLUMN IF EXISTS condicion_extra,
--   DROP COLUMN IF EXISTS aprobadores_multiples,
--   DROP COLUMN IF EXISTS escalamiento_horas,
--   DROP COLUMN IF EXISTS aplica_automatico,
--   DROP COLUMN IF EXISTS descripcion_regulatoria,
--   DROP COLUMN IF EXISTS veces_activada,
--   DROP COLUMN IF EXISTS aprobaciones_count,
--   DROP COLUMN IF EXISTS rechazos_count,
--   DROP COLUMN IF EXISTS tiempo_promedio_hs;
