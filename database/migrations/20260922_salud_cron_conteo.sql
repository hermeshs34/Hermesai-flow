-- ═══════════════════════════════════════════════════════════════════════════
-- 20260922 — salud_cron(): el vigilante deja de contarse a sí mismo
--
-- QUÉ ARREGLA
-- `salud_cron()` cuenta dos cosas sobre `net._http_response` en los últimos
-- diez minutos:
--
--     v_ok_10min    -> respuestas 200 cuyo cuerpo trae "checked"  (cron-runner)
--     v_resp_10min  -> TODAS las respuestas de la ventana
--
-- Desde el 22/09/2026 hay un segundo job, `vigilante-reloj` (*/10), y su
-- propia respuesta 200 cae en el denominador sin poder caer nunca en el
-- numerador: no dice "checked", dice "veredicto". Resultado, en el correo de
-- aviso y en el Dashboard:
--
--     Respuestas OK (10 min):  10 de 11
--
-- El veredicto es correcto —solo necesita v_ok_10min > 0—, pero el número que
-- lee una persona sugiere un fallo que no existe. Y eso, en este proyecto, no
-- es cosmético: la familia entera de incidentes que tenemos anotada (el
-- `succeeded` de pg_cron §6.1, el `✓ Guardado` sin escritura §12.2, el punto
-- verde del Dashboard) son instrumentos que contestan sin haber medido lo que
-- el lector cree que miden. Un ratio que enseña un fallo permanente enseña a
-- ignorar el instrumento, que es la misma avería por el otro lado.
--
-- POR QUÉ ES UN FICHERO NUEVO Y NO UNA EDICIÓN DE 20260922_salud_cron.sql
-- Esa migración YA ESTÁ APLICADA en producción. Editarla en su sitio dejaría
-- el repositorio describiendo algo distinto de lo que se ejecutó — que es
-- exactamente cómo `schema.sql` divergió en más de treinta puntos (§5.1).
-- Un defecto en una migración aplicada se corrige con OTRA migración, igual
-- que se hizo con 20260814_definicion_cambiada_conexiones.sql.
--
-- POR QUÉ ES SOLO SQL, SIN REDESPLEGAR NINGUNA EDGE FUNCTION
-- La etiqueta del correo (`${s.respuestas_ok_10min} de ${s.respuestas_10min}`,
-- vigilante-reloj/index.ts) queda bien EN CUANTO el denominador es correcto.
-- Y cada `functions deploy` que se olvide de --no-verify-jwt reintroduce en
-- silencio el fallo de los ocho días de cron muerto (§6.1): no hay config.toml
-- y la bandera no se recuerda sola. Un despliegue que no hace falta es riesgo
-- puro. No se toca nada de supabase/functions/.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.salud_cron()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Las tablas de cron/ y net/ van calificadas por su esquema a mano, así que
-- el search_path se queda corto a propósito.
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_job         record;
    v_tick        timestamptz;
    v_ok_10min    integer := 0;
    v_resp_10min  integer := 0;
    v_vigi_10min  integer := 0;
    v_malo        record;
    v_ultimo_cron timestamptz;
    v_veredicto   text;
    v_motivo      text;
    v_grave       boolean := true;
BEGIN
    -- Quién puede preguntar.
    -- auth.uid() es NULL cuando llama service_role (la Edge Function del
    -- vigilante). `anon` no llega aquí: se le retira EXECUTE por su nombre
    -- más abajo, porque REVOKE ... FROM PUBLIC no basta (§6.4).
    IF auth.uid() IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.profiles p
                       WHERE p.id = auth.uid() AND p.is_active) THEN
            RAISE EXCEPTION 'Sin perfil activo';
        END IF;
    END IF;

    -- ¿Existe el job?
    SELECT j.jobid, j.jobname, j.schedule, j.active
      INTO v_job
      FROM cron.job j
     WHERE j.command LIKE '%/cron-runner%'
        OR j.jobname = 'cron-runner-cada-minuto'
     ORDER BY j.jobid DESC
     LIMIT 1;

    IF v_job.jobid IS NOT NULL THEN
        SELECT max(d.start_time) INTO v_tick
          FROM cron.job_run_details d
         WHERE d.jobid = v_job.jobid;
    END IF;

    -- La verdad del HTTP. `net._http_response` NO guarda la url, así que no
    -- se puede filtrar por destino: se distingue por el CUERPO.
    --
    --   · cron-runner     200 -> {"checked":N,...}
    --   · vigilante-reloj 200 -> {"veredicto":"...","motivo":"...",...}
    --   · las dos, 401/500   -> {"error":"..."}  (indistinguibles, y da igual:
    --                           un error es un error y debe verse)
    --
    -- ⚠️ EL VIGILANTE NO SE CUENTA A SÍ MISMO. Su 200 no puede casar nunca con
    --    "checked", así que sumarlo al denominador pinta un fallo permanente.
    --    Comprobado el 22/09/2026 contra cron-runner/index.ts: sus tres
    --    respuestas son {"checked":...} y {"error":...} — no emite la cadena
    --    "veredicto" en ningún caso, así que este filtro no puede descartar
    --    por error una respuesta suya.
    --
    -- ⚠️ Esta tabla es UNLOGGED: un reinicio del proyecto la vacía. Por eso
    --    la ventana es corta y esto no sirve para arqueología — el 10/09 la
    --    prueba de qué pasó en la capa HTTP se perdió exactamente así.
    --
    -- El `coalesce(..., false)` NO es adorno. Una fila con `content` NULL
    -- —o con `status_code` NULL, que es como pg_net guarda un timeout— hace
    -- que la comparación valga NULL, y un `NOT NULL` es NULL: FILTER la
    -- descartaría. Se caería del denominador justo la fila que mas hay que
    -- contar, la del timeout, y el ratio volvería a mentir por el otro lado.
    -- Misma familia que el `token !== ''` de §6.1 y la huella NULL de §9.5: lo
    -- que no se puede comprobar no puede acabar diciendo que sí.
    SELECT count(*) FILTER (WHERE r.status_code = 200 AND r.content LIKE '%checked%'),
           count(*) FILTER (WHERE NOT coalesce(r.status_code = 200
                                               AND r.content LIKE '%veredicto%', false)),
           count(*) FILTER (WHERE coalesce(r.status_code = 200
                                           AND r.content LIKE '%veredicto%', false))
      INTO v_ok_10min, v_resp_10min, v_vigi_10min
      FROM net._http_response r
     WHERE r.created > now() - interval '10 minutes';

    SELECT r.status_code, left(coalesce(r.content, ''), 200) AS content,
           r.timed_out, r.error_msg, r.created
      INTO v_malo
      FROM net._http_response r
     WHERE r.created > now() - interval '60 minutes'
       AND (r.status_code IS DISTINCT FROM 200 OR r.error_msg IS NOT NULL)
     ORDER BY r.created DESC
     LIMIT 1;

    SELECT max(er.started_at) INTO v_ultimo_cron
      FROM public.execution_runs er
     WHERE er.triggered_by = 'cron';

    -- ── Veredicto, de lo más grave a lo más leve ───────────────────────────
    IF v_job.jobid IS NULL THEN
        v_veredicto := 'sin_reloj';
        v_motivo    := 'No hay ningún job de pg_cron apuntando a cron-runner. '
                    || 'Nada se va a ejecutar solo hasta que se vuelva a crear.';

    ELSIF NOT v_job.active THEN
        v_veredicto := 'reloj_apagado';
        v_motivo    := format('El job "%s" existe pero está desactivado.', v_job.jobname);

    ELSIF v_tick IS NULL OR v_tick < now() - interval '5 minutes' THEN
        v_veredicto := 'reloj_parado';
        v_motivo    := format('El job "%s" no se dispara desde %s. El planificador no corre.',
                              v_job.jobname,
                              coalesce(to_char(v_tick, 'YYYY-MM-DD HH24:MI') || ' UTC', 'nunca'));

    ELSIF v_ok_10min = 0 THEN
        -- El reloj late pero la llamada no llega, o la rechazan. Es el punto
        -- ciego de §6.1: pg_cron marca 'succeeded' porque net.http_post solo
        -- ENCOLA. Aquí es donde se habría visto el 401 de los ocho días.
        v_veredicto := 'sin_respuesta';
        v_motivo    := CASE
            -- No se dice "cron-runner respondió": la ventana de v_malo es de
            -- 60 minutos y la tabla no guarda la url, así que el fallo podría
            -- ser del propio vigilante. Se enseña el cuerpo y que lo juzgue
            -- quien lee — afirmar el origen sería afirmar lo que no se midió.
            WHEN v_malo.status_code IS NOT NULL THEN
                format('El reloj late, pero la última llamada HTTP devolvió %s: %s',
                       v_malo.status_code, v_malo.content)
            -- Ahora esta rama dice MÁS que antes: si el vigilante está
            -- corriendo —y si estás leyendo esto por correo, está corriendo—,
            -- pg_net entrega. Que no haya ni una respuesta de las demás
            -- peticiones señala la capa de encolado, no la red entera.
            WHEN v_resp_10min = 0 THEN
                'El reloj late, pero ninguna de sus peticiones ha devuelto respuesta '
                || 'en 10 minutos: se encolan y no llegan a salir.'
            ELSE
                'El reloj late y hay respuestas HTTP, pero ninguna de cron-runner.'
        END;

    ELSE
        v_veredicto := 'ok';
        v_motivo    := format('%s respuestas correctas en los últimos 10 minutos.', v_ok_10min);
        v_grave     := false;
    END IF;

    RETURN jsonb_build_object(
        'veredicto',           v_veredicto,
        'grave',               v_grave,
        'motivo',              v_motivo,
        'job_existe',          v_job.jobid IS NOT NULL,
        'job_nombre',          v_job.jobname,
        'job_schedule',        v_job.schedule,
        'job_activo',          v_job.active,
        'ultimo_tick',         v_tick,
        'respuestas_10min',    v_resp_10min,
        'respuestas_ok_10min', v_ok_10min,
        -- Se publica en vez de descartarse en silencio: quien compare este
        -- resultado con un `select count(*) from net._http_response` tiene
        -- que poder cuadrar la diferencia sin leer esta función.
        'respuestas_vigilante_10min', v_vigi_10min,
        'ultimo_fallo_http',   CASE WHEN v_malo.status_code IS NULL THEN NULL
                                    ELSE jsonb_build_object(
                                        'status',  v_malo.status_code,
                                        'cuando',  v_malo.created,
                                        'timeout', v_malo.timed_out,
                                        'error',   v_malo.error_msg,
                                        'cuerpo',  v_malo.content) END,
        -- Informativo, NO entra en el veredicto: que no haya ejecuciones
        -- automáticas no demuestra que el reloj esté roto (puede que a nadie
        -- le tocara). Es justo la ambigüedad que motivó esta función.
        'ultima_ejecucion_cron', v_ultimo_cron,
        'medido_at',             now()
    );
END;
$fn$;

COMMENT ON FUNCTION public.salud_cron() IS
'Estado real del planificador: si el job existe, si late y si la llamada HTTP llega. El vigilante no se cuenta a si mismo. Nunca devuelve el command del job (contiene CRON_SECRET).';

-- CREATE OR REPLACE conserva la ACL, así que esto es redundante a propósito:
-- se repite para que el fichero diga por sí solo cuáles son los permisos
-- correctos, y para que un CREATE limpio en otro entorno los deje igual.
-- REVOKE ... FROM PUBLIC no quita el EXECUTE que los ALTER DEFAULT PRIVILEGES
-- de Supabase conceden a anon POR SU NOMBRE. Hay que nombrarlo (§6.4).
REVOKE ALL ON FUNCTION public.salud_cron() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salud_cron() FROM anon;
GRANT EXECUTE ON FUNCTION public.salud_cron() TO authenticated;
GRANT EXECUTE ON FUNCTION public.salud_cron() TO service_role;


-- ── Comprobación ───────────────────────────────────────────────────────────
-- UNA sola sentencia, porque el SQL Editor solo MUESTRA la última.
--
-- Qué tiene que salir:
--   · salud.veredicto                  = "ok"
--   · salud.respuestas_ok_10min        = las de "cron-runner" del desglose
--   · salud.respuestas_10min           = el total del desglose MENOS las de
--                                        "vigilante-reloj"
--   · salud.respuestas_vigilante_10min = las de "vigilante-reloj" (0 o 1: el
--                                        vigilante corre cada 10 minutos)
--   · quien_puede_ejecutar             NO debe contener "anon"
SELECT jsonb_pretty(jsonb_build_object(
    'salud', public.salud_cron(),
    'desglose_10min', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'quien',   d.quien,
                   'status',  d.status_code,
                   'cuantas', d.n) ORDER BY d.quien, d.status_code), '[]'::jsonb)
          FROM (SELECT CASE
                         WHEN r.status_code = 200 AND r.content LIKE '%veredicto%' THEN 'vigilante-reloj'
                         WHEN r.status_code = 200 AND r.content LIKE '%checked%'   THEN 'cron-runner'
                         ELSE 'otro o error'
                       END AS quien,
                       r.status_code,
                       count(*) AS n
                  FROM net._http_response r
                 WHERE r.created > now() - interval '10 minutes'
                 GROUP BY 1, 2) d),
    'quien_puede_ejecutar', (
        SELECT coalesce(jsonb_agg(DISTINCT a.grantee::regrole::text), '[]'::jsonb)
          FROM pg_proc p, aclexplode(p.proacl) a
         WHERE p.oid = 'public.salud_cron()'::regprocedure
           AND a.privilege_type = 'EXECUTE')
)) AS comprobacion;
