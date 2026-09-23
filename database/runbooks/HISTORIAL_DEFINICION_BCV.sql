-- ═══════════════════════════════════════════════════════════════════════════
-- HISTORIAL_DEFINICION_BCV.sql — ¿qué pasó con el ciclo de vida (§6.7) cuando
-- se cambió la hora del "Reporte BCV Diario"?
--
-- POR QUÉ. El 23/09/2026 el flujo se adelantó de 09:00 a 07:00. Eso cambia
-- config_json del nodo disparador, y según §6.7 el trigger
-- workflow_definicion_cambiada debe DEVOLVERLO A BORRADOR Y DESACTIVARLO. Sin
-- embargo esa mañana estaba 'publicado' y activo, y corrió solo. Dos lecturas
-- posibles, y esta consulta distingue entre ellas:
--
--   a) El guarda funcionó: hay una 'despublicar' y después 'enviar' +
--      'autorizar' con DOS personas distintas (cuatro ojos). Todo en orden.
--   b) No hay 'despublicar' posterior al cambio: el guarda tiene un agujero.
--
-- Solo lee. UNA SOLA SENTENCIA: el SQL Editor solo MUESTRA la última.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  -- ── 1. El flujo hoy ──────────────────────────────────────────────────────
  'flujo', (
      SELECT jsonb_agg(jsonb_build_object(
                 'nombre',            w.name,
                 'is_active',         w.is_active,
                 'estado_definicion', w.estado_definicion,
                 'updated_at_ve',     to_char(w.updated_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI'),
                 'cron_del_nodo',     (SELECT jsonb_agg(n.config_json->>'cron')
                                         FROM workflow_nodes n
                                        WHERE n.workflow_id = w.id
                                          AND n.type = 'trigger' AND n.category = 'cron')))
        FROM workflows w WHERE w.name ILIKE '%BCV%'),

  -- ── 2. La traza del ciclo de vida, de la más reciente a la más antigua ───
  -- actor_email NULL + motivo de migración = la convalidación del 14/08.
  'workflow_autorizaciones', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
                 'cuando_ve', to_char(a.creado_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS'),
                 'accion',    a.accion,
                 'de',        a.estado_desde,
                 'a',         a.estado_hasta,
                 'quien',     a.actor_email,
                 'motivo',    left(a.motivo, 160))
             ORDER BY a.creado_at DESC)
        FROM workflow_autorizaciones a
        JOIN workflows w ON w.id = a.workflow_id
       WHERE w.name ILIKE '%BCV%'), '[]'::jsonb),

  -- ── 3. Lo que dejó en audit_log en los últimos 15 días ───────────────────
  'audit_log', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
                 'cuando_ve',   to_char(l.created_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS'),
                 'accion',      l.accion,
                 'quien',       l.usuario_email,
                 'descripcion', left(l.descripcion, 200))
             ORDER BY l.created_at DESC)
        FROM audit_log l
        JOIN workflows w ON w.id = l.entidad_id
       WHERE l.entidad = 'workflow'
         AND w.name ILIKE '%BCV%'
         AND l.created_at > now() - interval '15 days'), '[]'::jsonb)

)) AS historial;
