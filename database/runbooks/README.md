# `database/runbooks/` — consultas de diagnóstico, no migraciones

Aquí vive el SQL que se **lee** para averiguar algo, no el que **cambia** la
base. Lo que modifica el esquema va en `database/migrations/` y se nombra
`YYYYMMDD_desc.sql`; lo de esta carpeta se puede ejecutar mil veces sin efecto.

**La única excepción es [`ROTAR_CRON_SECRET.sql`](ROTAR_CRON_SECRET.sql)**, que
sí escribe —crea el job de pg_cron— y está aquí porque es un procedimiento
manual y puntual, no un cambio de esquema que haya que replicar en otro entorno.

## Dos reglas que gobiernan todo lo de esta carpeta

1. **Una sola sentencia por fichero.** El SQL Editor de Supabase ejecuta todo
   lo que le pegas pero **solo MUESTRA el resultado de la última sentencia**;
   las demás corren y su salida se descarta en silencio. Un diagnóstico de
   siete consultas devuelve la séptima y nada más, y quien lo pegó lee con toda
   la razón «eso fue todo lo que arrojó». Por eso cada fichero envuelve todos
   sus bloques en un único `select jsonb_pretty(jsonb_build_object(...))`.

2. **Los secretos se enmascaran DENTRO de la consulta**, con
   `regexp_replace(command, '(Bearer\s+)[^"]*', '\1<OCULTO>', 'g')`, para que la
   salida se pueda pegar entera sin tener que pensarlo. Ninguna de estas
   consultas devuelve el `command` de un job en crudo: ahí va `CRON_SECRET`.

## Qué hay

| Fichero | Para qué |
|---|---|
| [`DIAGNOSTICO_CRON.sql`](DIAGNOSTICO_CRON.sql) | Foto completa del planificador: jobs, historial, respuestas HTTP, ejecuciones, extensiones y quién es el usuario. Es por donde se empieza cuando «no se ejecuta nada solo». |
| [`VERIFICAR_CRON.sql`](VERIFICAR_CRON.sql) | Comprobación corta después de tocar el job: ¿late, y la llamada HTTP devuelve 200? |
| [`VERIFICAR_VIGILANTE.sql`](VERIFICAR_VIGILANTE.sql) | Lo mismo para el job `vigilante-reloj` (§ el vigilante de abajo), más el estado de `public.vigilante_reloj`. |
| [`CIERRE_INCIDENTE.sql`](CIERRE_INCIDENTE.sql) | La única pregunta que le importa al usuario: **¿arrancó un flujo SOLO, sin nadie delante?** Que el job exista y conteste 200 no es lo mismo. Sirve igual si la respuesta es «no»: dice si el flujo está activo y publicado antes de que a nadie le dé por tocar el planificador. |
| [`HISTORIAL_DEFINICION_BCV.sql`](HISTORIAL_DEFINICION_BCV.sql) | Traza del ciclo de vida (§6.7) del flujo BCV: `workflow_autorizaciones` y `audit_log`. Para saber si un cambio de hora lo despublicó y quién lo volvió a autorizar. |
| [`COMPARAR_SECRETO.sql`](COMPARAR_SECRETO.sql) | ¿El token que lleva el job es el `CRON_SECRET` de verdad? Compara **huellas**, nunca valores. |
| [`ROTAR_CRON_SECRET.sql`](ROTAR_CRON_SECRET.sql) | Genera un secreto nuevo **dentro de la base** y crea el job con él en la misma sentencia, para que el valor no cruce ningún portapapeles. |
| [`HUECO_10SEP.sql`](HUECO_10SEP.sql) | Arqueología del hueco del 10/09/2026: audita `audit_log`, `execution_runs` y el historial del job alrededor de la fecha en que desapareció el planificador. |

## Lo que hay que saber antes de leer cualquier salida

- **pg_cron dice `succeeded` aunque el HTTP haya devuelto 401.** `net.http_post`
  es asíncrono: encola y devuelve un id, y ese id es el «1 row» que pg_cron
  guarda como resultado. **La verdad está en `net._http_response`**
  (`status_code`, `content`, `timed_out`). Ese instrumento —que informaba de
  salud sin medirla— escondió un fallo ocho días en agosto de 2026.
- **`net._http_response` es UNLOGGED: un reinicio del proyecto la vacía.** No
  sirve para arqueología. La prueba de qué pasó en la capa HTTP el 10/09/2026 se
  perdió exactamente así.
- **`cron.job` es una tabla normal**, no unlogged. Un reinicio **no** borra los
  jobs. Historial intacto + definición ausente es la firma de un
  `cron.unschedule`, no la de un restart.
- **`supabase secrets list` imprime en la columna `value` el sha256, no el
  valor.** Son 64 caracteres hex, la misma forma exacta que `CRON_SECRET`: un
  impostor perfecto. Pegar eso en el job crea un job impecable y muerto.
- ⛔ **`database/migrations/20260807_restaurar_pg_cron.sql` NO SE EJECUTA.** Su
  PASO 3 desprograma todo lo que case con `%cron-runner%` y su PASO 4 —el que
  vuelve a crear el job— está comentado. Deja el planificador a cero sin dar un
  solo error. Es el sospechoso número uno del hueco del 10/09.

## El vigilante

Desde el 22/09/2026 hay un segundo job, `vigilante-reloj` (`*/10 * * * *`), que
llama a la Edge Function del mismo nombre, mide con `public.salud_cron()` y
manda correo a los administradores cuando el reloj no está. Ni su nombre ni su
comando contienen la cadena `cron-runner`, **a propósito**: el barrido del
`20260807` se lo llevaría por delante junto al job al que vigila.

Su límite, dicho claro: lo dispara el mismo pg_cron al que vigila. Cubre que
borren o desactiven el job de `cron-runner`, y que `cron-runner` conteste 401 o
500. **No cubre que se caiga pg_cron entero ni que alguien borre los dos jobs.**
Para eso haría falta un pinger externo a la base.
