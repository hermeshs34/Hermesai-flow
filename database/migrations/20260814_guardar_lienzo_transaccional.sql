-- ============================================================================
-- 20260814_guardar_lienzo_transaccional.sql
--
-- Guardar el lienzo en UNA transacción. Cierra la deuda que quedó anotada en
-- CLAUDE.md §12.1: «el borrado y la inserción no son atómicos: si falla el
-- insert después del delete, los nodos se pierden igual».
--
-- Qué había antes (src/services/workflow.service.ts):
--
--     saveNodes():        delete workflow_nodes  → insert nodos
--     saveConnections():  delete workflow_connections → insert conexiones
--
-- Tres agujeros, no uno:
--
--   1. Entre el delete y el insert no hay transacción. Un fallo del insert
--      —RLS, red, un CHECK— deja el flujo vacío. Es exactamente la forma en
--      que se perdieron cuatro flujos el 12/08/2026, solo que por otra causa.
--
--   2. Son DOS llamadas, y el FK de `workflow_connections` hacia
--      `workflow_nodes` es ON DELETE CASCADE. El delete de la primera se
--      lleva por delante TODAS las conexiones; si la segunda falla, el flujo
--      queda con nodos sueltos y sin una sola conexión. Un flujo sin
--      conexiones no da error: ejecuta el trigger y se para. Silencio otra vez.
--
--   3. `execution_logs.node_id` es ON DELETE SET NULL. Borrar todos los nodos
--      en cada guardado DESVINCULA el historial de ejecuciones de sus nodos,
--      aunque el nodo vuelva a insertarse con el mismo id un milisegundo
--      después. Cada autoguardado del canvas erosionaba la traza de auditoría.
--
-- Por eso esto NO es «lo mismo pero en una transacción»: reconcilia. Solo
-- borra lo que sobra y actualiza lo que sigue estando, así los ids que
-- sobreviven conservan sus `execution_logs`.
--
-- ── SECURITY INVOKER, a propósito ───────────────────────────────────────────
-- Corre con los permisos de quien llama, así que la RLS sigue mandando y la
-- lista de roles que pueden editar (`admin`, `dueno_proceso`, `editor`) NO se
-- copia aquí. Este proyecto ya arrastra bastantes listas duplicadas; la
-- autoridad sigue siendo `nodes_editor_write` / `connections_editor_write` /
-- `workflows_editor_update`, en un solo sitio.
--
-- Una función plpgsql es una transacción implícita: si la RLS rechaza el
-- INSERT, el DELETE anterior se deshace con él. Eso es todo el arreglo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guardar_lienzo(
    p_workflow_id  uuid,
    p_nodes        jsonb,
    p_connections  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
    v_org        uuid;
    v_ids        uuid[];
    v_ids_conn   uuid[];
    v_esperados  integer;
    v_borrados   integer;
    v_tocado     integer;
BEGIN
    -- ── 0. Lo que no se puede comprobar no puede acabar diciendo que sí ──────
    -- Misma familia que `token !== ''` (§6.1), `'' === ''` (§9.4) y la huella
    -- NULL (§9.5): un null aquí llegaría como «no había nada que guardar» y
    -- vaciaría el flujo.
    IF p_nodes IS NULL OR p_connections IS NULL THEN
        RAISE EXCEPTION 'No se guardó nada: el editor no envió la lista de nodos o la de conexiones. Vuelve a abrir el flujo e inténtalo otra vez.';
    END IF;

    IF jsonb_typeof(p_nodes) <> 'array' OR jsonb_typeof(p_connections) <> 'array' THEN
        RAISE EXCEPTION 'No se guardó nada: el editor envió los nodos o las conexiones en un formato inesperado.';
    END IF;

    -- ── 1. La organización sale del flujo, nunca del cliente ────────────────
    -- Este SELECT pasa por RLS: un flujo de otra organización simplemente no
    -- existe para quien llama, y v_org queda NULL. Postgres filtra filas, no
    -- da error (§6), así que el NULL hay que tratarlo a mano.
    SELECT w.organization_id INTO v_org
      FROM workflows w
     WHERE w.id = p_workflow_id;

    IF v_org IS NULL THEN
        RAISE EXCEPTION 'No se guardó nada: el flujo no existe o no pertenece a tu organización.';
    END IF;

    v_ids      := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_nodes)       AS e);
    v_ids_conn := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_connections) AS e);

    -- ── 2. Ningún nodo puede venir prestado de otro flujo ───────────────────
    -- Es la versión en base de datos de `exigirLienzoCargado`: sin esto, un
    -- UPSERT por id ARRASTRARÍA el nodo de otro flujo hasta este, borrándolo
    -- de donde estaba. El frontend ya lo impide; que dependa de una sola capa
    -- es precisamente lo que falló el 12/08.
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

    -- ── 3. Toda conexión tiene que apuntar a nodos de esta misma lista ──────
    -- Sin esta comprobación el fallo llegaría igual, pero como una violación
    -- de clave foránea: un texto que no le dice nada a quien está editando un
    -- flujo (§12.2 — lo que devuelve un 4xx acaba delante de una persona).
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

    -- ── 4. Borrar SOLO lo que sobra ─────────────────────────────────────────
    -- Las conexiones primero: borrar un nodo arrastra las suyas por CASCADE, y
    -- así el recuento de abajo mide lo que de verdad se quitó.
    DELETE FROM workflow_connections c
     WHERE c.workflow_id = p_workflow_id
       AND NOT (c.id = ANY (v_ids_conn));

    -- Cuántos nodos DEBERÍAN desaparecer. El SELECT lo ve todo el mundo de la
    -- organización (`nodes_tenant_read`); el DELETE solo los editores
    -- (`nodes_editor_write`, que no lleva cláusula FOR y por tanto gobierna
    -- también el DELETE). Si los números no cuadran, la RLS ha filtrado filas
    -- en silencio y hay que decirlo: un borrado de cero filas no da error.
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

    -- ── 5. Insertar o actualizar, en este orden ─────────────────────────────
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

    -- ── 6. Que el guardado sea comprobable, no solo silencioso ──────────────
    -- Con el lienzo vacío y un flujo ya vacío no se habría escrito NADA, y la
    -- función devolvería «guardado» a alguien que no tiene permiso: el mismo
    -- «✓ Guardado» pintado sin medir nada de §12.2. Este UPDATE lo gobierna
    -- `workflows_editor_update`, la misma política de siempre, y de paso deja
    -- `updated_at` donde debe estar: el flujo se acaba de modificar.
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
$fn$;

COMMENT ON FUNCTION public.guardar_lienzo(uuid, jsonb, jsonb) IS
    'Guarda nodos y conexiones de un flujo en una sola transacción, reconciliando '
    'en vez de borrar y reinsertar. SECURITY INVOKER: la RLS sigue mandando.';

-- ── Permisos ────────────────────────────────────────────────────────────────
-- ⚠️ REVOKE ... FROM PUBLIC NO quita lo concedido por nombre: Supabase tiene
-- ALTER DEFAULT PRIVILEGES que dan EXECUTE a anon, authenticated y service_role
-- sobre cada función nueva de public. A `anon` hay que nombrarlo (§6.4).
REVOKE ALL ON FUNCTION public.guardar_lienzo(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_lienzo(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.guardar_lienzo(uuid, jsonb, jsonb) TO authenticated;
