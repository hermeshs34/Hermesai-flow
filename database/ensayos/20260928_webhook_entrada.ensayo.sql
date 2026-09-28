-- ENSAYO de 20260928_webhook_entrada.sql — NO deja nada en la base.
--
-- Corre la migración entera dentro de una transacción, la prueba, y termina con
-- RAISE EXCEPTION: el error deshace todo, también el job de pg_cron. El
-- veredicto va en el propio mensaje de error:
--     ENSAYO: 17 de 17 OK — sin fallos
--
-- Entre las marcas CUERPO va la migración copiada LITERAL. Comprobación
-- (tiene que salir vacía):
--   diff <(sed -n '/^BEGIN;$/,/^COMMIT;$/p' database/migrations/20260928_webhook_entrada.sql | sed '1d;$d') \
--        <(sed -n '/^-- >>> CUERPO$/,/^-- <<< CUERPO$/p' database/ensayos/20260928_webhook_entrada.ensayo.sql | sed '1d;$d')

BEGIN;
-- >>> CUERPO

-- ── 1. Una fila por flujo: huella del secreto y configuración ───────────────
-- El valor del secreto NO se guarda nunca: solo su sha256 en hex.
CREATE TABLE public.workflow_webhooks (
    workflow_id           uuid PRIMARY KEY REFERENCES public.workflows(id) ON DELETE CASCADE,
    organization_id       uuid NOT NULL REFERENCES public.organizations(id),
    secreto_hash          text NOT NULL CHECK (secreto_hash ~ '^[0-9a-f]{64}$'),
    permite_secreto_url   boolean NOT NULL DEFAULT false,
    generado_por          uuid,          -- sin FK a propósito: borrar al usuario no borra el hecho (§6.6)
    generado_email        text,
    generado_at           timestamptz NOT NULL DEFAULT now(),
    ultimo_aviso_fallo_at timestamptz    -- un correo de «fallo al lanzar» por flujo y hora
);

-- ── 2. Registro de cada llamada AUTENTICADA ─────────────────────────────────
-- Los intentos con secreto erróneo no llegan aquí: si llegaran, cualquiera
-- podría llenar la base mandando basura (lección del 01/08, 743 MB).
CREATE TABLE public.webhook_recepciones (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id),
    workflow_id      uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    recibido_at      timestamptz NOT NULL DEFAULT now(),
    evento_id        text CHECK (evento_id IS NULL OR char_length(evento_id) BETWEEN 1 AND 200),
    estado           text NOT NULL CHECK (estado IN (
                         'aceptada', 'lanzada', 'fallo_al_lanzar',
                         'rechazada_inactivo', 'frenada_limite', 'duplicada')),
    motivo           text,
    payload          jsonb,
    bytes            integer,
    execution_run_id uuid                -- sin FK: el run lo borra la cascada del flujo, no esto
);

-- La base decide la carrera entre dos llamadas iguales simultáneas.
CREATE UNIQUE INDEX webhook_recepciones_evento_unico
    ON public.webhook_recepciones (workflow_id, evento_id)
    WHERE evento_id IS NOT NULL AND estado IN ('aceptada', 'lanzada', 'fallo_al_lanzar');

-- Límite por minuto y lista del panel.
CREATE INDEX webhook_recepciones_flujo_fecha
    ON public.webhook_recepciones (workflow_id, recibido_at DESC);

-- El motor recarga los datos al reanudar un run pausado.
CREATE INDEX webhook_recepciones_run
    ON public.webhook_recepciones (execution_run_id)
    WHERE execution_run_id IS NOT NULL;

-- ── 3. RLS: la organización LEE; escriben solo las RPCs y la clave de servicio
-- Sin política de escritura Y sin GRANT, como tareas_aprobacion desde el
-- 25/09: una política permisiva añadida mañana no reabre la puerta.
ALTER TABLE public.workflow_webhooks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_recepciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhooks_tenant_read ON public.workflow_webhooks
    FOR SELECT TO authenticated
    USING (organization_id = my_organization_id());

CREATE POLICY recepciones_tenant_read ON public.webhook_recepciones
    FOR SELECT TO authenticated
    USING (organization_id = my_organization_id());

-- Supabase da ALL a anon y authenticated sobre toda tabla nueva de public
-- (ALTER DEFAULT PRIVILEGES): se retira por su nombre (§6.4).
REVOKE ALL ON public.workflow_webhooks, public.webhook_recepciones FROM PUBLIC, anon, authenticated;

-- secreto_hash no se enseña: no es reversible, pero no hay motivo para verlo.
GRANT SELECT (workflow_id, organization_id, permite_secreto_url, generado_por,
              generado_email, generado_at, ultimo_aviso_fallo_at)
    ON public.workflow_webhooks TO authenticated;
GRANT SELECT ON public.webhook_recepciones TO authenticated;
GRANT ALL ON public.workflow_webhooks, public.webhook_recepciones TO service_role;

-- ── 4. Tocar el secreto es un hecho auditable ───────────────────────────────
-- Lista medida en producción el 28/09/2026 + 'webhook'.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entidad_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entidad_check
    CHECK (entidad = ANY (ARRAY['workflow', 'usuario', 'integracion', 'aprobacion',
                                'sesion', 'matriz_aprobacion', 'delegacion', 'webhook']));

-- ── 5. Generar / rotar el secreto ───────────────────────────────────────────
CREATE FUNCTION public.generar_secreto_webhook(p_workflow_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    v_rol     text;
    v_org     uuid;
    v_email   text;
    v_activo  boolean;
    v_wf_org  uuid;
    v_nombre  text;
    v_habia   boolean;
    v_secreto text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No hay sesión. Vuelve a entrar en la aplicación.';
    END IF;

    SELECT p.role, p.organization_id, p.email, p.is_active
      INTO v_rol, v_org, v_email, v_activo
      FROM profiles p WHERE p.id = v_uid;

    IF v_rol IS NULL OR v_activo IS NOT TRUE THEN
        RAISE EXCEPTION 'Tu usuario no está activo.';
    END IF;

    SELECT w.organization_id, w.name INTO v_wf_org, v_nombre
      FROM workflows w WHERE w.id = p_workflow_id;

    -- DEFINER se salta la RLS: la organización se comprueba a mano.
    IF v_wf_org IS NULL OR v_wf_org <> v_org THEN
        RAISE EXCEPTION 'Ese flujo no existe o no pertenece a tu organización.';
    END IF;

    -- ⚠️ Copia de `manage_workflows` en ROLE_PERMISSIONS (src/core/user.types.ts).
    -- Si cambia una, cambia la otra (como transicionar_flujo, CLAUDE.md §6.7).
    IF v_rol NOT IN ('admin', 'dueno_proceso', 'editor') THEN
        RAISE EXCEPTION 'Solo el Administrador o el Dueño de Proceso pueden generar el secreto del webhook de un flujo.';
    END IF;

    v_habia := EXISTS (SELECT 1 FROM workflow_webhooks WHERE workflow_id = p_workflow_id);

    -- Dos uuid v4 = 244 bits aleatorios, sin depender de pgcrypto. Una variable
    -- de plpgsql se evalúa UNA vez: cumple el papel del CTE AS MATERIALIZED de
    -- ROTAR_CRON_SECRET.sql (que la huella y el valor devuelto salgan del
    -- mismo secreto).
    v_secreto := 'hfw_' || replace(gen_random_uuid()::text, '-', '')
                        || replace(gen_random_uuid()::text, '-', '');

    -- Rotar invalida el anterior en el acto. No toca permite_secreto_url ni
    -- ultimo_aviso_fallo_at, ni la definición del flujo: no lo despublica (§6.7).
    INSERT INTO workflow_webhooks (workflow_id, organization_id, secreto_hash,
                                   generado_por, generado_email, generado_at)
    VALUES (p_workflow_id, v_org, encode(sha256(convert_to(v_secreto, 'UTF8')), 'hex'),
            v_uid, v_email, now())
    ON CONFLICT (workflow_id) DO UPDATE
       SET secreto_hash   = EXCLUDED.secreto_hash,
           generado_por   = EXCLUDED.generado_por,
           generado_email = EXCLUDED.generado_email,
           generado_at    = EXCLUDED.generado_at;

    -- Se registra el hecho, NUNCA el secreto.
    INSERT INTO audit_log (organization_id, usuario_id, usuario_email, accion,
                           entidad, entidad_id, descripcion)
    VALUES (v_org, v_uid, v_email,
            CASE WHEN v_habia THEN 'modificar' ELSE 'crear' END,
            'webhook', p_workflow_id,
            CASE WHEN v_habia
                 THEN format('Rotó el secreto del webhook del flujo «%s». El anterior deja de valer.', v_nombre)
                 ELSE format('Generó el secreto del webhook del flujo «%s».', v_nombre)
            END);

    RETURN v_secreto;
END;
$fn$;

REVOKE ALL ON FUNCTION public.generar_secreto_webhook(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generar_secreto_webhook(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.generar_secreto_webhook(uuid) TO authenticated;

-- ── 6. Permitir / retirar el secreto en la URL ──────────────────────────────
CREATE FUNCTION public.configurar_webhook_url(p_workflow_id uuid, p_permitir boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_uid    uuid := auth.uid();
    v_rol    text;
    v_org    uuid;
    v_email  text;
    v_activo boolean;
    v_wf_org uuid;
    v_nombre text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No hay sesión. Vuelve a entrar en la aplicación.';
    END IF;

    SELECT p.role, p.organization_id, p.email, p.is_active
      INTO v_rol, v_org, v_email, v_activo
      FROM profiles p WHERE p.id = v_uid;

    IF v_rol IS NULL OR v_activo IS NOT TRUE THEN
        RAISE EXCEPTION 'Tu usuario no está activo.';
    END IF;

    SELECT w.organization_id, w.name INTO v_wf_org, v_nombre
      FROM workflows w WHERE w.id = p_workflow_id;

    IF v_wf_org IS NULL OR v_wf_org <> v_org THEN
        RAISE EXCEPTION 'Ese flujo no existe o no pertenece a tu organización.';
    END IF;

    -- ⚠️ Copia de `manage_workflows` (ver generar_secreto_webhook).
    IF v_rol NOT IN ('admin', 'dueno_proceso', 'editor') THEN
        RAISE EXCEPTION 'Solo el Administrador o el Dueño de Proceso pueden cambiar cómo se autentica el webhook de un flujo.';
    END IF;

    IF p_permitir IS NULL THEN
        RAISE EXCEPTION 'Falta indicar si se permite o no el secreto en la URL.';
    END IF;

    UPDATE workflow_webhooks SET permite_secreto_url = p_permitir
     WHERE workflow_id = p_workflow_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese flujo todavía no tiene secreto. Genera uno primero.';
    END IF;

    INSERT INTO audit_log (organization_id, usuario_id, usuario_email, accion,
                           entidad, entidad_id, descripcion)
    VALUES (v_org, v_uid, v_email, 'modificar', 'webhook', p_workflow_id,
            CASE WHEN p_permitir
                 THEN format('Permitió el secreto en la URL del webhook del flujo «%s».', v_nombre)
                 ELSE format('Retiró el secreto en la URL del webhook del flujo «%s».', v_nombre)
            END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.configurar_webhook_url(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.configurar_webhook_url(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.configurar_webhook_url(uuid, boolean) TO authenticated;

-- ── 7. Retención: 90 días ───────────────────────────────────────────────────
-- Job puramente SQL, sin HTTP: no cae en net._http_response y no altera el
-- conteo de salud_cron(). El nombre y el comando NO contienen la cadena del
-- runner del reloj, o el barrido de 20260807 se lo llevaría (§6.1.1).
SELECT cron.schedule(
    'purgar-webhook-recepciones',
    '17 4 * * *',
    $cmd$DELETE FROM public.webhook_recepciones WHERE recibido_at < now() - interval '90 days'$cmd$
);

-- <<< CUERPO

DO $ensayo$
DECLARE
    v_ok     int  := 0;
    v_total  int  := 0;
    v_fallos text := '';
    v_notas  text := '';
    v_admin    uuid;
    v_operador uuid;
    v_otro     uuid;
    v_org      uuid;
    v_wf       uuid;   -- flujo publicado de la organización
    v_wf_sin   uuid;   -- otro flujo, que se queda sin secreto
    v_s1 text; v_s2 text; v_s3 text; v_h text;
    v_n0 int; v_n int; v_b boolean; v_estado text; v_sql text;
BEGIN
    SELECT id, organization_id INTO v_admin, v_org
      FROM profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1;
    SELECT id INTO v_operador
      FROM profiles WHERE role = 'operador' AND is_active AND organization_id = v_org LIMIT 1;
    SELECT id INTO v_otro
      FROM profiles WHERE role = 'admin' AND is_active AND organization_id <> v_org LIMIT 1;
    SELECT id INTO v_wf
      FROM workflows WHERE organization_id = v_org AND estado_definicion = 'publicado' LIMIT 1;
    SELECT id INTO v_wf_sin
      FROM workflows WHERE organization_id = v_org AND id <> v_wf ORDER BY created_at LIMIT 1;

    IF v_admin IS NULL OR v_wf IS NULL OR v_wf_sin IS NULL THEN
        RAISE EXCEPTION 'ENSAYO: faltan datos de partida (admin %, flujo publicado %, segundo flujo %)',
            v_admin, v_wf, v_wf_sin;
    END IF;

    -- 1. Permisos de las RPC
    v_total := v_total + 1;
    IF NOT has_function_privilege('anon', 'public.generar_secreto_webhook(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.configurar_webhook_url(uuid,boolean)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.generar_secreto_webhook(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.configurar_webhook_url(uuid,boolean)', 'EXECUTE')
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [1 permisos RPC]'; END IF;

    -- 2. Un operador no genera
    IF v_operador IS NULL THEN
        v_notas := v_notas || ' (sin operador: prueba 2 omitida)';
    ELSE
        v_total := v_total + 1;
        BEGIN
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_operador, 'role', 'authenticated')::text, true);
            SET LOCAL ROLE authenticated;
            PERFORM public.generar_secreto_webhook(v_wf);
            RESET ROLE;
            v_fallos := v_fallos || ' [2 el operador generó]';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE 'Solo el Administrador%' THEN v_ok := v_ok + 1;
            ELSE v_fallos := v_fallos || ' [2 ' || SQLERRM || ']'; END IF;
        END;
    END IF;

    -- 3. Un admin de otra organización no genera
    IF v_otro IS NULL THEN
        v_notas := v_notas || ' (sin otra organización: prueba 3 omitida)';
    ELSE
        v_total := v_total + 1;
        BEGIN
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
            SET LOCAL ROLE authenticated;
            PERFORM public.generar_secreto_webhook(v_wf);
            RESET ROLE;
            v_fallos := v_fallos || ' [3 otra organización generó]';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE 'Ese flujo no existe%' THEN v_ok := v_ok + 1;
            ELSE v_fallos := v_fallos || ' [3 ' || SQLERRM || ']'; END IF;
        END;
    END IF;

    -- 4. Generar dos veces: formato, huella nueva, dos filas de auditoría sin el secreto
    v_total := v_total + 1;
    SELECT count(*) INTO v_n0 FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_s1 := public.generar_secreto_webhook(v_wf);
    v_s2 := public.generar_secreto_webhook(v_wf);
    RESET ROLE;
    SELECT secreto_hash INTO v_h FROM workflow_webhooks WHERE workflow_id = v_wf;
    SELECT count(*) INTO v_n FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf;
    IF v_s1 ~ '^hfw_[0-9a-f]{64}$' AND v_s2 ~ '^hfw_[0-9a-f]{64}$' AND v_s1 <> v_s2
       AND v_h = encode(sha256(convert_to(v_s2, 'UTF8')), 'hex')
       AND v_n - v_n0 = 2
       AND NOT EXISTS (SELECT 1 FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf
                         AND (coalesce(descripcion, '') || coalesce(datos_antes::text, '') || coalesce(datos_despues::text, ''))
                             ~ ('(' || v_s1 || '|' || v_s2 || ')'))
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [4 generar/rotar/auditoría]'; END IF;

    -- 5-11. authenticated no escribe en las tablas ni lee secreto_hash
    FOREACH v_sql IN ARRAY ARRAY[
        format('INSERT INTO workflow_webhooks (workflow_id, organization_id, secreto_hash) VALUES (%L, %L, repeat(''a'', 64))', v_wf_sin, v_org),
        'UPDATE workflow_webhooks SET permite_secreto_url = true',
        'DELETE FROM workflow_webhooks',
        format('INSERT INTO webhook_recepciones (organization_id, workflow_id, estado) VALUES (%L, %L, ''aceptada'')', v_org, v_wf),
        'UPDATE webhook_recepciones SET motivo = ''x''',
        'DELETE FROM webhook_recepciones',
        'SELECT secreto_hash FROM workflow_webhooks'
    ] LOOP
        v_total := v_total + 1;
        BEGIN
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
            SET LOCAL ROLE authenticated;
            EXECUTE v_sql;
            RESET ROLE;
            v_fallos := v_fallos || ' [permitido: ' || left(v_sql, 45) || ']';
        EXCEPTION
            WHEN insufficient_privilege THEN v_ok := v_ok + 1;
            WHEN OTHERS THEN v_fallos := v_fallos || ' [' || left(v_sql, 45) || ': ' || SQLERRM || ']';
        END;
    END LOOP;

    -- 12. authenticated SÍ lee su fila (sin secreto_hash)
    v_total := v_total + 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM workflow_webhooks WHERE workflow_id = v_wf AND permite_secreto_url = false;
    RESET ROLE;
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [12 la organización no ve su fila]'; END IF;

    -- 13. Generar no despublica
    v_total := v_total + 1;
    SELECT estado_definicion INTO v_estado FROM workflows WHERE id = v_wf;
    IF v_estado = 'publicado' THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [13 quedó en ' || v_estado || ']'; END IF;

    -- 14. Índice único: dos aceptadas con el mismo evento chocan; una duplicada no
    v_total := v_total + 1;
    BEGIN
        INSERT INTO webhook_recepciones (organization_id, workflow_id, evento_id, estado) VALUES (v_org, v_wf, 'ensayo-1', 'aceptada');
        INSERT INTO webhook_recepciones (organization_id, workflow_id, evento_id, estado) VALUES (v_org, v_wf, 'ensayo-1', 'duplicada');
        INSERT INTO webhook_recepciones (organization_id, workflow_id, evento_id, estado) VALUES (v_org, v_wf, 'ensayo-1', 'lanzada');
        v_fallos := v_fallos || ' [14 el índice único dejó pasar el repetido]';
    EXCEPTION
        WHEN unique_violation THEN v_ok := v_ok + 1;
        WHEN OTHERS THEN v_fallos := v_fallos || ' [14 ' || SQLERRM || ']';
    END;

    -- 15. configurar_webhook_url sin secreto falla
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        PERFORM public.configurar_webhook_url(v_wf_sin, true);
        RESET ROLE;
        v_fallos := v_fallos || ' [15 configuró sin secreto]';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'Ese flujo todavía no tiene secreto%' THEN v_ok := v_ok + 1;
        ELSE v_fallos := v_fallos || ' [15 ' || SQLERRM || ']'; END IF;
    END;

    -- 16. Con secreto: enciende, audita, y rotar después no lo apaga
    v_total := v_total + 1;
    SELECT count(*) INTO v_n0 FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.configurar_webhook_url(v_wf, true);
    v_s3 := public.generar_secreto_webhook(v_wf);
    RESET ROLE;
    SELECT permite_secreto_url INTO v_b FROM workflow_webhooks WHERE workflow_id = v_wf;
    SELECT count(*) INTO v_n FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf;
    IF v_b AND v_n - v_n0 = 2 THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || format(' [16 permite=%s auditorías=%s]', v_b, v_n - v_n0); END IF;

    -- 17. El job de purga existe y no contiene la cadena del runner
    v_total := v_total + 1;
    SELECT count(*) INTO v_n FROM cron.job
     WHERE jobname = 'purgar-webhook-recepciones' AND schedule = '17 4 * * *'
       AND command NOT LIKE '%cron-runner%';
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [17 job de purga]'; END IF;

    -- Tres «%» y tres argumentos (un «%%» sería un % literal y no consumiría ninguno).
    RAISE EXCEPTION 'ENSAYO: % de % OK —%', v_ok, v_total,
        (CASE WHEN v_fallos = '' THEN ' sin fallos' ELSE v_fallos END) || v_notas;
END
$ensayo$;
