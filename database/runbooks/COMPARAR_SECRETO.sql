-- ═══════════════════════════════════════════════════════════════════════════
-- COMPARAR_SECRETO.sql — ¿el token del job es el CRON_SECRET de verdad?
--
-- El job (jobid 9) late cada minuto y cron-runner contesta 401 con SU PROPIO
-- mensaje ("No autorizado — cron-runner solo lo invoca el planificador"), no
-- con el del gateway. Traducido: el formato está bien —el prefijo "Bearer "
-- sobrevivió, la puerta de Supabase deja pasar— y lo que falla es el VALOR.
--
-- cron-runner/index.ts:175-176 hace exactamente esto:
--     token = Authorization sin "Bearer "  →  esCron = token === CRON_SECRET
--
-- Esta consulta NO enseña el secreto: compara huellas. El `value` que imprime
-- `supabase secrets list` es un sha256 hex del valor (comprobado contra dos
-- URLs conocidas), así que basta hashear el token del job y contrastar.
-- ═══════════════════════════════════════════════════════════════════════════

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

  'token_del_job', jsonb_build_object(
      'longitud',       length(t.tok),          -- esperado: 64
      'solo_hex',       t.tok ~ '^[0-9a-fA-F]+$',
      'tiene_espacios', t.tok <> btrim(t.tok),
      'sha256',         encode(sha256(convert_to(t.tok, 'utf8')), 'hex')),

  -- Huella del CRON_SECRET que hay puesto en Edge Functions -> Secrets.
  -- Rotado el 22/09/2026 17:25 UTC porque el panel no dejaba revelar el
  -- el job viejo funcionó 47.701 veces seguidas. El secreto guardado no es
  -- el problema.
  'sha256_del_secreto_guardado',
      'PEGA_AQUI_EL_SHA256_DE_CRON_SECRET',

  -- ✅ LA RESPUESTA
  'casan', encode(sha256(convert_to(t.tok, 'utf8')), 'hex')
           = 'PEGA_AQUI_EL_SHA256_DE_CRON_SECRET',

  -- ⚠️ TRAMPA QUE YO MISMO PUSE: `supabase secrets list` llama "value" a lo
  -- que en realidad es la HUELLA, y esa huella son 64 caracteres hex — la
  -- misma forma exacta que CRON_SECRET. Si el valor pegado en el job es la
  -- huella en vez del secreto, esto sale true y ya sabemos qué pasó.
  'se_pego_la_huella_en_vez_del_secreto',
      lower(t.tok) = 'PEGA_AQUI_EL_SHA256_DE_CRON_SECRET'

)) as comparacion
from (
  select substring(command from 'Bearer ([^"]+)') as tok
  from cron.job
  where jobname = 'cron-runner-cada-minuto'
) t;
