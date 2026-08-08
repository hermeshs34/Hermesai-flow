-- ═══════════════════════════════════════════════════════════════════════════
-- 20260807 — Restaurar el disparador automático (pg_cron -> cron-runner)
--
-- CONTEXTO
-- La última ejecución con triggered_by='cron' es del 2026-07-30T14:00. Desde
-- entonces TODO run es manual: pg_cron dejó de invocar a cron-runner durante el
-- incidente del bucle del 01/08 y nunca se volvió a programar. El motor evalúa
-- bien las expresiones cuando se le llama; lo que falta es quien le llame.
--
-- Los runs del 30/07 llegan EN PAREJAS separadas por segundos, o sea que había
-- DOS jobs apuntando al mismo sitio. Por eso el paso 3 borra todo lo que huela
-- a cron-runner antes de crear uno solo.
--
-- ANTES DE EJECUTAR ESTO ya está desplegado en las Edge Functions:
--   * cron-runner filtra por workflows.is_active (antes miraba status='paused',
--     valor que esa columna nunca toma), así que solo arranca lo que de verdad
--     está marcado Activo en pantalla: hoy, UN flujo. Los duplicados quedan
--     fuera aunque todavía no se hayan borrado.
--   * cron-runner compara contra America/Caracas, no contra UTC. Un "0 9" ahora
--     salta a las 9 de la mañana de Venezuela, no a las 5.
--   * cron-runner exige CRON_SECRET y devuelve 401 a cualquier otra cosa. El
--     job de abajo DEBE mandarlo o no entrará. Ver el aviso del paso 4 sobre
--     por qué NO se usa aquí la service_role key.
--
-- ESTADO: APLICADO Y VERIFICADO el 08/08/2026 12:55 UTC — primer run disparado
-- por cron desde el 30/07. El job vivo es el jobid 8. Este fichero se conserva
-- como registro de lo que se hizo y por qué; volver a ejecutarlo entero NO hace
-- falta, y el paso 3 retiraría el job bueno.
--
-- CÓMO EJECUTARLO
-- Supabase -> SQL Editor, un bloque cada vez, comprobando el resultado.
-- El paso 4 va SOLO en su propia consulta.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Comprobar que las extensiones están habilitadas ──────────────────────
-- Tienen que salir las dos. Si falta alguna: Database -> Extensions.
select extname from pg_extension where extname in ('pg_cron', 'pg_net');


-- ── 2. Ver qué jobs hay ahora mismo ─────────────────────────────────────────
-- Se espera que NO haya ninguno de cron-runner (por eso no corre nada).
select jobid, jobname, schedule, active, command
from cron.job
order by jobid;


-- ── 3. Dejar el planificador a cero ─────────────────────────────────────────
-- Retira cualquier job que apunte a cron-runner, con el nombre que sea. Si no
-- hay ninguno devuelve cero filas, que es lo esperado. Esto es lo que impide
-- repetir el duplicado del 30/07.
select cron.unschedule(jobid), jobname
from cron.job
where command like '%cron-runner%'
   or jobname in ('cron-runner-cada-minuto', 'hermesai-flow-cron-runner');


-- ── 4. Programar UNO solo — EJECUTAR EN UNA CONSULTA APARTE ─────────────────
--
-- ⚠️ ESTE ES EL ÚNICO PASO QUE CREA EL JOB. Los demás miran o limpian.
-- Va comentado a propósito para que no se lance sin la clave puesta, así que
-- hay que DESCOMENTARLO Y PEGARLO A MANO. Saltárselo y pasar al paso 5 da
-- "Success. No rows returned", que no es un fallo del paso 5: es que no hay job.
-- Debe devolver un número (el jobid).
--
-- Sustituir SOLO_LA_CLAVE por el valor de CRON_SECRET (Supabase -> Edge
-- Functions -> Secrets). NO se guarda en el repositorio: queda en cron.job, que
-- solo lee el superusuario de la base.
--
-- ⚠️ AQUÍ NO VA LA service_role KEY, y no es una preferencia: este proyecto usa
-- el formato NUEVO de claves (sb_secret_..., 41 caracteres, NO es un JWT) y
-- supabase-js las manda en la cabecera `apikey`, dejando `Authorization` vacía.
-- Cualquier función que reconozca lo interno comparando `Authorization` contra
-- SUPABASE_SERVICE_ROLE_KEY da siempre falso. CRON_SECRET son 64 caracteres hex
-- —sin nada que un copiar-pegar pueda estropear en silencio— y las llamadas
-- entre funciones se identifican con la cabecera `x-cron-secret`.
--
-- ⚠️ LA PALABRA "Bearer " Y EL ESPACIO QUE LA SIGUE SE QUEDAN. Es lo que exige
-- el protocolo HTTP y la puerta de Supabase lo comprueba antes de llegar a la
-- función. Aquí el marcador iba pegado a "Bearer " y al seleccionar de comilla
-- a comilla se sustituyeron las dos cosas: la cabecera quedó
-- "Authorization": "eyJhbGci..." sin prefijo, y CADA llamada del cron devolvió
--     {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT",
--      "message":"Auth header is not 'Bearer {token}'"}
-- durante ocho días, invisible porque net.http_post es asíncrono y
-- cron.job_run_details marcaba 'succeeded' igual (ver paso 6). Por eso el
-- marcador de ahora va separado y no se puede confundir con el prefijo.
--
-- MEJOR AÚN: no pegarlo a mano. El job vivo se creó desde dentro de una Edge
-- Function pasando el comando como PARÁMETRO ($1) de cron.schedule, así el
-- secreto no cruza ninguna capa de comillas ni ningún portapapeles. La base es
-- alcanzable desde una función con SUPABASE_DB_URL, que la plataforma inyecta.
--
-- El timeout es deliberado: el de pg_net por defecto son 5000 ms, y cuando
-- cron-runner hace trabajo real (disparar un flujo y mandar correos) los pasa.
-- La función sigue corriendo en el servidor, pero el registro diría que falló.
--
-- Las comillas simples van dobladas a propósito. Nada de dollar-quotes aquí:
-- el separador de sentencias del SQL Editor también las detecta dentro de los
-- comentarios y parte el bloque por la mitad.
--
--   select cron.schedule(
--       'cron-runner-cada-minuto',
--       '* * * * *',
--       'SELECT net.http_post(
--           url     := ''https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/cron-runner'',
--           headers := ''{"Content-Type": "application/json", "Authorization": "Bearer SOLO_LA_CLAVE"}''::jsonb,
--           body    := ''{}''::jsonb,
--           timeout_milliseconds := 30000
--       );'
--   );


-- ── 4b. Si el job ya existe y solo hay que corregirle la cabecera ────────────
-- Repara el comando EN EL SITIO, sin volver a pegar la clave: le añade el
-- prefijo "Bearer " que falte y el timeout. Es la forma segura de tocar un job
-- ya creado, porque la clave nunca sale de la base ni pasa por el portapapeles.
--
--   select cron.alter_job(
--       6,
--       command := regexp_replace(
--           replace(
--               (select command from cron.job where jobid = 6),
--               '"Authorization": "ey',
--               '"Authorization": "Bearer ey'
--           ),
--           '\)\s*;\s*$',
--           ', timeout_milliseconds := 30000);'
--       )
--   );
--
-- Y para verlo sin exponer el secreto (debe salir "Bearer <CLAVE_OCULTA>"):
--
--   select jobid, regexp_replace(command, '(Bearer\s+)[^"]*', '\1<CLAVE_OCULTA>', 'g')
--   from cron.job where jobid = 6;


-- ── 5. Verificar que quedó exactamente uno ──────────────────────────────────
-- Una sola fila, active = true.
select jobid, jobname, schedule, active from cron.job;


-- ── 6. Verificar que corre de verdad (esperar 2 minutos) ────────────────────
--
-- ⚠️ ESTA TABLA NO SIRVE PARA SABER SI LA LLAMADA FUNCIONÓ. net.http_post es
-- ASÍNCRONO: encola la petición y devuelve un id al instante. Ese id es el
-- "1 row" del return_message, y pg_cron marca 'succeeded' porque el encolado
-- salió bien — aunque el HTTP devuelva 401 un momento después. Así estuvo ocho
-- días diciendo que todo iba bien mientras nada corría.
--
-- Sirve solo para confirmar que el planificador dispara cada minuto:
select jobid, runid, status, return_message, start_time
from cron.job_run_details
order by start_time desc
limit 10;

-- El código HTTP DE VERDAD está aquí. Es la consulta que hay que mirar:
-- status_code 200 y content con {"checked":N,"fired":N,...}. Un 401 con
-- UNAUTHORIZED_INVALID_JWT_FORMAT es la cabecera mal formada (paso 4b); un 401
-- con "No autorizado — cron-runner solo lo invoca el planificador" es la puerta
-- de la propia función, o sea que el token no coincide con CRON_SECRET.
--
-- Ojo: si el 401 viene de la puerta de Supabase y no del código, es que la
-- función se desplegó SIN --no-verify-jwt. cron-runner se autoriza a sí misma;
-- con la verificación del gateway activada el rechazo llega antes y no explica
-- nada.
select id, status_code, content, timed_out, error_msg, created
from net._http_response
order by created desc
limit 10;


-- ── 7. Confirmar que el motor vuelve a disparar flujos ──────────────────────
-- Al día siguiente hábil pasadas las 09:00 de Venezuela tiene que aparecer aquí
-- una fila nueva. Mientras salga solo la del 30/07, el cron sigue sin llegar.
select id, workflow_id, triggered_by, status, started_at
from execution_runs
where triggered_by = 'cron'
order by started_at desc
limit 10;


-- ── Rollback ────────────────────────────────────────────────────────────────
--   select cron.unschedule('cron-runner-cada-minuto');
