-- ═══════════════════════════════════════════════════════════════════════════
-- 20260922 — salud_cron(): que el reloj se pueda MEDIR, no suponer
--
-- POR QUÉ
-- El 10/09/2026 el planificador se quedó sin job y estuvo DOCE DÍAS sin
-- disparar nada. El Dashboard tenía un indicador y no mintió: decía
-- "sin ejecuciones automáticas · últimos 7 días". El problema es que esa
-- frase es verdad en dos situaciones muy distintas:
--
--     a) a ningún flujo le tocaba        -> normal
--     b) NO EXISTE EL RELOJ              -> producción parada
--
-- y desde `execution_runs` no se pueden distinguir. Es la misma forma de
-- siempre (el `succeeded` de pg_cron en §6.1, el `✓ Guardado` de §12.2):
-- un instrumento que contesta sin haber medido lo que crees que mide.
--
-- Lo que hace falta para distinguirlas vive en `cron.job`,
-- `cron.job_run_details` y `net._http_response`: tres tablas que PostgREST
-- no expone y que el navegador no puede leer. De ahí esta RPC.
--
-- ⚠️ NO DEVUELVE EL `command` DEL JOB EN NINGÚN CASO: ahí va CRON_SECRET.
--    Solo booleanos, marcas de tiempo y un veredicto en castellano.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Estado del vigilante ────────────────────────────────────────────────
-- Fila única. Sirve para no repetir el mismo aviso cada diez minutos y para
-- saber si toca mandar el correo de "el reloj volvió".
CREATE TABLE IF NOT EXISTS public.vigilante_reloj (
    id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    ultimo_estado   text,
    ultimo_ok_at    timestamptz,
    ultimo_aviso_at timestamptz,
    avisos_enviados integer NOT NULL DEFAULT 0,
    detalle_json    jsonb,
    actualizado_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.vigilante_reloj (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.vigilante_reloj ENABLE ROW LEVEL SECURITY;

-- Solo lectura desde la aplicación. NO hay política de escritura, y es
-- deliberado: la escribe únicamente la Edge Function con service_role, que
-- se salta la RLS. Que no haya política *es* la política (mismo criterio
-- que `workflow_autorizaciones`, §6.7).
DROP POLICY IF EXISTS vigilante_reloj_read ON public.vigilante_reloj;
CREATE POLICY vigilante_reloj_read ON public.vigilante_reloj
    FOR SELECT TO authenticated USING (true);


-- ── 2. salud_cron() ────────────────────────────────────────────────────────
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
    -- se puede filtrar por destino: se distingue por el cuerpo, y cron-runner
    -- es el único que contesta {"checked":N,...}.
    --
    -- ⚠️ Esta tabla es UNLOGGED: un reinicio del proyecto la vacía. Por eso
    --    la ventana es corta y esto no sirve para arqueología — el 10/09 la
    --    prueba de qué pasó en la capa HTTP se perdió exactamente así.
    SELECT count(*) FILTER (WHERE r.status_code = 200 AND r.content LIKE '%checked%'),
           count(*)
      INTO v_ok_10min, v_resp_10min
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
            WHEN v_malo.status_code IS NOT NULL THEN
                format('El reloj late, pero cron-runner respondió %s: %s',
                       v_malo.status_code, v_malo.content)
            WHEN v_resp_10min = 0 THEN
                'El reloj late, pero no hay ni una respuesta HTTP en 10 minutos: '
                || 'la petición se encola y no llega a salir.'
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
'Estado real del planificador: si el job existe, si late y si la llamada HTTP llega. Nunca devuelve el command del job (contiene CRON_SECRET).';

-- REVOKE ... FROM PUBLIC no quita el EXECUTE que los ALTER DEFAULT PRIVILEGES
-- de Supabase conceden a anon POR SU NOMBRE. Hay que nombrarlo (§6.4).
REVOKE ALL ON FUNCTION public.salud_cron() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salud_cron() FROM anon;
GRANT EXECUTE ON FUNCTION public.salud_cron() TO authenticated;
GRANT EXECUTE ON FUNCTION public.salud_cron() TO service_role;


-- ── 3. Comprobación ────────────────────────────────────────────────────────
-- Una sola sentencia, porque el SQL Editor solo MUESTRA la última.
-- Debe salir veredicto "ok", y en quien_puede_ejecutar NO debe estar "anon".
SELECT jsonb_pretty(jsonb_build_object(
    'salud', public.salud_cron(),
    'quien_puede_ejecutar', (
        SELECT coalesce(jsonb_agg(DISTINCT a.grantee::regrole::text), '[]'::jsonb)
          FROM pg_proc p, aclexplode(p.proacl) a
         WHERE p.oid = 'public.salud_cron()'::regprocedure
           AND a.privilege_type = 'EXECUTE')
)) AS comprobacion;
