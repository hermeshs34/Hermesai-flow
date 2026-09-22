-- ═══════════════════════════════════════════════════════════════════════════
-- HUECO_10SEP.sql — OPCIONAL. El cron ya está arreglado; esto no lo toca.
--
-- La pregunta: el reloj latió hasta el 10/09 15:23 UTC, pero la última
-- ejecución automática del BCV es del 09/09 13:00. El jueves 10/09 a las
-- 13:00 tocaba y no salió, con el job todavía vivo.
--
-- Ya está DESCARTADO el ciclo de vida (workflow_autorizaciones no tiene
-- ninguna transición del BCV cerca; la última es del 17/08). Queda una
-- hipótesis comprobable: que 'is_active' se apagara esos días. Apagar un
-- flujo NO deja traza en workflow_autorizaciones — solo en audit_log.
--
-- net._http_response ya se vació con el restart (es unlogged), así que si
-- esto sale vacío la respuesta honesta es "no se puede saber", y se queda
-- anotado como no explicado. No es un fallo de la consulta.
--
-- UNA SOLA SENTENCIA: el SQL Editor solo muestra la última.
-- ═══════════════════════════════════════════════════════════════════════════

select jsonb_pretty(jsonb_build_object(

  -- 1. ¿Alguien tocó algo entre el 08 y el 12 de septiembre?
  --    Se busca ancho a propósito: cualquier entidad, cualquier acción.
  'audit_ventana', coalesce((select jsonb_agg(jsonb_build_object(
                      'cuando', a.created_at, 'quien', a.usuario_email,
                      'accion', a.accion, 'entidad', a.entidad,
                      'descripcion', left(a.descripcion, 200))
                      order by a.created_at desc)
                    from audit_log a
                    where a.created_at >= '2026-09-08'
                      and a.created_at <  '2026-09-12'), '[]'::jsonb),

  -- 2. ¿Hubo algún run del BCV esos días que NO fuera 'cron'?
  --    (un run manual, o uno que arrancara y muriera antes de registrarse)
  'runs_bcv_ventana', coalesce((select jsonb_agg(jsonb_build_object(
                         'cuando', r.started_at, 'disparado_por', r.triggered_by,
                         'estado', r.status, 'fin', r.finished_at)
                         order by r.started_at desc)
                       from execution_runs r
                       join workflows w on w.id = r.workflow_id
                       where w.name ilike '%BCV%'
                         and r.started_at >= '2026-09-08'
                         and r.started_at <  '2026-09-12'), '[]'::jsonb),

  -- 3. ¿Y algún log de nodo suelto sin run asociado?
  'logs_ventana', coalesce((select jsonb_agg(jsonb_build_object(
                     'cuando', l.executed_at, 'estado', l.status,
                     'mensaje', left(l.message, 200))
                     order by l.executed_at desc)
                   from (select l.* from execution_logs l
                         join workflows w on w.id = l.workflow_id
                         where w.name ilike '%BCV%'
                           and l.executed_at >= '2026-09-08'
                           and l.executed_at <  '2026-09-12'
                         order by l.executed_at desc limit 20) l), '[]'::jsonb),

  -- 4. Estado actual del flujo, para contrastar contra lo de arriba.
  'bcv_ahora', coalesce((select jsonb_agg(jsonb_build_object(
                  'nombre', w.name, 'activo', w.is_active,
                  'estado_definicion', w.estado_definicion,
                  'schedule_type', w.schedule_type,
                  'actualizado', w.updated_at))
                from workflows w where w.name ilike '%BCV%'), '[]'::jsonb)

)) as hueco_10sep;
