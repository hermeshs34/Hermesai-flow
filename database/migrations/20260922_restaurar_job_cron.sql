-- ═══════════════════════════════════════════════════════════════════════════
-- 20260922 — Restaurar el job de pg_cron (segunda vez)
--
-- DIAGNÓSTICO MEDIDO EL 22/09/2026, no supuesto:
--   * pg_cron 1.6.4 y pg_net 0.20.3 SIGUEN instaladas  → no es la extensión
--   * cron.job                       → VACÍA           → no hay quien llame
--   * cron.job_run_details           → INTACTA: jobid 8 con 47.701 corridas,
--                                      de 2026-08-08 12:23 a 2026-09-10 15:23
--   * net._http_response             → VACÍA (tabla unlogged ⇒ hubo reinicio)
--   * cron-runner                    → v43, verify_jwt=false, responde con su
--                                      propio 401 ⇒ la función está SANA
--   * "Reporte BCV Diario"           → is_active=true y estado_definicion=
--                                      'publicado' ⇒ pasa los dos cerrojos
--
-- O sea: el motor está bien y el flujo está bien. Lo único que falta es la
-- fila de cron.job. El reloj se paró el 10/09/2026 a las 15:23 UTC.
--
-- ⚠️ LA HISTORIA SOBREVIVIÓ Y LA DEFINICIÓN NO. Esa asimetría es una firma:
-- un reinicio NO borra cron.job (es una tabla normal), y si se hubiera
-- recreado la extensión tampoco quedaría job_run_details. Lo que sí deja
-- exactamente este rastro es un cron.unschedule() / DELETE sobre la fila.
-- Candidato principal: volver a ejecutar entero
-- 20260807_restaurar_pg_cron.sql, cuyo PASO 3 retira todo job que case
-- '%cron-runner%' mientras su PASO 4 —el que lo vuelve a crear— está
-- COMENTADO. Ese fichero avisa de ello y aun así es un pie de banco.
-- Por eso ESTE fichero es idempotente: limpia y vuelve a crear en la misma
-- tacada, así que ejecutarlo de más nunca deja el planificador a cero.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ POR QUÉ ESTE FICHERO COMPRUEBA EL SECRETO ANTES DE CREAR NADA
--
-- La primera versión, el 22/09/2026 a las 16:2x, se ejecutó SIN sustituir el
-- marcador. Creó el jobid 9 impecable —schedule correcto, "Bearer " intacto,
-- latiendo puntual cada minuto— y devolvió un jobid, que se lee como «hecho».
-- Cada disparo moría con 401 y el planificador seguía marcando 'succeeded'.
-- Un fichero que contesta «listo» sin haber sido configurado es exactamente
-- el patrón del 'succeeded' de pg_cron y del '✓ Guardado' sin escritura.
--
-- Ahora no se comprueba la FORMA del valor pegado sino su IDENTIDAD: se
-- hashea y se contrasta contra la huella del CRON_SECRET que hay puesto en
-- Edge Functions → Secrets. Si no es ese secreto exacto, NO SE CREA NADA y
-- el resultado lo dice con todas las letras. Falla cerrado.
--
-- ⚠️ SI ALGÚN DÍA SE ROTA CRON_SECRET, hay que actualizar la huella de abajo
--    (sale de `npx supabase secrets list`, campo "value" — que es el sha256,
--    no el valor).
-- ───────────────────────────────────────────────────────────────────────────
--
-- CÓMO EJECUTARLO
-- Supabase → SQL Editor. Se pega ENTERO y se ejecuta de una vez.
-- El SQL Editor solo MUESTRA el resultado de la ÚLTIMA sentencia; aquí esa
-- última sentencia es justamente el veredicto.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Dejar el planificador a cero ────────────────────────────────────────
select cron.unschedule(jobid)
from cron.job
where command like '%cron-runner%'
   or jobname in ('cron-runner-cada-minuto', 'hermesai-flow-cron-runner');


-- ── 2. Crear el job SOLO si el secreto es el bueno ─────────────────────────
--
-- ⚠️ SUSTITUIR el marcador de la línea señalada por el valor de CRON_SECRET.
--
-- ⚠️ DE DÓNDE SE SACA: del panel (Edge Functions → Secrets → CRON_SECRET →
--    revelar/copiar). NO de `npx supabase secrets list`: esa orden imprime un
--    campo llamado "value" que NO es el valor, es su SHA-256 — y son 64
--    caracteres hex, la MISMA forma que CRON_SECRET, así que pegarlo no
--    parece un error en ningún momento.
--
-- ⚠️ 'Bearer ' y el secreto son DOS literales distintos unidos por ||, en
--    líneas distintas, a propósito: el 07/08/2026 iban dentro de la misma
--    comilla, al seleccionar de comilla a comilla se sustituyeron las dos
--    cosas, la cabecera perdió el prefijo y cada llamada murió con
--    UNAUTHORIZED_INVALID_JWT_FORMAT durante ocho días. Seleccionar el
--    marcador no puede llevarse el prefijo.
--
-- ⚠️ AQUÍ NO VA LA service_role KEY. Va CRON_SECRET (64 hex). Ver §6.1.
--
-- ⚠️ timeout_milliseconds := 30000 NO es decorativo: pg_net corta a los 5 s
--    por defecto, y disparar un flujo y mandar correos pasa de cinco.

-- ⚠️ SUSTITUYE PEGA_AQUI_EL_SHA256_DE_CRON_SECRET ANTES DE EJECUTAR.
--    Sale de: Supabase -> Edge Functions -> Secrets, columna "value" de
--    CRON_SECRET (que NO es el valor, es su sha256 — ver arriba), o bien
--    `npx supabase secrets list`.
--
--    No va cableada en el fichero a proposito, por dos motivos:
--      1. Es el verificador de una credencial VIVA. Una huella de sha256 no
--         se revierte, pero un repositorio es mucho mas publico que el panel.
--      2. CADUCA EN CADA ROTACION, y esa es justo la trampa que costo una
--         vuelta el 22/09/2026: una huella vieja cableada aqui habria
--         RECHAZADO el secreto nuevo y correcto, diciendo "no casan" con toda
--         la razon aparente del mundo. Un dato de verificacion que envejece
--         solo termina mintiendo — misma familia que el succeeded de pg_cron.
--
--    Si no la sustituyes no pasa nada malo: la comparacion da false y NO SE
--    CREA NINGUN JOB. Falla cerrado, que es como tiene que fallar.

select jsonb_pretty(jsonb_build_object(
    'resultado',
    case
      when encode(sha256(convert_to(v.secreto, 'utf8')), 'hex')
           = 'PEGA_AQUI_EL_SHA256_DE_CRON_SECRET'
      then 'OK — job creado con jobid ' || cron.schedule(
               'cron-runner-cada-minuto',
               '* * * * *',
               format(
                   'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 30000);',
                   'https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/cron-runner',
                   jsonb_build_object(
                       'Content-Type',  'application/json',
                       'Authorization', 'Bearer ' || v.secreto
                   )::text,
                   '{}'
               )
           )::text
           || '. Verifica con VERIFICAR_CRON.sql dentro de 3 minutos: tiene que salir status 200.'

      else 'NO SE CREO NINGUN JOB. El valor pegado no es el CRON_SECRET que hay en Edge Functions -> Secrets'
           || ' (longitud pegada: ' || length(v.secreto) || ', se esperan 64 hex).'
           || ' Copialo del panel, no de "supabase secrets list" —ese campo "value" es el sha256, no el valor—,'
           || ' y vuelve a ejecutar este fichero entero. El planificador queda a cero hasta entonces:'
           || ' eso es a proposito, un job con el secreto equivocado late cada minuto y no hace nada.'
    end
)) as resultado
from (select
        -- ↓↓↓ ÚNICA LÍNEA A TOCAR: el secreto entre las comillas ↓↓↓
        'PEGAR_AQUI_CRON_SECRET'
        -- ↑↑↑ no toques nada más, ni el 'Bearer ' de arriba ↑↑↑
        ::text as secreto) v;


-- ── Rollback ────────────────────────────────────────────────────────────────
--   select cron.unschedule('cron-runner-cada-minuto');
