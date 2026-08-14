-- ============================================================================
-- 20260814_ciclo_vida_flujos.sql
--
-- Ciclo de vida de la DEFINICIÓN de un flujo: borrador → en_revision →
-- publicado. Es el §3 de CICLO_VIDA_FLUJOS.md y el hueco que dejó abierto
-- `20260812_supervisor_no_edita.sql`: al supervisor se le quitó la edición
-- «porque autoriza, no edita», y desde entonces no tenía nada que autorizar a
-- nivel de definición.
--
-- El problema que cierra, en una frase: **hoy un flujo activo corre siempre la
-- última definición guardada.** Quien edita un flujo ya revisado mete el cambio
-- en el siguiente disparo sin que nadie lo vuelva a mirar. Y editar no es un
-- acto administrativo: desde el lienzo se cambia el destinatario de un correo,
-- el `rol_aprobador` de un nodo —o sea, quién autoriza— y hacia dónde va cada
-- rama de una decisión.
--
-- ── Lo que NO se hace, y por qué ─────────────────────────────────────────────
-- No hay instantánea de la definición al publicar (versionado completo). El
-- control aquí es la regla del §3: *cualquier cambio de la definición devuelve
-- el flujo a borrador y lo desactiva*. Cuesta una columna en vez de una tabla de
-- versiones + motor + UI de comparación, y falla cerrado: ante la duda, el flujo
-- se para. Un flujo detenido se nota; uno que corre una versión que nadie
-- revisó, no.
--
-- ── Qué cuenta como «cambio de la definición» ────────────────────────────────
-- Nodos y conexiones. NO cuenta:
--   · `workflow_nodes.status`, que lo escribe el motor en cada corrida
--     (`idle`/`running`/`success`/`error`). Un flujo que se despublica solo por
--     ejecutarse sería absurdo.
--   · `workflows.name` y `.description`. Un control que salta por corregir una
--     errata es un control que la gente aprende a ignorar — el mismo criterio
--     por el que la huella de §9.5 deja fuera la posición en el lienzo.
--   · `workflows.is_active`. Pausar y reanudar no cambia lo que el flujo hace.
--   · `schedule_type` / `schedule_value`, que en este producto **no las escribe
--     nadie**: el cron vive en `workflow_nodes.config_json.cron`, o sea que ya
--     está cubierto por la regla de los nodos. Comprobado, no supuesto.
--
-- ── Dónde vive cada control ──────────────────────────────────────────────────
-- En la base, no en la pantalla. Este proyecto lleva cuatro incidentes del mismo
-- patrón (audit_log, execute-workflow, resolve-approval, matriz_aprobacion): si
-- una regla solo está en el navegador, no está. Los textos de los RAISE están
-- escritos para una persona porque acaban delante de una (CLAUDE.md §12.2).
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1. La columna de estado
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Columna NUEVA. `workflows.status` NO sirve para esto y no se toca: es el
-- estado de la ÚLTIMA EJECUCIÓN (idle|running|error|paused). Mezclar «cómo fue
-- la última corrida» con «está aprobado» es la columna sobrecargada que ya costó
-- cara aquí — el cron miraba `status='paused'`, que nunca vale eso, y pausar un
-- flujo no lo pausaba.
ALTER TABLE public.workflows
    ADD COLUMN IF NOT EXISTS estado_definicion text NOT NULL DEFAULT 'borrador';

DO $do$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.workflows'::regclass
           AND conname  = 'workflows_estado_definicion_check'
    ) THEN
        ALTER TABLE public.workflows
            ADD CONSTRAINT workflows_estado_definicion_check
            CHECK (estado_definicion IN ('borrador', 'en_revision', 'publicado'));
    END IF;
END
$do$;

COMMENT ON COLUMN public.workflows.estado_definicion IS
    'Estado de la DEFINICIÓN (borrador|en_revision|publicado). No confundir con '
    '`status`, que es el resultado de la última ejecución. Solo lo promueve '
    'transicionar_flujo(); degradarlo lo puede hacer el sistema en cualquier momento.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2. Traza de autorizaciones
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tabla de HECHOS, no de estado: el estado vive en la columna de arriba. Aquí
-- queda quién envió, quién autorizó, quién rechazó y con qué motivo.
--
-- ⚠️ El campo de actor se llama `actor_id` porque la tabla es nueva. NO
-- confundir con `audit_log`, que usa `usuario_id` — ese desfase costó dos meses
-- de auditoría de aprobaciones (CLAUDE.md §5.1).
CREATE TABLE IF NOT EXISTS public.workflow_autorizaciones (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    workflow_id     uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    accion          text NOT NULL,
    -- Sin FK y anulable a propósito: la convalidación de esta migración no la
    -- hizo ninguna persona, y el hecho tiene que sobrevivir al borrado de un
    -- perfil. Un control cuya evidencia se puede borrar no es un control — la
    -- misma razón por la que `tareas_aprobacion.delegacion_id` no lleva FK (§6.6).
    actor_id        uuid,
    actor_email     text,
    motivo          text,
    estado_desde    text,
    estado_hasta    text NOT NULL,
    creado_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workflow_autorizaciones_accion_check
        CHECK (accion IN ('enviar', 'autorizar', 'rechazar', 'despublicar'))
);

COMMENT ON TABLE public.workflow_autorizaciones IS
    'Traza del ciclo de vida de la definición de un flujo. Hechos, no estado: el '
    'estado vive en workflows.estado_definicion.';

CREATE INDEX IF NOT EXISTS idx_wf_autorizaciones_workflow
    ON public.workflow_autorizaciones (workflow_id, creado_at DESC);

ALTER TABLE public.workflow_autorizaciones ENABLE ROW LEVEL SECURITY;

-- Lectura: toda la organización. Es traza de gobierno; esconderla no protege
-- nada y sí impide que el dueño vea por qué le rechazaron el flujo.
DROP POLICY IF EXISTS wf_autorizaciones_tenant_read ON public.workflow_autorizaciones;
CREATE POLICY wf_autorizaciones_tenant_read
    ON public.workflow_autorizaciones FOR SELECT TO authenticated
    USING (organization_id = public.my_organization_id());

-- Escritura: NADIE por API. Las filas las pone `transicionar_flujo()` y el
-- trigger de despublicación, ambos SECURITY DEFINER. Una traza que el propio
-- interesado puede escribir a mano no es una traza.
--
-- Sin política de INSERT/UPDATE/DELETE, con RLS activo, PostgREST no puede
-- escribir aquí. Es deliberado: que no haya política ES la política.


-- ════════════════════════════════════════════════════════════════════════════
-- 3. Migración de los flujos que ya existen
-- ════════════════════════════════════════════════════════════════════════════
--
-- No pueden nacer todos en `borrador`: el que está activo dejaría de correr, y
-- el daño sería por omisión —la ausencia de una ejecución no genera ningún
-- aviso, que es la familia del `succeeded` de pg_cron.
UPDATE public.workflows
   SET estado_definicion = 'publicado'
 WHERE is_active = true
   AND estado_definicion = 'borrador';

-- Y que quede escrito que esto fue una convalidación de la migración, no la
-- autorización de una persona. `actor_id` NULL dice exactamente eso.
INSERT INTO public.workflow_autorizaciones
       (organization_id, workflow_id, accion, actor_id, motivo, estado_desde, estado_hasta)
SELECT w.organization_id, w.id, 'autorizar', NULL,
       'Convalidación automática de la migración 20260814_ciclo_vida_flujos: el flujo '
       'ya estaba activo y en producción antes de que existiera el ciclo de vida. '
       'NO es la autorización de ninguna persona.',
       NULL, 'publicado'
  FROM public.workflows w
 WHERE w.estado_definicion = 'publicado'
   AND NOT EXISTS (
       SELECT 1 FROM public.workflow_autorizaciones a WHERE a.workflow_id = w.id
   );


-- ════════════════════════════════════════════════════════════════════════════
-- 4. El estado no se promueve por la puerta de atrás
-- ════════════════════════════════════════════════════════════════════════════
--
-- `workflows_editor_update` deja a admin/dueno_proceso/editor hacer UPDATE de
-- la tabla entera. Sin esto, el dueño de un proceso se autopublica con un PATCH:
-- el ciclo de vida sería decorativo.
--
-- Asimetría deliberada: **degradar siempre se puede; promover solo por la
-- puerta.** Bajar a borrador es la dirección segura (el flujo se para y se
-- nota); subir a publicado es la que hay que custodiar.
CREATE OR REPLACE FUNCTION public.workflows_estado_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    IF NEW.estado_definicion IS DISTINCT FROM OLD.estado_definicion THEN
        -- Degradar a borrador: libre. Lo hace el trigger de despublicación en
        -- cada cambio de la definición, y es la dirección que falla cerrado.
        IF NEW.estado_definicion <> 'borrador'
           AND COALESCE(current_setting('app.transicion_flujo', true), '') <> 'on' THEN
            RAISE EXCEPTION
                'El estado de un flujo no se cambia editando el flujo. Usa Enviar a revisión / Autorizar / Rechazar.';
        END IF;
    END IF;

    -- Un flujo que no está publicado no se puede activar. Sin esto, alguien
    -- activaría un borrador, el cron no lo dispararía nunca (§5 de esta
    -- migración) y no habría ningún aviso: el silencio parece normalidad.
    IF NEW.is_active = true AND NEW.estado_definicion <> 'publicado' THEN
        RAISE EXCEPTION
            'Este flujo no se puede activar todavía porque su definición está en «%». Envíalo a revisión y espera a que lo autoricen.',
            CASE NEW.estado_definicion WHEN 'borrador' THEN 'borrador' ELSE 'revisión' END;
    END IF;

    RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.workflows_estado_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflows_estado_guard() FROM anon;

DROP TRIGGER IF EXISTS trg_workflows_estado_guard ON public.workflows;
CREATE TRIGGER trg_workflows_estado_guard
    BEFORE UPDATE ON public.workflows
    FOR EACH ROW EXECUTE FUNCTION public.workflows_estado_guard();


-- ════════════════════════════════════════════════════════════════════════════
-- 5. Cualquier cambio de la definición despublica
-- ════════════════════════════════════════════════════════════════════════════
--
-- **Ésta es la transición que hace que todo lo demás valga algo.** Sin ella no
-- hay forma de garantizar que lo que corre es lo que se autorizó.
--
-- Va en la tabla y no dentro de `guardar_lienzo()` a propósito: la RPC es la
-- puerta que usa el Constructor, pero `nodes_editor_write` permite escribir
-- `workflow_nodes` directamente por API. Una regla que solo cubre la puerta
-- principal deja la de servicio abierta.
CREATE OR REPLACE FUNCTION public.workflow_definicion_cambiada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_wf      uuid;
    v_tocado  integer;
BEGIN
    v_wf := COALESCE(NEW.workflow_id, OLD.workflow_id);

    -- El motor escribe `workflow_nodes.status` en cada nodo de cada corrida.
    -- Eso no es editar el flujo; sin esta salida, ejecutar un flujo publicado
    -- lo despublicaría.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'workflow_nodes' THEN
        IF  NEW.type        IS NOT DISTINCT FROM OLD.type
        AND NEW.category    IS NOT DISTINCT FROM OLD.category
        AND NEW.title       IS NOT DISTINCT FROM OLD.title
        AND NEW.config_json IS NOT DISTINCT FROM OLD.config_json
        AND NEW.workflow_id IS NOT DISTINCT FROM OLD.workflow_id THEN
            -- Solo cambió `status` y/o la posición en el lienzo. Mover una caja
            -- no cambia lo que el flujo hace (mismo criterio que la huella de
            -- §9.5, que también deja fuera la posición).
            RETURN NULL;
        END IF;
    END IF;

    -- La cláusula WHERE hace esto idempotente: un guardado que toca 30 nodos
    -- dispara el trigger 30 veces y solo la primera encuentra 'publicado'.
    UPDATE workflows w
       SET estado_definicion = 'borrador',
           is_active         = false
     WHERE w.id = v_wf
       AND w.estado_definicion = 'publicado';
    GET DIAGNOSTICS v_tocado = ROW_COUNT;

    IF v_tocado > 0 THEN
        INSERT INTO workflow_autorizaciones
               (organization_id, workflow_id, accion, actor_id, actor_email,
                motivo, estado_desde, estado_hasta)
        SELECT w.organization_id, w.id, 'despublicar', auth.uid(),
               (SELECT p.email FROM profiles p WHERE p.id = auth.uid()),
               'Se modificó la definición del flujo. Vuelve a borrador y queda desactivado '
               'hasta que se autorice de nuevo.',
               'publicado', 'borrador'
          FROM workflows w
         WHERE w.id = v_wf;
    END IF;

    RETURN NULL;   -- AFTER trigger: el valor de retorno se ignora.
END;
$fn$;

REVOKE ALL ON FUNCTION public.workflow_definicion_cambiada() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_definicion_cambiada() FROM anon;

DROP TRIGGER IF EXISTS trg_nodes_definicion_cambiada ON public.workflow_nodes;
CREATE TRIGGER trg_nodes_definicion_cambiada
    AFTER INSERT OR UPDATE OR DELETE ON public.workflow_nodes
    FOR EACH ROW EXECUTE FUNCTION public.workflow_definicion_cambiada();

DROP TRIGGER IF EXISTS trg_connections_definicion_cambiada ON public.workflow_connections;
CREATE TRIGGER trg_connections_definicion_cambiada
    AFTER INSERT OR UPDATE OR DELETE ON public.workflow_connections
    FOR EACH ROW EXECUTE FUNCTION public.workflow_definicion_cambiada();


-- ════════════════════════════════════════════════════════════════════════════
-- 6. Un flujo vivo no se toca
-- ════════════════════════════════════════════════════════════════════════════
--
-- §6.3 de CICLO_VIDA_FLUJOS.md, decisión de Hermes del 12/08: «este esquema debe
-- respetar si un flujo está en ejecución o programado, porque si cambia puede
-- dañar».
--
-- El caso grave es el run PAUSADO esperando aprobación: hasta 48 h de ventana en
-- la que alguien puede reescribir lo que el aprobador acaba de aprobar. La
-- huella de §9.5 ya impide que eso se ejecute, pero lo hace *al reanudar* y a
-- costa de tumbar el run. Esto lo impide antes: no se edita y no hay nada que
-- rechazar después.
CREATE OR REPLACE FUNCTION public.workflow_run_vivo_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_wf     uuid;
    v_run    record;
BEGIN
    v_wf := COALESCE(NEW.workflow_id, OLD.workflow_id);

    -- Igual que arriba, y con LA MISMA condición a propósito: los dos guardas
    -- tienen que entender lo mismo por «cambio de la definición», o uno bloquea
    -- lo que el otro deja pasar. Aquí es además crítico: es precisamente
    -- DURANTE un run cuando el motor escribe `status` en cada nodo.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'workflow_nodes' THEN
        IF  NEW.type        IS NOT DISTINCT FROM OLD.type
        AND NEW.category    IS NOT DISTINCT FROM OLD.category
        AND NEW.title       IS NOT DISTINCT FROM OLD.title
        AND NEW.config_json IS NOT DISTINCT FROM OLD.config_json
        AND NEW.workflow_id IS NOT DISTINCT FROM OLD.workflow_id THEN
            -- Solo `status` y/o la posición. Reventar aquí por arrastrar una
            -- caja mientras corre un flujo es ruido, no un control.
            RETURN NEW;
        END IF;
    END IF;

    SELECT r.status, r.started_at INTO v_run
      FROM execution_runs r
     WHERE r.workflow_id = v_wf
       AND r.status IN ('running', 'esperando_aprobacion')
     ORDER BY r.started_at DESC
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'No se puede editar este flujo ahora: tiene una ejecución % desde el %. Espera a que termine o a que se resuelva la aprobación.',
            CASE v_run.status
                WHEN 'running' THEN 'en curso'
                ELSE 'parada esperando una aprobación'
            END,
            to_char(v_run.started_at AT TIME ZONE 'America/Caracas', 'DD/MM/YYYY HH24:MI') || ' (hora de Venezuela)';
    END IF;

    RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.workflow_run_vivo_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_run_vivo_guard() FROM anon;

DROP TRIGGER IF EXISTS trg_nodes_run_vivo ON public.workflow_nodes;
CREATE TRIGGER trg_nodes_run_vivo
    BEFORE INSERT OR UPDATE OR DELETE ON public.workflow_nodes
    FOR EACH ROW EXECUTE FUNCTION public.workflow_run_vivo_guard();

DROP TRIGGER IF EXISTS trg_connections_run_vivo ON public.workflow_connections;
CREATE TRIGGER trg_connections_run_vivo
    BEFORE INSERT OR UPDATE OR DELETE ON public.workflow_connections
    FOR EACH ROW EXECUTE FUNCTION public.workflow_run_vivo_guard();


-- ════════════════════════════════════════════════════════════════════════════
-- 7. Las transiciones — la única puerta
-- ════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER porque tiene que escribir dos cosas que quien llama no puede:
-- `estado_definicion` (lo bloquea el guard del §4) y `workflow_autorizaciones`
-- (que no tiene política de INSERT). El precio de un DEFINER es que los permisos
-- se comprueban a mano aquí dentro, y por eso se comprueban primero.
CREATE OR REPLACE FUNCTION public.transicionar_flujo(
    p_workflow_id uuid,
    p_accion      text,
    p_motivo      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_uid          uuid := auth.uid();
    v_rol          text;
    v_org          uuid;
    v_email        text;
    v_activo       boolean;
    v_estado       text;
    v_wf_org       uuid;
    v_nombre       text;
    v_destino      text;
    v_ultimo_envio uuid;
    v_pendientes   text;
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

    SELECT w.estado_definicion, w.organization_id, w.name
      INTO v_estado, v_wf_org, v_nombre
      FROM workflows w WHERE w.id = p_workflow_id;

    -- El DEFINER se salta la RLS, así que la organización se comprueba a mano.
    -- Sin esto, esta función sería un agujero entre organizaciones.
    IF v_wf_org IS NULL OR v_wf_org <> v_org THEN
        RAISE EXCEPTION 'Ese flujo no existe o no pertenece a tu organización.';
    END IF;

    -- ── Permiso ─────────────────────────────────────────────────────────────
    -- ⚠️ Estas dos listas son las de `manage_workflows` y `authorize_workflows`
    -- de ROLE_PERMISSIONS (src/core/user.types.ts). Son la misma regla en dos
    -- capas y tienen que moverse juntas, como `view_audit` y `execute_workflows`
    -- (CLAUDE.md §6). Aquí no se puede importar: esto es SQL.
    IF p_accion = 'enviar' THEN
        IF v_rol NOT IN ('admin', 'dueno_proceso', 'editor') THEN
            RAISE EXCEPTION 'Solo el Administrador o el Dueño de Proceso pueden enviar un flujo a revisión.';
        END IF;
        IF v_estado <> 'borrador' THEN
            RAISE EXCEPTION 'Este flujo ya no está en borrador: está en «%».', v_estado;
        END IF;
        v_destino := 'en_revision';

    ELSIF p_accion IN ('autorizar', 'rechazar') THEN
        IF v_rol NOT IN ('admin', 'supervisor', 'autorizador') THEN
            RAISE EXCEPTION 'Tu rol no autoriza definiciones de flujo. Eso es del Supervisor, el Autorizador Máximo o el Administrador.';
        END IF;
        IF v_estado <> 'en_revision' THEN
            RAISE EXCEPTION 'Este flujo no está esperando autorización: está en «%».', v_estado;
        END IF;
        v_destino := CASE p_accion WHEN 'autorizar' THEN 'publicado' ELSE 'borrador' END;

    ELSE
        RAISE EXCEPTION 'Acción de flujo desconocida: «%».', p_accion;
    END IF;

    -- ── Cuatro ojos ─────────────────────────────────────────────────────────
    -- Quien lo mandó a revisión no lo autoriza. Es la misma segregación de
    -- funciones que ya impide aprobar la tarea de un flujo que uno mismo lanzó
    -- (`resolve-approval`), aplicada a la definición. Sin esto, un admin diseña,
    -- envía y se autoriza a sí mismo: los cuatro ojos serían dos.
    -- Rechazar SÍ puede hacerlo el que envió — devolverse algo a uno mismo no
    -- rompe ningún control.
    IF p_accion = 'autorizar' THEN
        SELECT a.actor_id INTO v_ultimo_envio
          FROM workflow_autorizaciones a
         WHERE a.workflow_id = p_workflow_id AND a.accion = 'enviar'
         ORDER BY a.creado_at DESC LIMIT 1;

        IF v_ultimo_envio IS NOT NULL AND v_ultimo_envio = v_uid THEN
            RAISE EXCEPTION 'No puedes autorizar un flujo que enviaste tú a revisión. Tiene que verlo otra persona.';
        END IF;
    END IF;

    -- ── Motivo obligatorio al rechazar ──────────────────────────────────────
    -- El rechazo es una transición del sistema con motivo escrito, no un mensaje
    -- por fuera: el dueño tiene que poder leer por qué se lo devolvieron.
    IF p_accion = 'rechazar' AND COALESCE(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Para rechazar un flujo hay que escribir el motivo: es lo que va a leer el dueño para corregirlo.';
    END IF;

    -- ── Nada a medio configurar entra en producción ─────────────────────────
    -- La autorización es el sitio natural para exigirlo (§5, decisión 4). Son
    -- tres comprobaciones que este proyecto ya se ha ganado a base de disgustos.
    IF p_accion = 'autorizar' THEN
        IF NOT EXISTS (SELECT 1 FROM workflow_nodes n WHERE n.workflow_id = p_workflow_id) THEN
            RAISE EXCEPTION 'No se puede publicar un flujo sin nodos.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM workflow_nodes n
             WHERE n.workflow_id = p_workflow_id AND n.type = 'trigger'
        ) THEN
            RAISE EXCEPTION 'No se puede publicar un flujo sin nodo de inicio: nada lo dispararía.';
        END IF;

        -- Un `Decisión (Si/No)` sin configurar evalúa '' === '' y va SIEMPRE por
        -- la rama `true`, sin dar un solo error: la rama `false` queda muerta y
        -- el flujo parece instalado (CLAUDE.md §9.4). Es un hallazgo, no un
        -- detalle pendiente, y no debe llegar a producción.
        SELECT string_agg(n.title, ', ' ORDER BY n.title) INTO v_pendientes
          FROM workflow_nodes n
         WHERE n.workflow_id = p_workflow_id
           AND n.category = 'decision'
           AND COALESCE(btrim(n.config_json->>'left'), '') = '';

        IF v_pendientes IS NOT NULL THEN
            RAISE EXCEPTION
                'Hay nodos de decisión sin condición configurada (%): irían siempre por la rama «Sí» y la rama «No» nunca se ejecutaría. Configúralos antes de publicar.',
                v_pendientes;
        END IF;
    END IF;

    -- ── Escribir ────────────────────────────────────────────────────────────
    -- La marca de sesión abre el guard del §4 SOLO para esta transacción
    -- (tercer argumento `true` = local). Fuera de aquí sigue cerrado.
    PERFORM set_config('app.transicion_flujo', 'on', true);

    UPDATE workflows w
       SET estado_definicion = v_destino,
           -- Autorizar no activa el flujo: publicar y poner en marcha son dos
           -- decisiones distintas, y la segunda es del que opera. Rechazar sí
           -- desactiva — un flujo devuelto a borrador no puede seguir corriendo.
           is_active = CASE WHEN v_destino = 'publicado' THEN w.is_active ELSE false END
     WHERE w.id = p_workflow_id;

    PERFORM set_config('app.transicion_flujo', '', true);

    INSERT INTO workflow_autorizaciones
           (organization_id, workflow_id, accion, actor_id, actor_email,
            motivo, estado_desde, estado_hasta)
    VALUES (v_org, p_workflow_id, p_accion, v_uid, v_email,
            NULLIF(btrim(COALESCE(p_motivo, '')), ''), v_estado, v_destino);

    -- Traza legible para el auditor, en el mismo sitio que todo lo demás.
    INSERT INTO audit_log (organization_id, usuario_id, usuario_email, accion,
                           entidad, entidad_id, descripcion)
    VALUES (v_org, v_uid, v_email,
            CASE p_accion WHEN 'autorizar' THEN 'aprobar'
                          WHEN 'rechazar'  THEN 'rechazar'
                          ELSE 'modificar' END,
            'workflow', p_workflow_id,
            CASE p_accion
                WHEN 'enviar'    THEN 'Flujo "' || v_nombre || '" enviado a revisión'
                WHEN 'autorizar' THEN 'Definición del flujo "' || v_nombre || '" autorizada y publicada'
                ELSE 'Definición del flujo "' || v_nombre || '" rechazada — ' || COALESCE(btrim(p_motivo), '')
            END);

    RETURN jsonb_build_object(
        'workflow_id',       p_workflow_id,
        'estado_anterior',   v_estado,
        'estado_definicion', v_destino
    );
END;
$fn$;

COMMENT ON FUNCTION public.transicionar_flujo(uuid, text, text) IS
    'Única puerta para promover estado_definicion. Comprueba rol, organización, '
    'estado de origen, cuatro ojos y nodos a medio configurar; deja traza en '
    'workflow_autorizaciones y en audit_log.';

-- ⚠️ REVOKE ... FROM PUBLIC no quita lo concedido POR NOMBRE: los
-- ALTER DEFAULT PRIVILEGES de Supabase dejan EXECUTE a anon sobre cada función
-- nueva de public. Hay que nombrarlo (CLAUDE.md §6.4).
REVOKE ALL ON FUNCTION public.transicionar_flujo(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transicionar_flujo(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transicionar_flujo(uuid, text, text) TO authenticated;
