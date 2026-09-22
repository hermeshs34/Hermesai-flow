-- ═══════════════════════════════════════════════════════════════════════════
-- 20260922 — El job que vigila al reloj
--
-- ⚠️ ORDEN: PRIMERO 20260922_salud_cron.sql, LUEGO desplegar la función
--    vigilante-reloj con --no-verify-jwt, Y SOLO ENTONCES esto. Al revés, el
--    job empieza a pegarle a una función que no existe y el único rastro es
--    un 404 en net._http_response, que nadie mira.
--
--        npx supabase functions deploy vigilante-reloj --no-verify-jwt
--
--    La bandera NO se recuerda sola: no hay config.toml (§6.1).
--
-- DOS DECISIONES QUE PARECEN DETALLES Y NO LO SON
--
-- 1. NI EL NOMBRE NI EL COMANDO DE ESTE JOB CONTIENEN "cron-runner".
--    El PASO 3 de 20260807_restaurar_pg_cron.sql hace:
--        select cron.unschedule(jobid) from cron.job
--         where command like '%cron-runner%'
--            or jobname in ('cron-runner-cada-minuto','hermesai-flow-cron-runner');
--    Ese barrido es el sospechoso número uno de que el 10/09/2026 la base
--    amaneciera sin planificador. Si el vigilante casara con ese filtro, se
--    lo llevaría por delante junto al job al que vigila — y el vigilante que
--    muere con la víctima no vigila nada.
--
-- 2. EL SECRETO SE SACA DE DENTRO DE LA BASE, del comando del job que ya
--    existe. No se teclea, no se pega y no cruza ninguna capa de comillas:
--    exactamente la regla de §6.1, escrita después de que un copiar-pegar
--    estropeara la service_role key dos veces en silencio.
--
-- ⚠️ Y EL LÍMITE, DICHO CLARO: esto lo dispara el mismo pg_cron al que vigila.
--    Cubre que borren o desactiven el job de cron-runner, y que cron-runner
--    conteste 401 o 500. NO cubre que se caiga pg_cron entero ni que alguien
--    borre los dos jobs: para eso haría falta un pinger externo a la base.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Idempotencia ────────────────────────────────────────────────────────
-- Sin fila, sin error: no se usa cron.unschedule('nombre'), que revienta si
-- el job no existe.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vigilante-reloj';


-- ── 2. Crear el job, y NO crearlo si no se puede hacer bien ────────────────
-- El CASE protege la llamada: cron.schedule es VOLATILE, así que Postgres no
-- la evalúa por adelantado. Si el secreto no aparece, no se crea NADA.
--
-- Esta forma existe por una lección del 22/09/2026: la migración de restauración
-- devolvía un jobid —que se lee como "hecho"— habiendo creado un job perfecto,
-- puntual y completamente muerto, porque el marcador del secreto se había
-- quedado sin sustituir. Un instrumento que dice "listo" sin haber comprobado
-- nada es de la familia del succeeded de pg_cron (§6.1).
WITH origen AS MATERIALIZED (
    SELECT (SELECT substring(j.command FROM 'Bearer [0-9a-fA-F]{64}')
              FROM cron.job j
             WHERE j.jobname = 'cron-runner-cada-minuto'
             LIMIT 1) AS autorizacion
)
SELECT jsonb_pretty(jsonb_build_object(
    'resultado',
    CASE
        WHEN o.autorizacion IS NULL THEN
            'NO SE CREO NINGUN JOB. No se encontro el job "cron-runner-cada-minuto" '
            || 'con una cabecera Bearer de 64 hex. Restaura primero el reloj principal '
            || '(20260922_restaurar_job_cron.sql) y vuelve a correr esto.'
        ELSE
            'OK - vigilante creado con jobid ' ||
            cron.schedule(
                'vigilante-reloj',
                '*/10 * * * *',
                format(
                    'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 30000);',
                    'https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/vigilante-reloj',
                    jsonb_build_object(
                        'Content-Type',  'application/json',
                        'Authorization', o.autorizacion
                    )::text,
                    '{}'
                )
            )::text
    END,
    'aviso', 'La lista de jobs va en la sentencia siguiente, NO aqui: ver nota abajo.'
)) AS vigilante
FROM origen o;


-- ── 3. La lista de jobs, EN SU PROPIA SENTENCIA ────────────────────────────
-- ⚠️ POR QUE ESTA SEPARADA, que costo una vuelta el 22/09/2026:
--    este bloque vivia dentro del SELECT de arriba, como un subselect al lado
--    de la llamada a cron.schedule(). Y un subselect de la MISMA sentencia lee
--    la instantanea MVCC tomada ANTES del INSERT que hace cron.schedule, asi
--    que la salida decia "OK - vigilante creado con jobid 11" y acto seguido
--    listaba un unico job, el 10. Las dos cosas eran ciertas y juntas parecian
--    una contradiccion.
--
--    Es otra vez la misma forma de siempre (§6.1, §12.2): un instrumento que
--    contesta sin haber medido lo que crees que mide — solo que esta vez el
--    instrumento defectuoso era mi propia comprobacion.
--
-- Sentencia aparte = instantanea nueva = ve lo que la anterior escribio. Y va
-- LA ULTIMA a proposito: el SQL Editor solo MUESTRA el resultado de la ultima.
SELECT jsonb_pretty(jsonb_build_object(
    'vigilante_existe', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigilante-reloj'),
    'jobs', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'jobid',    j.jobid,
                   'jobname',  j.jobname,
                   'schedule', j.schedule,
                   'active',   j.active,
                   -- El secreto se tapa DENTRO de la consulta, para que la
                   -- salida se pueda pegar entera sin pensarlo.
                   'command',  regexp_replace(
                                   regexp_replace(j.command, '(Bearer\s+)[^"]*', '\1<OCULTO>', 'g'),
                                   '[0-9a-f]{32,}', '<OCULTO>', 'g')
               ) ORDER BY j.jobid), '[]'::jsonb)
          FROM cron.job j)
)) AS comprobacion;


-- ── 4. Comprobación, diez minutos después ──────────────────────────────────
-- El vigilante devuelve 200 con {"veredicto":"ok",...}. Un 401 significa que
-- la función se desplegó SIN --no-verify-jwt: el cuerpo lo dice
-- ({"code":"UNAUTHORIZED_NO_AUTH_HEADER"} = la puerta de Supabase; un error
-- propio de la función = el codigo, que es lo correcto). Ver §6.1.
--
--   SELECT status_code, left(content, 200), created
--     FROM net._http_response
--    WHERE created > now() - interval '30 minutes'
--    ORDER BY created DESC LIMIT 10;
