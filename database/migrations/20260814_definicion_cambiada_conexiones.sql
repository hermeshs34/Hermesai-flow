-- ============================================================================
-- 20260814_definicion_cambiada_conexiones.sql
--
-- Los dos guardas de §6.7 exoneraban el UPDATE inocuo de un NODO y no el de una
-- CONEXIÓN. Con eso, **cualquier** guardado del lienzo —incluido uno que no
-- cambia nada— despublicaba un flujo autorizado.
--
-- ── Por qué pasaba, que no es lo que parecía ────────────────────────────────
--
-- La nota que se arrastraba decía que `guardar_lienzo` «borra e inserta», y de
-- ahí salía la explicación cómoda: el trigger ve un INSERT y degrada. **Es
-- falsa.** `guardar_lienzo` reconcilia desde el 14/08: borra solo lo que sobra
-- y escribe el resto con `ON CONFLICT (id) DO UPDATE`. Los ids de nodo y de
-- conexión los pone el navegador y son estables, así que un guardado normal no
-- inserta ni borra nada: actualiza.
--
-- El detalle que lo convierte en fallo es que `ON CONFLICT DO UPDATE` **ejecuta
-- el UPDATE aunque los valores sean idénticos**. Postgres no compara antes; el
-- trigger de fila salta igual. Y ahí:
--
--   · `workflow_nodes`       → exonerado si solo cambian `status` y/o posición.
--   · `workflow_connections` → NO exonerado. Ni siquiera un UPDATE que deja la
--                              fila exactamente como estaba.
--
-- Como el lienzo reenvía SIEMPRE las conexiones enteras, cada guardado disparaba
-- una tanda de UPDATEs inocuos sobre `workflow_connections`, y el primero
-- despublicaba el flujo. La exoneración de los nodos, cuidadosamente escrita,
-- no servía de nada: la ventana estaba abierta al lado.
--
-- Es la quinta vez que aparece la misma forma en este proyecto —la regla se
-- comprueba en un camino y hay otro que llega al mismo sitio sin comprobarla:
-- `audit_log`, `execute-workflow`, `resolve-approval`, el escalamiento que
-- rodeaba la regla del Oficial de Cumplimiento (§6.2). **Al cerrar una regla,
-- repasa TODOS los caminos que escriben el campo.**
--
-- ── Y el segundo guarda tenía el mismo agujero ──────────────────────────────
--
-- `workflow_run_vivo_guard` copia la exoneración palabra por palabra, con este
-- comentario: «los dos guardas tienen que entender lo mismo por *cambio de la
-- definición*, o uno bloquea lo que el otro deja pasar». Tenía razón y le
-- faltaba la misma mitad. Consecuencia: con un run vivo, mover una caja no
-- degradaba el flujo —eso lo impedía el otro guarda— sino que **reventaba con
-- una excepción**, porque las conexiones se reescribían igual.
--
-- Por eso esta migración toca las DOS funciones a la vez. Arreglar una sola
-- volvería a dejarlas entendiendo cosas distintas, que es de lo que se quejaba
-- ese comentario.
--
-- ── Qué cuenta como cambio en una conexión ──────────────────────────────────
--
-- Origen, destino y `branch`. Los tres cambian el comportamiento y los tres
-- están en la huella de §9.5 — mismo criterio, a propósito: mover una conexión
-- de la rama `true` a la `false` no cambia qué nodos hay, pero cambia todo lo
-- que pasa. `workflow_id` entra por lo mismo que en los nodos: una fila que se
-- muda de flujo cambia la definición de los dos.
--
-- Nada más: `workflow_connections` no tiene ninguna otra columna de conducta.
--
-- ⚠️ Esto exonera el UPDATE **inocuo**, no el UPDATE. Cambiar el destino de una
-- flecha sigue despublicando, y sigue estando prohibido con un run vivo.
--
-- ── Y un tercero, que salió al ensayar y es el más grave ────────────────────
--
-- `workflow_run_vivo_guard` es un trigger **BEFORE** y termina en `RETURN NEW`.
-- En un `BEFORE DELETE`, `NEW` es NULL, y **devolver NULL cancela la
-- operación**: el idioma correcto ahí es `RETURN OLD`. O sea que desde que se
-- aplicó §6.7 esta mañana, **borrar un nodo o una conexión no borraba nada, y
-- no daba error**. La pantalla decía que sí; la fila seguía en su sitio.
--
-- No es cosmético: el `DELETE` de reconciliación de `guardar_lienzo` —el que
-- quita lo que ya no está en el lienzo— quedaba anulado, así que una conexión
-- retirada seguía viva y **el motor seguía recorriéndola**. Lo destapó la
-- prueba 4 del ensayo, que esperaba una despublicación y encontró el flujo
-- intacto: no despublicaba porque el borrado nunca ocurrió.
--
-- Otra vez un instrumento que no mide (§12.2): la operación contestaba «hecho»
-- sin haber hecho nada.
-- ============================================================================

-- ── 1. Despublicar al cambiar la definición ─────────────────────────────────
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
$fn$;

REVOKE ALL ON FUNCTION public.workflow_definicion_cambiada() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_definicion_cambiada() FROM anon;


-- ── 2. Un flujo vivo no se toca ─────────────────────────────────────────────
-- Misma exoneración, palabra por palabra, porque los dos guardas tienen que
-- entender lo mismo por «cambio de la definición».
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
$fn$;

REVOKE ALL ON FUNCTION public.workflow_run_vivo_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_run_vivo_guard() FROM anon;

-- Los triggers no se recrean: `CREATE OR REPLACE FUNCTION` los deja apuntando a
-- la definición nueva. Recrearlos dejaría la tabla sin guarda durante el DROP,
-- que es el mismo motivo por el que las políticas del 02/08 se migraron con
-- `ALTER POLICY` en vez de `DROP` + `CREATE`.
