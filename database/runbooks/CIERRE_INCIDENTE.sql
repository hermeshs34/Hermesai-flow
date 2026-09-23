-- ═══════════════════════════════════════════════════════════════════════════
-- CIERRE_INCIDENTE.sql — ¿volvió a ejecutarse un flujo SOLO, sin nadie delante?
--
-- Correr después de la hora a la que le toca a "Reporte BCV Diario". Esa hora
-- NO se escribe aquí: sale del nodo disparador (bloque 4, 'cron_del_nodo'),
-- evaluada en hora de Venezuela por cron-runner (§9.2, NO en UTC).
--
-- ⚠️ La primera versión de este fichero traía la hora escrita a mano
--    (09:00) y un campo 'ya_toco_el_bcv_hoy'. El 23/09/2026 Hermes adelantó
--    el flujo a las 07:00; corrió a las 07:00, y a las 07:07 el campo decía
--    false al lado de un veredicto CERRADO. Un instrumento que no lee lo que
--    mide, miente (§12.2). Retirado: la hora se lee del nodo o no se dice.
--
-- QUÉ CIERRA ESTO. El incidente del 10/09–22/09/2026 fue doce días sin una
-- sola ejecución automática. Que el job exista y conteste 200 ya está
-- comprobado (VERIFICAR_CRON / VERIFICAR_VIGILANTE); lo que NO está
-- comprobado es lo único que le importa al usuario: que un flujo arranque
-- solo. Eso es el bloque 'veredicto' de abajo.
--
-- ⚠️ ESTA CONSULTA SIRVE IGUAL SI SALE MAL. Los bloques 4 y 5 existen para
--    el caso de que el BCV NO haya salido: dicen si el flujo está activo y
--    publicado (§6.7 — tocar nodos de un flujo publicado lo devuelve a
--    borrador Y LO DESACTIVA, en silencio) y qué contestó el HTTP. Es la
--    hipótesis barata del hueco del 10/09, que se quedó sin poder probar
--    porque net._http_response es UNLOGGED y el reinicio la vació.
--
-- UNA SOLA SENTENCIA, como todo lo de esta carpeta: el SQL Editor de Supabase
-- solo MUESTRA el resultado de la última. Los secretos van enmascarados
-- DENTRO de la consulta: la salida se puede pegar entera sin pensarlo.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  -- ── 1. EL VEREDICTO, en una línea ────────────────────────────────────────
  -- Lo que hay que leer primero. Todo lo demás es para entender el porqué.
  'veredicto', (
      SELECT CASE
        WHEN count(*) > 0 THEN
          'CERRADO — el BCV se ejecutó SOLO hoy (' || count(*) || ' vez/veces). '
          || 'Doce días de silencio terminados.'
        ELSE
          'TODAVIA NO — el BCV no tiene run con triggered_by=cron hoy. Si ya '
          || 'paso la hora de cron_del_nodo (bloque 4), mira los bloques 4 y 5 '
          || 'ANTES de tocar nada.'
        END
        FROM execution_runs r
        JOIN workflows w ON w.id = r.workflow_id
       WHERE r.triggered_by = 'cron'
         AND w.name ILIKE '%BCV%'
         AND r.started_at >= date_trunc('day', now() AT TIME ZONE 'UTC')),

  'ahora', jsonb_build_object(
      'utc',       to_char(now() AT TIME ZONE 'UTC',              'YYYY-MM-DD HH24:MI'),
      'venezuela', to_char(now() AT TIME ZONE 'America/Caracas',  'YYYY-MM-DD HH24:MI')),

  -- ── 2. Las ultimas ejecuciones automaticas ───────────────────────────────
  -- La del 09/09 13:00 era la ultima que habia. Si aqui aparece algo de hoy,
  -- el contador volvio a correr.
  'ultimos_runs_automaticos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
                 'flujo',      w.name,
                 'estado',     r.status,
                 'utc',        to_char(r.started_at AT TIME ZONE 'UTC',             'YYYY-MM-DD HH24:MI'),
                 'venezuela',  to_char(r.started_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI'))
             ORDER BY r.started_at DESC)
        FROM (SELECT * FROM execution_runs
               WHERE triggered_by = 'cron'
               ORDER BY started_at DESC LIMIT 5) r
        JOIN workflows w ON w.id = r.workflow_id), '[]'::jsonb),

  -- ── 3. El planificador, de un vistazo ────────────────────────────────────
  -- Esperado: los dos jobs, activos. Si falta alguno, el barrido del
  -- 20260807 volvio a pasar (⛔ ese fichero NO SE EJECUTA).
  'jobs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
                 'jobid',    j.jobid,
                 'jobname',  j.jobname,
                 'schedule', j.schedule,
                 'active',   j.active,
                 'destino',  substring(j.command FROM 'functions/v1/[a-z-]+'))
             ORDER BY j.jobid)
        FROM cron.job j), '[]'::jsonb),

  -- ── 4. SI EL BCV NO SALIO, EMPIEZA POR AQUI ──────────────────────────────
  -- Un flujo despublicado o desactivado no lo dispara nadie, y no da error:
  -- simplemente no pasa nada, que es indistinguible de "el reloj esta muerto".
  'estado_del_flujo_bcv', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
                 'flujo',             w.name,
                 'is_active',         w.is_active,
                 'estado_definicion', w.estado_definicion,
                 'schedule_type',     w.schedule_type,
                 'schedule_value',    w.schedule_value,
                 -- cron-runner solo mira nodos type='trigger' category='cron'
                 -- (§9.2: son DOS columnas, 'trigger:cron' no casa nada).
                 -- La hora de verdad: la que lee cron-runner (config_json.cron),
                 -- no schedule_value, que en este flujo va NULL.
                 'cron_del_nodo', (SELECT jsonb_agg(n.config_json->>'cron')
                                     FROM workflow_nodes n
                                    WHERE n.workflow_id = w.id
                                      AND n.type = 'trigger' AND n.category = 'cron'))
             ORDER BY w.name)
        FROM workflows w WHERE w.name ILIKE '%BCV%'), '[]'::jsonb),

  -- ── 5. Y la verdad del HTTP, que es la unica que no miente ───────────────
  -- pg_cron dice 'succeeded' aunque esto sea un 401, porque net.http_post
  -- solo ENCOLA (§6.1). Esperado: 200 de cron-runner con {"checked":N,...}.
  'http_30min', coalesce((
      SELECT jsonb_agg(x.fila ORDER BY x.created DESC)
        FROM (SELECT r.created,
                     jsonb_build_object(
                         'status',  r.status_code,
                         'cuando',  to_char(r.created AT TIME ZONE 'UTC', 'HH24:MI:SS'),
                         'timeout', r.timed_out,
                         'quien',   CASE
                                      WHEN r.content LIKE '%checked%'   THEN 'cron-runner'
                                      WHEN r.content LIKE '%veredicto%' THEN 'vigilante'
                                      ELSE 'otro / sin cuerpo' END,
                         'cuerpo',  regexp_replace(
                                        left(coalesce(r.content, ''), 160),
                                        '[0-9a-f]{32,}', '<OCULTO>', 'g')) AS fila
                FROM net._http_response r
               WHERE r.created > now() - interval '30 minutes'
               ORDER BY r.created DESC LIMIT 15) x), '[]'::jsonb),

  -- ── 6. El veredicto del vigilante, para contrastar ───────────────────────
  -- Desde el 22/09 respuestas_vigilante_10min sale aparte: su propio 200 ya
  -- no contamina el ratio de cron-runner (§6.1.1).
  'salud', public.salud_cron()

)) AS cierre;
