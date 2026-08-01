-- ═══════════════════════════════════════════════════════════════════════════
-- Alinear el esquema declarado con el que hay en producción
-- Proyecto kbscaxcokxwdbnrltkup — 01/08/2026
--
-- CONTEXTO
-- schema.sql declaraba audit_log con dos CHECK que la base nunca tuvo: la tabla
-- la creó 20260531_f1_gobierno.sql sin ellos, y como schema.sql usa
-- CREATE TABLE IF NOT EXISTS, la declaración posterior no se aplicó nunca.
-- La discrepancia no dio error jamás — simplemente no existía la restricción.
--
-- El mismo patrón, en tareas_aprobacion, sí costó caro: schema.sql decía
-- estado 'vencido' y columna resuelto_at; la tabla real (20260601_f2_aprobaciones)
-- tiene 'expirado' y resolved_at. cron-runner se escribió contra la versión
-- declarada, su UPDATE falló en silencio, la tarea siguió en 'pendiente' y el
-- cron la reprocesó cada minuto durante 51 días: 1.005.828 filas basura en
-- audit_log y otras tantas en execution_logs, 743 MB, sobre 14 tareas.
-- Esa parte se corrigió en el código (cron-runner) y en schema.sql.
--
-- Esta migración cierra el agujero que queda: poner en la base los CHECK de
-- audit_log, para que un valor no contemplado falle de inmediato y a la vista
-- en lugar de colarse.
--
-- NOTA: no usar "$$" en comentarios — el SQL Editor de Supabase los interpreta
-- como apertura de dollar-quote aunque estén comentados y rompe el parseo.
--
-- ESTADO: APLICADA en producción el 01/08/2026 vía Management API. La
-- comprobación previa del paso 1 devolvió cero filas: los 8 pares
-- accion/entidad que existían caben en las listas.
--
-- Un tercer caso del mismo patrón salió a la luz al revisar esta tabla:
-- resolve-approval insertaba usuario_id bajo el nombre actor_id, columna que
-- no existe. El INSERT se rechazaba, el error no se leía y ninguna resolución
-- de aprobación quedó auditada desde F2 — audit_log no tenía ni una sola fila
-- 'aprobar' ni 'rechazar'. Corregido en la Edge Function, no requiere DDL.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Comprobación previa: ¿hay filas que violarían los CHECK? ─────────────
-- Si esto devuelve algo, resolver esas filas ANTES de seguir.
SELECT 'accion' AS columna, accion AS valor_no_contemplado, count(*) AS filas
FROM   public.audit_log
WHERE  accion NOT IN ('crear','modificar','eliminar','ejecutar','aprobar',
                      'rechazar','login','cambio_rol','escalamiento','vencimiento')
GROUP  BY accion
UNION ALL
SELECT 'entidad', entidad, count(*)
FROM   public.audit_log
WHERE  entidad NOT IN ('workflow','usuario','integracion','aprobacion','sesion')
GROUP  BY entidad;

-- ── 2. Aplicar los CHECK ────────────────────────────────────────────────────
-- 'escalamiento' y 'vencimiento' los escribe cron-runner y faltaban en la lista
-- original de schema.sql. Van incluidos: si se omitieran, el escalamiento F4
-- dejaría de registrar auditoría en cuanto la restricción existiera de verdad.
ALTER TABLE public.audit_log
    DROP CONSTRAINT IF EXISTS audit_log_accion_check;
ALTER TABLE public.audit_log
    ADD CONSTRAINT audit_log_accion_check
    CHECK (accion IN ('crear','modificar','eliminar','ejecutar','aprobar',
                      'rechazar','login','cambio_rol','escalamiento','vencimiento'));

ALTER TABLE public.audit_log
    DROP CONSTRAINT IF EXISTS audit_log_entidad_check;
ALTER TABLE public.audit_log
    ADD CONSTRAINT audit_log_entidad_check
    CHECK (entidad IN ('workflow','usuario','integracion','aprobacion','sesion'));

-- ── 3. Verificar ────────────────────────────────────────────────────────────
-- Deben aparecer audit_log_accion_check y audit_log_entidad_check.
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM   pg_constraint
WHERE  conrelid = 'public.audit_log'::regclass AND contype = 'c';

-- ── Rollback ────────────────────────────────────────────────────────────────
--   ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_accion_check;
--   ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entidad_check;
