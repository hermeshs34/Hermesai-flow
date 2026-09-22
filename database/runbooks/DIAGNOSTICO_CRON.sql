-- ═══════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO pg_cron — SOLO LECTURA. UNA sola sentencia.
--
-- ⚠️ El SQL Editor de Supabase solo MUESTRA el resultado de la ÚLTIMA
--    sentencia. Por eso el intento anterior solo enseñó la consulta 7:
--    las otras seis corrieron y su salida se descartó. Aquí va todo
--    dentro de un único SELECT, así que se ve entero.
--
-- El secreto va ENMASCARADO: la salida se puede pegar tal cual.
--
-- ⚠️ Si da error diciendo que «relation cron.job does not exist», ESO
--    TAMBIÉN ES LA RESPUESTA: significa que el restart se llevó la
--    extensión entera. Mándame el error tal cual.
-- ═══════════════════════════════════════════════════════════════════════

select jsonb_pretty(jsonb_build_object(

  'quien', jsonb_build_object(
      'usuario', current_user, 'base', current_database()),

  'extensiones', coalesce((
      select jsonb_agg(jsonb_build_object('ext', extname, 'version', extversion))
      from pg_extension where extname in ('pg_cron','pg_net')), '[]'::jsonb),

  -- LA CLAVE: si esto sale [] el planificador está a cero
  'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'jobid', jobid, 'jobname', jobname, 'schedule', schedule,
          'active', active, 'username', username, 'base', database,
          'comando', regexp_replace(
                       regexp_replace(command, '(Bearer\s+)[^"]*', '\1<OCULTO>', 'g'),
                       '[0-9a-f]{32,}', '<OCULTO>', 'g')))
      from cron.job), '[]'::jsonb),

  'job_runs', coalesce((
      select jsonb_agg(x) from (
          select jobid, status, count(*) as veces,
                 min(start_time) as desde, max(start_time) as hasta
          from cron.job_run_details
          group by jobid, status order by max(start_time) desc limit 10) x), '[]'::jsonb),

  -- La VERDAD del HTTP. Vacío = la base se reinició (tabla unlogged)
  'http', coalesce((
      select jsonb_agg(x) from (
          select id, status_code, left(content,160) as content,
                 timed_out, error_msg, created
          from net._http_response order by created desc limit 10) x), '[]'::jsonb),

  'runs', coalesce((
      select jsonb_agg(x) from (
          select triggered_by, count(*) as veces, max(started_at) as ultimo
          from execution_runs group by triggered_by) x), '[]'::jsonb)

)) as diagnostico;
