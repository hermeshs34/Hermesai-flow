-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAR_VIGILANTE.sql — ¿existe de verdad el job 11?
--
-- POR QUÉ HACE FALTA ESTO
-- La migración devolvió "OK - vigilante creado con jobid 11" y, en la misma
-- salida, una lista con un solo job (el 10). No es una contradicción: el
-- listado era un subselect de LA MISMA sentencia que llamaba a cron.schedule(),
-- así que leía la instantánea MVCC tomada ANTES de que esa llamada insertara la
-- fila. El job se creó; lo que no podía verlo era mi comprobación.
--
-- Esto lo mira desde fuera, en una sentencia nueva, que es la única forma de
-- que la respuesta signifique algo.
--
-- QUÉ TIENE QUE SALIR
--   vigilante_existe ........ true
--   jobs ................... 10 cron-runner-cada-minuto (* * * * *)
--                            11 vigilante-reloj        (*/10 * * * *), active
--   ticks_30min ............ los dos jobs, status succeeded
--   http_30min ............. 200 de cron-runner ({"checked":N,...}) cada minuto
--                            y, en un múltiplo de 10, un 200 del vigilante
--                            ({"veredicto":"ok",...})
--   estado_vigilante ....... ultimo_estado "ok" en cuanto haya corrido una vez
--
-- ⚠️ SI APARECE {"code":"UNAUTHORIZED_NO_AUTH_HEADER"} el rechazo es de la
--    PUERTA de Supabase, no del código: la función se desplegó sin
--    --no-verify-jwt (§6.1). Un 401 con un mensaje en castellano es del código
--    y significa otra cosa (secreto que no casa).
--
-- El secreto va enmascarado DENTRO de la consulta: la salida se puede pegar
-- entera. Y es UNA sola sentencia, porque el SQL Editor solo muestra la última.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

    'vigilante_existe', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigilante-reloj'),

    'jobs', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'jobid',    j.jobid,
                   'jobname',  j.jobname,
                   'schedule', j.schedule,
                   'active',   j.active,
                   'destino',  substring(j.command FROM 'functions/v1/[a-z-]+'),
                   'lleva_secreto_64hex', j.command ~ 'Bearer [0-9a-fA-F]{64}',
                   'command',  regexp_replace(
                                   regexp_replace(j.command, '(Bearer\s+)[^"]*', '\1<OCULTO>', 'g'),
                                   '[0-9a-f]{32,}', '<OCULTO>', 'g')
               ) ORDER BY j.jobid), '[]'::jsonb)
          FROM cron.job j),

    'ticks_30min', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'jobid',   t.jobid,
                   'jobname', t.jobname,
                   'veces',   t.veces,
                   'ultimo',  t.ultimo,
                   'estados', t.estados) ORDER BY t.jobid), '[]'::jsonb)
          FROM (SELECT d.jobid,
                       max(j.jobname)             AS jobname,
                       count(*)                   AS veces,
                       max(d.start_time)          AS ultimo,
                       jsonb_agg(DISTINCT d.status) AS estados
                  FROM cron.job_run_details d
                  LEFT JOIN cron.job j ON j.jobid = d.jobid
                 WHERE d.start_time > now() - interval '30 minutes'
                 GROUP BY d.jobid) t),

    -- La verdad del HTTP. pg_cron marca succeeded aunque esto sea un 401,
    -- porque net.http_post solo ENCOLA (§6.1): aquí es donde se mira.
    'http_30min', (
        SELECT coalesce(jsonb_agg(x.fila ORDER BY x.created DESC), '[]'::jsonb)
          FROM (SELECT r.created,
                       jsonb_build_object(
                           'status',  r.status_code,
                           'cuando',  r.created,
                           'timeout', r.timed_out,
                           'error',   r.error_msg,
                           'cuerpo',  regexp_replace(
                                          left(coalesce(r.content, ''), 180),
                                          '[0-9a-f]{32,}', '<OCULTO>', 'g')) AS fila
                  FROM net._http_response r
                 WHERE r.created > now() - interval '30 minutes'
                 ORDER BY r.created DESC
                 LIMIT 25) x),

    'estado_vigilante', (
        SELECT jsonb_build_object(
                   'ultimo_estado',   v.ultimo_estado,
                   'ultimo_ok_at',    v.ultimo_ok_at,
                   'ultimo_aviso_at', v.ultimo_aviso_at,
                   'avisos_enviados', v.avisos_enviados,
                   'actualizado_at',  v.actualizado_at)
          FROM public.vigilante_reloj v WHERE v.id = 1),

    'salud', public.salud_cron()

)) AS verificacion;
