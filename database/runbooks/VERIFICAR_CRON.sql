-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAR_CRON.sql — correr 3 MINUTOS DESPUÉS de la migración 20260922
--
-- UNA SOLA SENTENCIA a propósito: el SQL Editor de Supabase solo MUESTRA el
-- resultado de la última, y las demás se ejecutan y se descartan en silencio.
-- Los secretos van enmascarados DENTRO de la consulta: la salida se puede
-- pegar entera sin pensarlo.
--
-- ⚠️ NO MIRES cron.job_run_details PARA SABER SI FUNCIONA. net.http_post es
--    asíncrono: encola, devuelve un id, y pg_cron marca 'succeeded' aunque el
--    HTTP haya dado 401. Eso es lo que escondió el fallo ocho días en agosto.
--    La verdad está en net._http_response.
-- ═══════════════════════════════════════════════════════════════════════════

select jsonb_pretty(jsonb_build_object(

  -- 1. ¿Hay UN job, y solo uno?  → esperado: exactamente 1 fila, active=true
  'job', coalesce((select jsonb_agg(jsonb_build_object(
            'jobid', jobid, 'jobname', jobname, 'schedule', schedule,
            'active', active, 'username', username,
            -- el prefijo "Bearer " tiene que SEGUIR AHÍ: si sale
            -- "Bearer <OCULTO>" está bien; si sale solo "<OCULTO>" se perdió
            'comando', regexp_replace(
                         regexp_replace(command, '(Bearer\s+)[^"]*', '\1<OCULTO>', 'g'),
                         '[0-9a-f]{32,}', '<OCULTO>', 'g')))
          from cron.job), '[]'::jsonb),

  -- 2. LA PRUEBA DE VERDAD → esperado: status_code 200 y un content con
  --    {"checked":N,"fired":N}. Un 401 aquí = el secreto no casa.
  'http', coalesce((select jsonb_agg(jsonb_build_object(
             'cuando', created, 'status', status_code, 'timeout', timed_out,
             'content', left(content, 300)) order by created desc)
           from (select * from net._http_response
                 order by created desc limit 5) u), '[]'::jsonb),

  -- 3. El planificador late → esperado: corridas de hace menos de 2 minutos
  'ticks', coalesce((select jsonb_agg(jsonb_build_object(
              'jobid', jobid, 'status', status, 'inicio', start_time)
              order by start_time desc)
            from (select * from cron.job_run_details
                  order by start_time desc limit 5) v), '[]'::jsonb),

  -- 4. ¿Volvió a haber ejecuciones automáticas de flujos?
  --    Ojo: "Reporte BCV Diario" es 0 9 * * 1-5 = 13:00 UTC de lunes a
  --    viernes, así que esto NO se llena hasta la próxima hora en punto.
  'runs_cron', coalesce((select jsonb_agg(jsonb_build_object(
                  'flujo', w.name, 'estado', r.status, 'cuando', r.started_at)
                  order by r.started_at desc)
                from (select * from execution_runs
                      where triggered_by = 'cron'
                      order by started_at desc limit 5) r
                join workflows w on w.id = r.workflow_id), '[]'::jsonb),

  -- 5. CABO SUELTO del diagnóstico: el reloj siguió latiendo hasta el
  --    10/09 15:23 pero la última ejecución automática es del 09/09 13:00.
  --    El jueves 10/09 a las 13:00 UTC tocaba y no salió. La hipótesis
  --    barata es que el flujo estuviera en 'borrador' ese día (§6.7: tocar
  --    nodos o conexiones de un flujo publicado lo devuelve a borrador y lo
  --    desactiva). Esto lo confirma o lo descarta.
  'historial_bcv', coalesce((select jsonb_agg(jsonb_build_object(
                      'accion', a.accion, 'de', a.estado_desde,
                      'a', a.estado_hasta, 'quien', a.actor_email,
                      'cuando', a.creado_at, 'motivo', a.motivo)
                      order by a.creado_at desc)
                    from workflow_autorizaciones a
                    join workflows w on w.id = a.workflow_id
                    where w.name ilike '%BCV%'), '[]'::jsonb)

)) as verificacion;
