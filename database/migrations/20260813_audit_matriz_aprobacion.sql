-- ═══════════════════════════════════════════════════════════════════════════
-- 20260813_audit_matriz_aprobacion.sql
--
-- La matriz de aprobación pasa a DECIDIR quién autoriza cada paso de un flujo
-- (execute-workflow la lee desde hoy; antes tenía CRUD completo en Gobierno y
-- no la leía ni una Edge Function). En cuanto una tabla gobierna un control
-- interno, tocarla tiene que dejar rastro.
--
-- `audit_log.entidad` tiene un CHECK cerrado y no admitía un valor para la
-- matriz. Sin esto, los INSERT de auditoría de Governance.tsx se rechazarían —
-- y como el audit es best-effort, se perderían en silencio, que es justo el
-- fallo que este proyecto lleva repitiendo.
--
-- ⚠️ YA APLICADA EN PRODUCCIÓN el 13/08/2026 y verificada contra el catálogo.
-- Este fichero queda para el registro y para poder rehacer el esquema desde
-- cero. Es idempotente: se puede volver a ejecutar sin efecto.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.audit_log
    DROP CONSTRAINT IF EXISTS audit_log_entidad_check;

ALTER TABLE public.audit_log
    ADD CONSTRAINT audit_log_entidad_check
    CHECK (entidad = ANY (ARRAY[
        'workflow',
        'usuario',
        'integracion',
        'aprobacion',
        'sesion',
        'matriz_aprobacion'
    ]));

COMMIT;

-- Comprobación (debe listar los seis valores):
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname = 'audit_log_entidad_check';
