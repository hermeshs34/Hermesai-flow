-- 20260928 — Webhook de entrada por flujo (entrega 1 del punto 1)
-- Diseño: docs/superpowers/specs/2026-09-28-webhook-entrada-design.md
-- Plan:   docs/superpowers/plans/2026-09-28-webhook-entrada.md
--
-- ⚠️ ENSAYAR ANTES: database/ensayos/20260928_webhook_entrada.ensayo.sql lleva
-- este mismo cuerpo, copiado LITERAL entre sus marcas, y termina en un error
-- que lo deshace todo. Si tocas el cuerpo aquí, cópialo allí; el plan trae el
-- diff que comprueba que no divergen.
--
-- Orden de despliegue: ESTA migración primero, luego execute-workflow, luego
-- webhook-in (las dos con --no-verify-jwt), luego el frontend.

BEGIN;

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

COMMIT;
