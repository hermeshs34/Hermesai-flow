-- 20260928 — El contenido de una llamada de webhook no se lee desde el navegador
--
-- 20260928_webhook_entrada.sql dejaba webhook_recepciones entera legible por
-- toda la organización, `payload` incluido: un `viewer` podía leer por API lo
-- que mandó el sistema externo, y ese contenido puede traer datos personales.
-- Decisión de Hermes del 28/09/2026: estrecharlo.
--
-- No se estrecha por rol, se cierra la columna para TODOS los usuarios:
--   * `payload` solo lo leen execute-workflow y webhook-in, con la clave de
--     servicio. La pantalla no lo pide nunca (webhook.service.ts nombra sus
--     columnas), así que cerrarlo no le quita nada a nadie.
--   * Un permiso por columna no distingue roles de la aplicación
--     (profiles.role): para Postgres todos son `authenticated`. Filtrar por
--     rol obligaría a una RPC DEFINER; si algún día alguien necesita ver el
--     contenido (un auditor, como evidencia), esa es la vía, y aditiva.
--
-- Las filas (cuándo llegó, estado, motivo) siguen visibles para la
-- organización, igual que execution_logs: son la lista del panel.
--
-- ⚠️ Con esto un select('*') sobre webhook_recepciones desde el navegador
-- revienta con «permission denied» — igual que en workflow_webhooks.
--
-- ENSAYO: database/ensayos/20260928_webhook_payload_solo_servicio.ensayo.sql

BEGIN;

REVOKE SELECT ON public.webhook_recepciones FROM authenticated;
GRANT SELECT (id, organization_id, workflow_id, recibido_at, evento_id,
              estado, motivo, bytes, execution_run_id)
    ON public.webhook_recepciones TO authenticated;

COMMIT;

-- Comprobación (sentencia propia y la última: el SQL Editor solo muestra esta)
SELECT has_column_privilege('authenticated', 'public.webhook_recepciones', 'payload', 'SELECT') AS usuarios_leen_payload,
       has_column_privilege('authenticated', 'public.webhook_recepciones', 'estado',  'SELECT') AS usuarios_leen_estado,
       has_column_privilege('service_role',  'public.webhook_recepciones', 'payload', 'SELECT') AS motor_lee_payload,
       has_table_privilege ('anon',          'public.webhook_recepciones',            'SELECT') AS anon_lee;
