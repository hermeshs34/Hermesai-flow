-- 20260926 — transicionar_flujo() acepta publicar el nodo «Cola AML de RiskGuard»
-- (processor:cola_aml).
--
-- Desde el 26/09/2026 RiskGuard criba a los asegurados y guarda la decisión
-- persona por persona en su cola; Flujos solo la LEE (vista
-- v_cola_asegurados_pendientes) para avisar y escalar. El motor aprende el
-- `case 'processor:cola_aml'`, y la lista de nodos publicables es copia de los
-- `case` del switch (20260924): sin esta línea un flujo con el nodo nuevo no
-- se podría publicar.
--
-- Se parte de la definición VIVA (pg_get_functiondef leída el 26/09/2026), no
-- del fichero del 24/09, y lo único que cambia es 'processor:cola_aml' en la
-- lista. ⚠️ Aplicar ANTES de desplegar execute-workflow (§6.7).

BEGIN;

CREATE OR REPLACE FUNCTION public.transicionar_flujo(p_workflow_id uuid, p_accion text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

        -- Un nodo que el motor no sabe ejecutar lo salta execute-workflow con
        -- «implementación pendiente» y el flujo sigue como si lo hubiera hecho.
        -- Publicado, un "Congelar Operación" prometería congelar y no congelaría
        -- nada. La lista es COPIA de los `case` del switch de execute-workflow
        -- (20260924_publicar_solo_nodos_implementados.sql): si el motor aprende
        -- un tipo nuevo, se añade aquí también.
        SELECT string_agg(format('%s (%s)', n.title, n.type || ':' || n.category), ', ' ORDER BY n.title)
          INTO v_pendientes
          FROM workflow_nodes n
         WHERE n.workflow_id = p_workflow_id
           AND (n.type || ':' || n.category) <> ALL (ARRAY[
                'trigger:manual', 'trigger:cron', 'trigger:webhook',
                'trigger:riskguard', 'trigger:indicadores',
                'processor:aml', 'processor:agente', 'processor:aprobacion',
                'processor:bcv', 'processor:cola_aml', 'processor:decision', 'processor:eeff',
                'processor:indicadores', 'processor:regulatorio', 'processor:reporte',
                'processor:riskguard', 'processor:semaforo',
                'output:email', 'output:log', 'output:reporte', 'output:whatsapp'
           ]);

        IF v_pendientes IS NOT NULL THEN
            RAISE EXCEPTION
                'Este flujo tiene nodos que el motor todavía no sabe ejecutar: %. Se saltarían sin hacer nada y el flujo parecería funcionar. Quítalos o sustitúyelos antes de publicar.',
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
$function$
;

-- CREATE OR REPLACE conserva los permisos, pero se reafirman: REVOKE a anon
-- POR SU NOMBRE (FROM PUBLIC no basta, §6.4) y EXECUTE solo a authenticated.
REVOKE ALL ON FUNCTION public.transicionar_flujo(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transicionar_flujo(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transicionar_flujo(uuid, text, text) TO authenticated;

COMMIT;

-- Comprobación (sentencia propia y la ÚLTIMA: el SQL Editor solo muestra esa).
SELECT jsonb_build_object(
    'cola_aml_en_lista', pg_get_functiondef('public.transicionar_flujo(uuid,text,text)'::regprocedure) LIKE '%''processor:cola_aml''%',
    'anon_execute',      has_function_privilege('anon', 'public.transicionar_flujo(uuid,text,text)', 'EXECUTE'),
    'auth_execute',      has_function_privilege('authenticated', 'public.transicionar_flujo(uuid,text,text)', 'EXECUTE')
) AS resultado;
