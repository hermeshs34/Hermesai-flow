--
-- PostgreSQL database dump
--

-- \restrict 5nmdO6bpbvo6q6YcC1MjN84s4xw75lR0ks5SjmhMvu2teaEQNf2u39kGx8kiGzf

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: delegaciones_validar(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."delegaciones_validar"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_rol_titular  text;
    v_org_titular  uuid;
    v_org_suplente uuid;
    v_act_suplente boolean;
BEGIN
    IF NEW.usuario_id = NEW.suplente_id THEN
        RAISE EXCEPTION 'No se puede delegar en uno mismo.';
    END IF;

    IF NEW.hasta <= NEW.desde THEN
        RAISE EXCEPTION 'La delegación tiene que terminar después de empezar.';
    END IF;

    SELECT p.role, p.organization_id INTO v_rol_titular, v_org_titular
      FROM profiles p WHERE p.id = NEW.usuario_id;

    SELECT p.organization_id, p.is_active INTO v_org_suplente, v_act_suplente
      FROM profiles p WHERE p.id = NEW.suplente_id;

    IF v_rol_titular IS NULL OR v_org_suplente IS NULL THEN
        RAISE EXCEPTION 'No se pudo comprobar la delegación: alguna de las dos personas no existe.';
    END IF;

    IF v_org_titular <> NEW.organization_id OR v_org_suplente <> NEW.organization_id THEN
        RAISE EXCEPTION 'Las dos personas de una delegación tienen que ser de la misma organización.';
    END IF;

    IF v_act_suplente IS NOT TRUE THEN
        RAISE EXCEPTION 'El suplente elegido está desactivado: no puede recibir una delegación.';
    END IF;

    IF v_rol_titular = 'cumplimiento' AND NEW.usuario_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Una delegación del Oficial de Cumplimiento solo puede crearla esa misma persona. Ni un administrador puede nombrarse su suplente.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM delegaciones d
         WHERE d.usuario_id = NEW.usuario_id
           AND d.id IS DISTINCT FROM NEW.id
           AND d.desde < NEW.hasta
           AND d.hasta > NEW.desde
    ) THEN
        RAISE EXCEPTION 'Ya hay otra delegación de esa persona que se solapa con estas fechas. Anula la anterior antes de crear esta.';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."delegaciones_validar"() OWNER TO "postgres";

--
-- Name: guardar_lienzo("uuid", "jsonb", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."guardar_lienzo"("p_workflow_id" "uuid", "p_nodes" "jsonb", "p_connections" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_org        uuid;
    v_ids        uuid[];
    v_ids_conn   uuid[];
    v_esperados  integer;
    v_borrados   integer;
    v_tocado     integer;
BEGIN
    IF p_nodes IS NULL OR p_connections IS NULL THEN
        RAISE EXCEPTION 'No se guardó nada: el editor no envió la lista de nodos o la de conexiones. Vuelve a abrir el flujo e inténtalo otra vez.';
    END IF;

    IF jsonb_typeof(p_nodes) <> 'array' OR jsonb_typeof(p_connections) <> 'array' THEN
        RAISE EXCEPTION 'No se guardó nada: el editor envió los nodos o las conexiones en un formato inesperado.';
    END IF;

    SELECT w.organization_id INTO v_org
      FROM workflows w
     WHERE w.id = p_workflow_id;

    IF v_org IS NULL THEN
        RAISE EXCEPTION 'No se guardó nada: el flujo no existe o no pertenece a tu organización.';
    END IF;

    v_ids      := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_nodes)       AS e);
    v_ids_conn := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_connections) AS e);

    IF EXISTS (
        SELECT 1 FROM workflow_nodes n
         WHERE n.id = ANY (v_ids) AND n.workflow_id <> p_workflow_id
    ) THEN
        RAISE EXCEPTION 'No se guardó nada: uno de los nodos que se intentaba guardar pertenece a otro flujo. Cierra el editor, vuelve a abrir el flujo y repite el cambio.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM workflow_connections c
         WHERE c.id = ANY (v_ids_conn) AND c.workflow_id <> p_workflow_id
    ) THEN
        RAISE EXCEPTION 'No se guardó nada: una de las conexiones que se intentaba guardar pertenece a otro flujo. Cierra el editor, vuelve a abrir el flujo y repite el cambio.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(p_connections) AS c(source_node_id uuid, target_node_id uuid)
         WHERE c.source_node_id IS NULL
            OR c.target_node_id IS NULL
            OR NOT (c.source_node_id = ANY (v_ids))
            OR NOT (c.target_node_id = ANY (v_ids))
    ) THEN
        RAISE EXCEPTION 'No se guardó nada: hay una conexión que apunta a un nodo que ya no está en el flujo. Borra esa conexión y vuelve a guardar.';
    END IF;

    DELETE FROM workflow_connections c
     WHERE c.workflow_id = p_workflow_id
       AND NOT (c.id = ANY (v_ids_conn));

    SELECT count(*) INTO v_esperados
      FROM workflow_nodes n
     WHERE n.workflow_id = p_workflow_id
       AND NOT (n.id = ANY (v_ids));

    DELETE FROM workflow_nodes n
     WHERE n.workflow_id = p_workflow_id
       AND NOT (n.id = ANY (v_ids));
    GET DIAGNOSTICS v_borrados = ROW_COUNT;

    IF v_borrados <> v_esperados THEN
        RAISE EXCEPTION 'No se guardó nada: tu rol no puede modificar los nodos de este flujo.'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO workflow_nodes (
        id, workflow_id, organization_id, type, category, title,
        position_x, position_y, config_json, status
    )
    SELECT x.id, p_workflow_id, v_org, x.type, x.category, x.title,
           round(COALESCE(x.position_x, 0))::integer,
           round(COALESCE(x.position_y, 0))::integer,
           COALESCE(x.config_json, '{}'::jsonb),
           COALESCE(NULLIF(x.status, ''), 'idle')
      FROM jsonb_to_recordset(p_nodes) AS x(
           id uuid, type text, category text, title text,
           position_x numeric, position_y numeric, config_json jsonb, status text)
    ON CONFLICT (id) DO UPDATE SET
           type            = EXCLUDED.type,
           category        = EXCLUDED.category,
           title           = EXCLUDED.title,
           position_x      = EXCLUDED.position_x,
           position_y      = EXCLUDED.position_y,
           config_json     = EXCLUDED.config_json,
           status          = EXCLUDED.status;

    INSERT INTO workflow_connections (id, workflow_id, source_node_id, target_node_id, branch)
    SELECT y.id, p_workflow_id, y.source_node_id, y.target_node_id, y.branch
      FROM jsonb_to_recordset(p_connections) AS y(
           id uuid, source_node_id uuid, target_node_id uuid, branch text)
    ON CONFLICT (id) DO UPDATE SET
           source_node_id = EXCLUDED.source_node_id,
           target_node_id = EXCLUDED.target_node_id,
           branch         = EXCLUDED.branch;

    UPDATE workflows w SET updated_at = now() WHERE w.id = p_workflow_id;
    GET DIAGNOSTICS v_tocado = ROW_COUNT;

    IF v_tocado <> 1 THEN
        RAISE EXCEPTION 'No se guardó nada: tu rol no puede modificar este flujo.'
            USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
        'workflow_id',        p_workflow_id,
        'nodos',              cardinality(v_ids),
        'conexiones',         cardinality(v_ids_conn),
        'nodos_eliminados',   v_borrados
    );
END;
$$;


ALTER FUNCTION "public"."guardar_lienzo"("p_workflow_id" "uuid", "p_nodes" "jsonb", "p_connections" "jsonb") OWNER TO "postgres";

--
-- Name: FUNCTION "guardar_lienzo"("p_workflow_id" "uuid", "p_nodes" "jsonb", "p_connections" "jsonb"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."guardar_lienzo"("p_workflow_id" "uuid", "p_nodes" "jsonb", "p_connections" "jsonb") IS 'Guarda nodos y conexiones de un flujo en una sola transacción, reconciliando en vez de borrar y reinsertar. SECURITY INVOKER: la RLS sigue mandando.';


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";

--
-- Name: marcar_clave_cambiada(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."marcar_clave_cambiada"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
                UPDATE public.profiles
                   SET debe_cambiar_clave = false
                 WHERE id = auth.uid();
            $$;


ALTER FUNCTION "public"."marcar_clave_cambiada"() OWNER TO "postgres";

--
-- Name: FUNCTION "marcar_clave_cambiada"(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."marcar_clave_cambiada"() IS 'Limpia debe_cambiar_clave del usuario autenticado tras cambiar su contrasena. SECURITY DEFINER porque profiles solo lo escribe un admin.';


--
-- Name: my_organization_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."my_organization_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;


ALTER FUNCTION "public"."my_organization_id"() OWNER TO "postgres";

--
-- Name: my_role(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."my_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid()
$$;


ALTER FUNCTION "public"."my_role"() OWNER TO "postgres";

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

--
-- Name: transicionar_flujo("uuid", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."transicionar_flujo"("p_workflow_id" "uuid", "p_accion" "text", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."transicionar_flujo"("p_workflow_id" "uuid", "p_accion" "text", "p_motivo" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "transicionar_flujo"("p_workflow_id" "uuid", "p_accion" "text", "p_motivo" "text"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."transicionar_flujo"("p_workflow_id" "uuid", "p_accion" "text", "p_motivo" "text") IS 'Única puerta para promover estado_definicion. Comprueba rol, organización, estado de origen, cuatro ojos y nodos a medio configurar; deja traza en workflow_autorizaciones y en audit_log.';


--
-- Name: workflow_definicion_cambiada(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."workflow_definicion_cambiada"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_wf      uuid;
    v_tocado  integer;
BEGIN
    v_wf := COALESCE(NEW.workflow_id, OLD.workflow_id);

    IF TG_OP = 'UPDATE' THEN
        -- El motor escribe `workflow_nodes.status` en cada nodo de cada corrida.
        -- Eso no es editar el flujo; sin esta salida, ejecutar un flujo
        -- publicado lo despublicaría.
        IF TG_TABLE_NAME = 'workflow_nodes' THEN
            IF  NEW.type        IS NOT DISTINCT FROM OLD.type
            AND NEW.category    IS NOT DISTINCT FROM OLD.category
            AND NEW.title       IS NOT DISTINCT FROM OLD.title
            AND NEW.config_json IS NOT DISTINCT FROM OLD.config_json
            AND NEW.workflow_id IS NOT DISTINCT FROM OLD.workflow_id THEN
                -- Solo cambió `status` y/o la posición en el lienzo. Mover una
                -- caja no cambia lo que el flujo hace (mismo criterio que la
                -- huella de §9.5, que también deja fuera la posición).
                RETURN NULL;
            END IF;

        -- La mitad que faltaba. `guardar_lienzo` reenvía todas las conexiones en
        -- cada guardado y `ON CONFLICT DO UPDATE` las reescribe aunque no hayan
        -- cambiado, así que sin esto un guardado inocuo despublica el flujo.
        ELSIF TG_TABLE_NAME = 'workflow_connections' THEN
            IF  NEW.source_node_id IS NOT DISTINCT FROM OLD.source_node_id
            AND NEW.target_node_id IS NOT DISTINCT FROM OLD.target_node_id
            AND NEW.branch         IS NOT DISTINCT FROM OLD.branch
            AND NEW.workflow_id    IS NOT DISTINCT FROM OLD.workflow_id THEN
                RETURN NULL;
            END IF;
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
$$;


ALTER FUNCTION "public"."workflow_definicion_cambiada"() OWNER TO "postgres";

--
-- Name: workflow_run_vivo_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."workflow_run_vivo_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_wf     uuid;
    v_run    record;
BEGIN
    v_wf := COALESCE(NEW.workflow_id, OLD.workflow_id);

    IF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'workflow_nodes' THEN
            IF  NEW.type        IS NOT DISTINCT FROM OLD.type
            AND NEW.category    IS NOT DISTINCT FROM OLD.category
            AND NEW.title       IS NOT DISTINCT FROM OLD.title
            AND NEW.config_json IS NOT DISTINCT FROM OLD.config_json
            AND NEW.workflow_id IS NOT DISTINCT FROM OLD.workflow_id THEN
                -- Solo `status` y/o la posición. Reventar aquí por arrastrar una
                -- caja mientras corre un flujo es ruido, no un control.
                RETURN NEW;
            END IF;

        ELSIF TG_TABLE_NAME = 'workflow_connections' THEN
            IF  NEW.source_node_id IS NOT DISTINCT FROM OLD.source_node_id
            AND NEW.target_node_id IS NOT DISTINCT FROM OLD.target_node_id
            AND NEW.branch         IS NOT DISTINCT FROM OLD.branch
            AND NEW.workflow_id    IS NOT DISTINCT FROM OLD.workflow_id THEN
                RETURN NEW;
            END IF;
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

    -- ⚠️ En un trigger BEFORE DELETE, `NEW` es NULL y **devolver NULL cancela el
    -- borrado**. Con `RETURN NEW` a secas, este guarda no dejaba borrar ni un
    -- nodo ni una conexión — en silencio, sin error y sin que nadie lo notara.
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."workflow_run_vivo_guard"() OWNER TO "postgres";

--
-- Name: workflows_estado_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."workflows_estado_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."workflows_estado_guard"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "usuario_id" "uuid",
    "usuario_email" "text",
    "accion" "text" NOT NULL,
    "entidad" "text" NOT NULL,
    "entidad_id" "uuid",
    "descripcion" "text",
    "datos_antes" "jsonb",
    "datos_despues" "jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_accion_check" CHECK (("accion" = ANY (ARRAY['crear'::"text", 'modificar'::"text", 'eliminar'::"text", 'ejecutar'::"text", 'aprobar'::"text", 'rechazar'::"text", 'login'::"text", 'cambio_rol'::"text", 'escalamiento'::"text", 'vencimiento'::"text"]))),
    CONSTRAINT "audit_log_entidad_check" CHECK (("entidad" = ANY (ARRAY['workflow'::"text", 'usuario'::"text", 'integracion'::"text", 'aprobacion'::"text", 'sesion'::"text", 'matriz_aprobacion'::"text", 'delegacion'::"text"])))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";

--
-- Name: delegaciones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."delegaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "suplente_id" "uuid" NOT NULL,
    "desde" timestamp with time zone NOT NULL,
    "hasta" timestamp with time zone NOT NULL,
    "motivo" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."delegaciones" OWNER TO "postgres";

--
-- Name: execution_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."execution_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "node_id" "uuid",
    "status" "text" NOT NULL,
    "message" "text" NOT NULL,
    "details_json" "jsonb",
    "duration_ms" integer,
    "executed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "execution_run_id" "uuid",
    CONSTRAINT "execution_logs_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text", 'warning'::"text", 'info'::"text"])))
);


ALTER TABLE "public"."execution_logs" OWNER TO "postgres";

--
-- Name: execution_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."execution_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "triggered_by" "text" DEFAULT 'manual'::"text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "duration_ms" integer,
    "error_message" "text",
    "logs_count" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "context_json" "jsonb",
    "completed_node_ids" "text"[] DEFAULT '{}'::"text"[],
    "paused_node_id" "text",
    "definicion_huella" "text"
);


ALTER TABLE "public"."execution_runs" OWNER TO "postgres";

--
-- Name: COLUMN "execution_runs"."definicion_huella"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."execution_runs"."definicion_huella" IS 'SHA-256 de la definición (nodos+conexiones, sin posiciones) en el momento de pausar por aprobación. Al reanudar se recalcula: si no coincide, el flujo cambió después de aprobarse y no se reanuda.';


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "system_name" "text" NOT NULL,
    "config_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "integrations_system_name_check" CHECK (("system_name" = ANY (ARRAY['riskguard'::"text", 'eeff'::"text", 'indicadores'::"text", 'legaltech'::"text"])))
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";

--
-- Name: matriz_aprobacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."matriz_aprobacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "categoria" "text",
    "umbral_monto" numeric DEFAULT 0,
    "moneda" "text" DEFAULT 'USD'::"text",
    "rol_aprobador" "text" NOT NULL,
    "nivel" integer DEFAULT 1 NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "operador" "text" DEFAULT '>='::"text" NOT NULL,
    "umbral_max" numeric,
    "condicion_extra" "text",
    "aprobadores_multiples" integer DEFAULT 1 NOT NULL,
    "escalamiento_horas" integer DEFAULT 48 NOT NULL,
    "aplica_automatico" boolean DEFAULT false NOT NULL,
    "descripcion_regulatoria" "text",
    "veces_activada" integer DEFAULT 0 NOT NULL,
    "aprobaciones_count" integer DEFAULT 0 NOT NULL,
    "rechazos_count" integer DEFAULT 0 NOT NULL,
    "tiempo_promedio_hs" numeric,
    CONSTRAINT "matriz_aprobacion_aprobadores_multiples_check" CHECK ((("aprobadores_multiples" >= 1) AND ("aprobadores_multiples" <= 5))),
    CONSTRAINT "matriz_aprobacion_operador_check" CHECK (("operador" = ANY (ARRAY['>='::"text", '>'::"text", '<='::"text", '<'::"text", '=='::"text", 'entre'::"text"])))
);


ALTER TABLE "public"."matriz_aprobacion" OWNER TO "postgres";

--
-- Name: COLUMN "matriz_aprobacion"."operador"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."matriz_aprobacion"."operador" IS '>= | > | <= | < | == | entre (rango umbral_monto..umbral_max)';


--
-- Name: COLUMN "matriz_aprobacion"."aprobadores_multiples"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."matriz_aprobacion"."aprobadores_multiples" IS 'Cuántos aprobadores distintos deben autorizar (doble control = 2)';


--
-- Name: COLUMN "matriz_aprobacion"."aplica_automatico"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."matriz_aprobacion"."aplica_automatico" IS 'Si true, el Agente IA puede decidir sin aprobador humano';


--
-- Name: COLUMN "matriz_aprobacion"."descripcion_regulatoria"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."matriz_aprobacion"."descripcion_regulatoria" IS 'Referencia normativa: SUDEBAN Circular 7, OFAC 50% Rule, etc.';


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notif_email" "text",
    "notif_errors" boolean DEFAULT true NOT NULL,
    "notif_success" boolean DEFAULT false NOT NULL,
    "kpi_sla_ms" integer DEFAULT 30000 NOT NULL,
    "kpi_min_por_tarea" integer DEFAULT 15 NOT NULL,
    "kpi_costo_hora_usd" integer DEFAULT 25 NOT NULL,
    CONSTRAINT "organizations_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";

--
-- Name: COLUMN "organizations"."kpi_sla_ms"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."organizations"."kpi_sla_ms" IS 'Umbral SLA en milisegundos (default 30s)';


--
-- Name: COLUMN "organizations"."kpi_min_por_tarea"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."organizations"."kpi_min_por_tarea" IS 'Minutos ahorrados por tarea exitosa (default 15)';


--
-- Name: COLUMN "organizations"."kpi_costo_hora_usd"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."organizations"."kpi_costo_hora_usd" IS 'Costo hora-hombre en USD para calcular ahorro (default 25)';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "debe_cambiar_clave" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'supervisor'::"text", 'operador'::"text", 'autorizador'::"text", 'cumplimiento'::"text", 'auditor'::"text", 'editor'::"text", 'operator'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";

--
-- Name: COLUMN "profiles"."debe_cambiar_clave"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."profiles"."debe_cambiar_clave" IS 'true cuando la clave vigente la asigno un administrador (olvido). La pantalla obliga a cambiarla antes de dejar entrar. Lo pone admin-reset-password; lo quita marcar_clave_cambiada().';


--
-- Name: tareas_aprobacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."tareas_aprobacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "execution_run_id" "uuid" NOT NULL,
    "node_id" "text" NOT NULL,
    "node_title" "text",
    "solicitante_id" "uuid",
    "rol_aprobador" "text" NOT NULL,
    "aprobador_id" "uuid",
    "monto" numeric,
    "categoria" "text",
    "descripcion" "text",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "comentario" "text",
    "vence_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "nivel_escalamiento" integer DEFAULT 0 NOT NULL,
    "escalado_at" timestamp with time zone,
    "rol_aprobador_original" "text",
    "delegacion_id" "uuid",
    CONSTRAINT "tareas_aprobacion_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'aprobado'::"text", 'rechazado'::"text", 'devuelto'::"text", 'expirado'::"text"])))
);


ALTER TABLE "public"."tareas_aprobacion" OWNER TO "postgres";

--
-- Name: COLUMN "tareas_aprobacion"."delegacion_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."tareas_aprobacion"."delegacion_id" IS 'Si la tarea se resolvió por delegación, el id de la delegación usada. Sin FK a propósito: borrar la delegación no debe borrar el hecho de que se usó.';


--
-- Name: workflow_autorizaciones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."workflow_autorizaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "accion" "text" NOT NULL,
    "actor_id" "uuid",
    "actor_email" "text",
    "motivo" "text",
    "estado_desde" "text",
    "estado_hasta" "text" NOT NULL,
    "creado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workflow_autorizaciones_accion_check" CHECK (("accion" = ANY (ARRAY['enviar'::"text", 'autorizar'::"text", 'rechazar'::"text", 'despublicar'::"text"])))
);


ALTER TABLE "public"."workflow_autorizaciones" OWNER TO "postgres";

--
-- Name: TABLE "workflow_autorizaciones"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."workflow_autorizaciones" IS 'Traza del ciclo de vida de la definición de un flujo. Hechos, no estado: el estado vive en workflows.estado_definicion.';


--
-- Name: workflow_connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."workflow_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "source_node_id" "uuid" NOT NULL,
    "target_node_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "branch" "text",
    CONSTRAINT "workflow_connections_branch_check" CHECK (("branch" = ANY (ARRAY['true'::"text", 'false'::"text"])))
);


ALTER TABLE "public"."workflow_connections" OWNER TO "postgres";

--
-- Name: workflow_nodes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."workflow_nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "position_x" integer DEFAULT 0 NOT NULL,
    "position_y" integer DEFAULT 0 NOT NULL,
    "config_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workflow_nodes_status_check" CHECK (("status" = ANY (ARRAY['idle'::"text", 'running'::"text", 'success'::"text", 'error'::"text"]))),
    CONSTRAINT "workflow_nodes_type_check" CHECK (("type" = ANY (ARRAY['trigger'::"text", 'connector'::"text", 'processor'::"text", 'output'::"text"])))
);


ALTER TABLE "public"."workflow_nodes" OWNER TO "postgres";

--
-- Name: workflows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT false NOT NULL,
    "schedule_type" "text",
    "schedule_value" "text",
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_run_at" timestamp with time zone,
    "execution_count" integer DEFAULT 0 NOT NULL,
    "estado_definicion" "text" DEFAULT 'borrador'::"text" NOT NULL,
    CONSTRAINT "workflows_estado_definicion_check" CHECK (("estado_definicion" = ANY (ARRAY['borrador'::"text", 'en_revision'::"text", 'publicado'::"text"]))),
    CONSTRAINT "workflows_schedule_type_check" CHECK (("schedule_type" = ANY (ARRAY['manual'::"text", 'cron'::"text", 'webhook'::"text", 'event'::"text"]))),
    CONSTRAINT "workflows_status_check" CHECK (("status" = ANY (ARRAY['idle'::"text", 'running'::"text", 'error'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."workflows" OWNER TO "postgres";

--
-- Name: COLUMN "workflows"."estado_definicion"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."workflows"."estado_definicion" IS 'Estado de la DEFINICIÓN (borrador|en_revision|publicado). No confundir con `status`, que es el resultado de la última ejecución. Solo lo promueve transicionar_flujo(); degradarlo lo puede hacer el sistema en cualquier momento.';


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");


--
-- Name: delegaciones delegaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."delegaciones"
    ADD CONSTRAINT "delegaciones_pkey" PRIMARY KEY ("id");


--
-- Name: execution_logs execution_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id");


--
-- Name: execution_runs execution_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_runs"
    ADD CONSTRAINT "execution_runs_pkey" PRIMARY KEY ("id");


--
-- Name: integrations integrations_organization_id_system_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_organization_id_system_name_key" UNIQUE ("organization_id", "system_name");


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");


--
-- Name: matriz_aprobacion matriz_aprobacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matriz_aprobacion"
    ADD CONSTRAINT "matriz_aprobacion_pkey" PRIMARY KEY ("id");


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


--
-- Name: tareas_aprobacion tareas_aprobacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."tareas_aprobacion"
    ADD CONSTRAINT "tareas_aprobacion_pkey" PRIMARY KEY ("id");


--
-- Name: workflow_autorizaciones workflow_autorizaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_autorizaciones"
    ADD CONSTRAINT "workflow_autorizaciones_pkey" PRIMARY KEY ("id");


--
-- Name: workflow_connections workflow_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_pkey" PRIMARY KEY ("id");


--
-- Name: workflow_connections workflow_connections_source_node_id_target_node_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_source_node_id_target_node_id_key" UNIQUE ("source_node_id", "target_node_id");


--
-- Name: workflow_nodes workflow_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_nodes"
    ADD CONSTRAINT "workflow_nodes_pkey" PRIMARY KEY ("id");


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_pkey" PRIMARY KEY ("id");


--
-- Name: delegaciones_suplente_vigencia_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "delegaciones_suplente_vigencia_idx" ON "public"."delegaciones" USING "btree" ("suplente_id", "desde", "hasta");


--
-- Name: delegaciones_usuario_vigencia_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "delegaciones_usuario_vigencia_idx" ON "public"."delegaciones" USING "btree" ("usuario_id", "desde", "hasta");


--
-- Name: idx_audit_entidad; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_entidad" ON "public"."audit_log" USING "btree" ("entidad", "entidad_id");


--
-- Name: idx_audit_org_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_org_date" ON "public"."audit_log" USING "btree" ("organization_id", "created_at" DESC);


--
-- Name: idx_execution_logs_org_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_logs_org_date" ON "public"."execution_logs" USING "btree" ("organization_id", "executed_at" DESC);


--
-- Name: idx_execution_logs_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_logs_run" ON "public"."execution_logs" USING "btree" ("execution_run_id");


--
-- Name: idx_execution_logs_workflow; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_logs_workflow" ON "public"."execution_logs" USING "btree" ("workflow_id");


--
-- Name: idx_execution_runs_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_runs_org" ON "public"."execution_runs" USING "btree" ("organization_id", "started_at" DESC);


--
-- Name: idx_execution_runs_workflow; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_runs_workflow" ON "public"."execution_runs" USING "btree" ("workflow_id");


--
-- Name: idx_matriz_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_matriz_org" ON "public"."matriz_aprobacion" USING "btree" ("organization_id", "nivel");


--
-- Name: idx_tareas_aprobacion_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_tareas_aprobacion_estado" ON "public"."tareas_aprobacion" USING "btree" ("organization_id", "estado");


--
-- Name: idx_tareas_aprobacion_rol; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_tareas_aprobacion_rol" ON "public"."tareas_aprobacion" USING "btree" ("organization_id", "rol_aprobador", "estado");


--
-- Name: idx_tareas_aprobacion_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_tareas_aprobacion_run" ON "public"."tareas_aprobacion" USING "btree" ("execution_run_id");


--
-- Name: idx_wf_autorizaciones_workflow; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_wf_autorizaciones_workflow" ON "public"."workflow_autorizaciones" USING "btree" ("workflow_id", "creado_at" DESC);


--
-- Name: idx_workflow_nodes_workflow; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_workflow_nodes_workflow" ON "public"."workflow_nodes" USING "btree" ("workflow_id");


--
-- Name: idx_workflows_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_workflows_org" ON "public"."workflows" USING "btree" ("organization_id");


--
-- Name: delegaciones delegaciones_validar_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "delegaciones_validar_trg" BEFORE INSERT OR UPDATE ON "public"."delegaciones" FOR EACH ROW EXECUTE FUNCTION "public"."delegaciones_validar"();


--
-- Name: workflow_connections trg_connections_definicion_cambiada; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_connections_definicion_cambiada" AFTER INSERT OR DELETE OR UPDATE ON "public"."workflow_connections" FOR EACH ROW EXECUTE FUNCTION "public"."workflow_definicion_cambiada"();


--
-- Name: workflow_connections trg_connections_run_vivo; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_connections_run_vivo" BEFORE INSERT OR DELETE OR UPDATE ON "public"."workflow_connections" FOR EACH ROW EXECUTE FUNCTION "public"."workflow_run_vivo_guard"();


--
-- Name: integrations trg_integrations_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_integrations_updated" BEFORE UPDATE ON "public"."integrations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: workflow_nodes trg_nodes_definicion_cambiada; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_nodes_definicion_cambiada" AFTER INSERT OR DELETE OR UPDATE ON "public"."workflow_nodes" FOR EACH ROW EXECUTE FUNCTION "public"."workflow_definicion_cambiada"();


--
-- Name: workflow_nodes trg_nodes_run_vivo; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_nodes_run_vivo" BEFORE INSERT OR DELETE OR UPDATE ON "public"."workflow_nodes" FOR EACH ROW EXECUTE FUNCTION "public"."workflow_run_vivo_guard"();


--
-- Name: workflows trg_workflows_estado_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_workflows_estado_guard" BEFORE UPDATE ON "public"."workflows" FOR EACH ROW EXECUTE FUNCTION "public"."workflows_estado_guard"();


--
-- Name: workflows trg_workflows_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_workflows_updated" BEFORE UPDATE ON "public"."workflows" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: audit_log audit_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: audit_log audit_log_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."profiles"("id");


--
-- Name: delegaciones delegaciones_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."delegaciones"
    ADD CONSTRAINT "delegaciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: delegaciones delegaciones_suplente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."delegaciones"
    ADD CONSTRAINT "delegaciones_suplente_id_fkey" FOREIGN KEY ("suplente_id") REFERENCES "public"."profiles"("id");


--
-- Name: delegaciones delegaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."delegaciones"
    ADD CONSTRAINT "delegaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."profiles"("id");


--
-- Name: execution_logs execution_logs_execution_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_execution_run_id_fkey" FOREIGN KEY ("execution_run_id") REFERENCES "public"."execution_runs"("id") ON DELETE CASCADE;


--
-- Name: execution_logs execution_logs_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE SET NULL;


--
-- Name: execution_logs execution_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: execution_logs execution_logs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: execution_runs execution_runs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_runs"
    ADD CONSTRAINT "execution_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: execution_runs execution_runs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_runs"
    ADD CONSTRAINT "execution_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: execution_runs execution_runs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_runs"
    ADD CONSTRAINT "execution_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: integrations integrations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: matriz_aprobacion matriz_aprobacion_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matriz_aprobacion"
    ADD CONSTRAINT "matriz_aprobacion_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: matriz_aprobacion matriz_aprobacion_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matriz_aprobacion"
    ADD CONSTRAINT "matriz_aprobacion_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: profiles profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: tareas_aprobacion tareas_aprobacion_execution_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."tareas_aprobacion"
    ADD CONSTRAINT "tareas_aprobacion_execution_run_id_fkey" FOREIGN KEY ("execution_run_id") REFERENCES "public"."execution_runs"("id") ON DELETE CASCADE;


--
-- Name: tareas_aprobacion tareas_aprobacion_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."tareas_aprobacion"
    ADD CONSTRAINT "tareas_aprobacion_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: workflow_autorizaciones workflow_autorizaciones_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_autorizaciones"
    ADD CONSTRAINT "workflow_autorizaciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: workflow_autorizaciones workflow_autorizaciones_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_autorizaciones"
    ADD CONSTRAINT "workflow_autorizaciones_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: workflow_connections workflow_connections_source_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE CASCADE;


--
-- Name: workflow_connections workflow_connections_target_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE CASCADE;


--
-- Name: workflow_connections workflow_connections_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: workflow_nodes workflow_nodes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_nodes"
    ADD CONSTRAINT "workflow_nodes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: workflow_nodes workflow_nodes_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_nodes"
    ADD CONSTRAINT "workflow_nodes_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: workflows workflows_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: workflows workflows_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: audit_log audit_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "audit_insert" ON "public"."audit_log" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."my_organization_id"()));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_read_org; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "audit_read_org" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'cumplimiento'::"text", 'auditor'::"text"]))));


--
-- Name: workflow_connections connections_editor_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "connections_editor_write" ON "public"."workflow_connections" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."workflows" "w"
  WHERE (("w"."id" = "workflow_connections"."workflow_id") AND ("w"."organization_id" = "public"."my_organization_id"())))) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"])))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."workflows" "w"
  WHERE (("w"."id" = "workflow_connections"."workflow_id") AND ("w"."organization_id" = "public"."my_organization_id"())))) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"]))));


--
-- Name: workflow_connections connections_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "connections_tenant_read" ON "public"."workflow_connections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workflows" "w"
  WHERE (("w"."id" = "workflow_connections"."workflow_id") AND ("w"."organization_id" = "public"."my_organization_id"())))));


--
-- Name: delegaciones deleg_read_org; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "deleg_read_org" ON "public"."delegaciones" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: delegaciones deleg_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "deleg_write" ON "public"."delegaciones" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."is_admin"() OR ("usuario_id" = "auth"."uid"())))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."is_admin"() OR ("usuario_id" = "auth"."uid"()))));


--
-- Name: delegaciones; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."delegaciones" ENABLE ROW LEVEL SECURITY;

--
-- Name: execution_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."execution_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: execution_runs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."execution_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations integrations_admin_manage; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "integrations_admin_manage" ON "public"."integrations" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text"))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text")));


--
-- Name: integrations integrations_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "integrations_tenant_read" ON "public"."integrations" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_logs logs_system_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "logs_system_insert" ON "public"."execution_logs" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_logs logs_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "logs_tenant_read" ON "public"."execution_logs" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: matriz_aprobacion matriz_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "matriz_admin_write" ON "public"."matriz_aprobacion" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND "public"."is_admin"())) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND "public"."is_admin"()));


--
-- Name: matriz_aprobacion; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."matriz_aprobacion" ENABLE ROW LEVEL SECURITY;

--
-- Name: matriz_aprobacion matriz_read_org; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "matriz_read_org" ON "public"."matriz_aprobacion" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: workflow_nodes nodes_editor_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "nodes_editor_write" ON "public"."workflow_nodes" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"])))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"]))));


--
-- Name: workflow_nodes nodes_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "nodes_tenant_read" ON "public"."workflow_nodes" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: organizations org_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "org_admin_update" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ((("id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text"))) WITH CHECK ((("id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text")));


--
-- Name: tareas_aprobacion org_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "org_isolation" ON "public"."tareas_aprobacion" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: organizations org_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "org_read_own" ON "public"."organizations" FOR SELECT TO "authenticated" USING (("id" = "public"."my_organization_id"()));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_admin_manage; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profiles_admin_manage" ON "public"."profiles" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND "public"."is_admin"())) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND "public"."is_admin"()));


--
-- Name: profiles profiles_read_own_org; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profiles_read_own_org" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_runs runs_system_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "runs_system_insert" ON "public"."execution_runs" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_runs runs_system_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "runs_system_update" ON "public"."execution_runs" FOR UPDATE TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_runs runs_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "runs_tenant_read" ON "public"."execution_runs" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: tareas_aprobacion; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."tareas_aprobacion" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_autorizaciones wf_autorizaciones_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "wf_autorizaciones_tenant_read" ON "public"."workflow_autorizaciones" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: workflow_autorizaciones; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."workflow_autorizaciones" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_connections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."workflow_connections" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_nodes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."workflow_nodes" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflows; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."workflows" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflows workflows_admin_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "workflows_admin_delete" ON "public"."workflows" FOR DELETE TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text")));


--
-- Name: workflows workflows_editor_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "workflows_editor_update" ON "public"."workflows" FOR UPDATE TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"])))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"]))));


--
-- Name: workflows workflows_editor_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "workflows_editor_write" ON "public"."workflows" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"]))));


--
-- Name: workflows workflows_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "workflows_tenant_read" ON "public"."workflows" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "delegaciones_validar"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."delegaciones_validar"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delegaciones_validar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delegaciones_validar"() TO "service_role";


--
-- Name: FUNCTION "guardar_lienzo"("p_workflow_id" "uuid", "p_nodes" "jsonb", "p_connections" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."guardar_lienzo"("p_workflow_id" "uuid", "p_nodes" "jsonb", "p_connections" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_lienzo"("p_workflow_id" "uuid", "p_nodes" "jsonb", "p_connections" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."guardar_lienzo"("p_workflow_id" "uuid", "p_nodes" "jsonb", "p_connections" "jsonb") TO "service_role";


--
-- Name: FUNCTION "is_admin"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";


--
-- Name: FUNCTION "marcar_clave_cambiada"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."marcar_clave_cambiada"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."marcar_clave_cambiada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_clave_cambiada"() TO "service_role";


--
-- Name: FUNCTION "my_organization_id"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "service_role";


--
-- Name: FUNCTION "my_role"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_role"() TO "service_role";


--
-- Name: FUNCTION "set_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


--
-- Name: FUNCTION "transicionar_flujo"("p_workflow_id" "uuid", "p_accion" "text", "p_motivo" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."transicionar_flujo"("p_workflow_id" "uuid", "p_accion" "text", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transicionar_flujo"("p_workflow_id" "uuid", "p_accion" "text", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transicionar_flujo"("p_workflow_id" "uuid", "p_accion" "text", "p_motivo" "text") TO "service_role";


--
-- Name: FUNCTION "workflow_definicion_cambiada"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."workflow_definicion_cambiada"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."workflow_definicion_cambiada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."workflow_definicion_cambiada"() TO "service_role";


--
-- Name: FUNCTION "workflow_run_vivo_guard"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."workflow_run_vivo_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."workflow_run_vivo_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."workflow_run_vivo_guard"() TO "service_role";


--
-- Name: FUNCTION "workflows_estado_guard"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."workflows_estado_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."workflows_estado_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."workflows_estado_guard"() TO "service_role";


--
-- Name: TABLE "audit_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";


--
-- Name: TABLE "delegaciones"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."delegaciones" TO "anon";
GRANT ALL ON TABLE "public"."delegaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."delegaciones" TO "service_role";


--
-- Name: TABLE "execution_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."execution_logs" TO "anon";
GRANT ALL ON TABLE "public"."execution_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."execution_logs" TO "service_role";


--
-- Name: TABLE "execution_runs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."execution_runs" TO "anon";
GRANT ALL ON TABLE "public"."execution_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."execution_runs" TO "service_role";


--
-- Name: TABLE "integrations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";


--
-- Name: TABLE "matriz_aprobacion"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."matriz_aprobacion" TO "anon";
GRANT ALL ON TABLE "public"."matriz_aprobacion" TO "authenticated";
GRANT ALL ON TABLE "public"."matriz_aprobacion" TO "service_role";


--
-- Name: TABLE "organizations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";


--
-- Name: TABLE "profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


--
-- Name: TABLE "tareas_aprobacion"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."tareas_aprobacion" TO "anon";
GRANT ALL ON TABLE "public"."tareas_aprobacion" TO "authenticated";
GRANT ALL ON TABLE "public"."tareas_aprobacion" TO "service_role";


--
-- Name: TABLE "workflow_autorizaciones"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."workflow_autorizaciones" TO "anon";
GRANT ALL ON TABLE "public"."workflow_autorizaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_autorizaciones" TO "service_role";


--
-- Name: TABLE "workflow_connections"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."workflow_connections" TO "anon";
GRANT ALL ON TABLE "public"."workflow_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_connections" TO "service_role";


--
-- Name: TABLE "workflow_nodes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."workflow_nodes" TO "anon";
GRANT ALL ON TABLE "public"."workflow_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_nodes" TO "service_role";


--
-- Name: TABLE "workflows"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."workflows" TO "anon";
GRANT ALL ON TABLE "public"."workflows" TO "authenticated";
GRANT ALL ON TABLE "public"."workflows" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- PostgreSQL database dump complete
--

-- \unrestrict 5nmdO6bpbvo6q6YcC1MjN84s4xw75lR0ks5SjmhMvu2teaEQNf2u39kGx8kiGzf

