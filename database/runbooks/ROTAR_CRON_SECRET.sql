-- ═══════════════════════════════════════════════════════════════════════════
-- ROTAR_CRON_SECRET.sql — 22/09/2026
--
-- El panel no deja revelar el CRON_SECRET que hay puesto (los secretos de
-- Edge Functions son de solo escritura una vez guardados), así que no se
-- puede reparar el job con el valor antiguo: hay que poner uno nuevo en los
-- dos sitios donde tiene que coincidir.
--
-- IDEA: el secreto SE GENERA AQUÍ DENTRO y el job se crea con él EN LA MISMA
-- SENTENCIA. O sea, el valor que acaba en cron.job no ha pasado por ningún
-- portapapeles, ninguna capa de comillas ni ningún chat — que es como se
-- estropeó las tres veces anteriores (07/08 perdió el prefijo "Bearer",
-- 12/08 llegó truncado, 22/09 se quedó el marcador sin sustituir).
--
-- Del viaje que SÍ queda —de esta pantalla al panel de Secrets— nos
-- enteramos si sale mal, porque la consulta imprime también el sha256 y ese
-- mismo sha256 es lo que publica `npx supabase secrets list`.
--
-- ⚠️ A QUIÉN AFECTA: CRON_SECRET lo leen TRES funciones — cron-runner,
--    execute-workflow y resolve-approval. Comparten el mismo secreto del
--    almacén, así que cambiarlo las actualiza a las tres a la vez y NO hay
--    que redesplegar ninguna. (Redesplegar sin --no-verify-jwt es justo lo
--    que reintroduce el fallo de los ocho días de cron muerto, §6.1.)
--
-- ⚠️ PERO las tres lo leen en el CUERPO DEL MÓDULO (`const CRON_SECRET =
--    Deno.env.get(...)` en la línea 12/18/19), no dentro del handler. Eso se
--    evalúa al arrancar el isolate, así que el valor nuevo entra cuando
--    Supabase recicla los workers, no necesariamente en la petición
--    siguiente. Si justo después de guardar el secreto sigue saliendo 401,
--    espera un par de minutos antes de dar nada por roto.
--
-- ⚠️ NO me pegues la salida entera: el campo `secreto_nuevo` es una
--    credencial. Pégame solo `sha256_para_verificar`, que es un hash y no
--    sirve para autenticarse.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Dejar el planificador a cero (se lleva el jobid 9, que está roto) ───
select cron.unschedule(jobid)
from cron.job
where command like '%cron-runner%'
   or jobname in ('cron-runner-cada-minuto', 'hermesai-flow-cron-runner');


-- ── 2. Generar el secreto Y crear el job con él, de una vez ───────────────
--
-- 64 hex a partir de dos gen_random_uuid(). Se usa eso y no gen_random_bytes
-- para no depender de que pgcrypto esté disponible: gen_random_uuid() es del
-- núcleo desde PG13 y tira de pg_strong_random, así que la aleatoriedad es
-- criptográfica igual. Dos UUID v4 = 244 bits de entropía.
--
-- `as materialized` NO es decorativo: sin él, un CTE referenciado varias
-- veces se podría evaluar más de una vez y gen_random_uuid() devolvería
-- valores DISTINTOS — el job se crearía con un secreto y en pantalla saldría
-- otro, y el fallo sería idéntico al 401 de hoy pero imposible de entender.

with nuevo as materialized (
    select replace(gen_random_uuid()::text, '-', '')
        || replace(gen_random_uuid()::text, '-', '') as secreto
)
select jsonb_pretty(jsonb_build_object(

    -- PASO A: copiar esto al panel → Edge Functions → Secrets → CRON_SECRET
    --         (editar el que ya existe, no crear otro).
    'secreto_nuevo', n.secreto,

    -- PASO B: esto sí se puede enseñar. Tras guardar en el panel,
    --         `npx supabase secrets list` debe publicar este mismo valor en
    --         el campo "value" de CRON_SECRET — ese campo es el sha256, no
    --         el secreto. Si coincide, el viaje al panel salió bien.
    'sha256_para_verificar', encode(sha256(convert_to(n.secreto, 'utf8')), 'hex'),

    -- El job queda creado ya, con el valor de arriba metido directamente.
    -- Disparará 401 hasta que el PASO A esté hecho: es lo esperado.
    'jobid', cron.schedule(
        'cron-runner-cada-minuto',
        '* * * * *',
        format(
            'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 30000);',
            'https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/cron-runner',
            jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ' || n.secreto
            )::text,
            '{}'
        )
    )

)) as rotacion
from nuevo n;


-- ── Rollback ────────────────────────────────────────────────────────────────
--   select cron.unschedule('cron-runner-cada-minuto');
