import { supabase } from '../core/supabase.ts';
import { mensajeDeRpc } from '../utils/errores.ts';
import type { Workflow, WorkflowNodeData, WorkflowConnection, EstadoDefinicion } from '../types/workflow.ts';

// ─── Helpers de mapeo ────────────────────────────────────────────────────────

function mapWorkflow(row: Record<string, unknown>): Workflow {
    return {
        id:             row.id as string,
        name:           row.name as string,
        description:    (row.description as string) ?? '',
        nodes:          [],
        connections:    [],
        isActive:       row.is_active as boolean,
        schedule:       row.schedule_type ? {
            type:  row.schedule_type as 'manual' | 'interval' | 'cron',
            value: row.schedule_value as string | undefined,
        } : undefined,
        createdAt:      row.created_at as string,
        lastRun:        row.last_run_at as string | undefined,
        executionCount: row.execution_count as number,
        status:         row.status as Workflow['status'],
        responsible:    (row.profiles as { name?: string } | null)?.name
                        ?? (row.created_by ? 'Asignado' : 'Sin responsable'),
        // Un flujo sin estado se trata como borrador: lo que no se puede
        // comprobar no puede acabar diciendo que sí. La columna es NOT NULL, así
        // que esto solo cubre una respuesta recortada, nunca amplía permisos —
        // el motor y la base vuelven a comprobarlo.
        estadoDefinicion: (row.estado_definicion as Workflow['estadoDefinicion']) ?? 'borrador',
    };
}

// ─── La invariante que protege los nodos ─────────────────────────────────────

/**
 * `saveLienzo` REEMPLAZA el contenido del flujo, así que un guardado con la
 * lista equivocada no es un guardado malo: es un borrado.
 *
 * Solo se permite escribir sobre **el flujo que el lienzo cargó de verdad**. Eso
 * cubre las dos formas de perder datos:
 *   · escribir `[]` sobre un flujo que sí tenía nodos  → lo vacía
 *   · escribir los nodos de A sobre B                  → B pasa a hacer lo de A
 *
 * El 12/08/2026 se perdieron los nodos de cuatro flujos por la primera. El
 * autoguardado del canvas se disparaba al **cambiar de flujo**, no solo al
 * editar, y saltaba 1,5 s después con el estado del flujo anterior. Si la carga
 * del nuevo tardaba más que eso, ganaba el temporizador. `Prueba Flujo 02032026`
 * ejecutó 6 nodos a las 17:29:59Z del 11/08 y estaba a cero al día siguiente,
 * sin que nadie lo editara.
 *
 * ⚠️ Esta comprobación es la SEGUNDA línea. La primera está en `WorkflowCanvas`,
 * que no debe ni armar el guardado antes de terminar la carga. Si esta salta, hay
 * un fallo en la primera: es un error, no una condición esperada.
 */
function exigirLienzoCargado(workflowId: string, cargadoDe: string | null, cuantos: number): void {
    if (cargadoDe === workflowId) return;
    throw new Error(
        `Guardado bloqueado para evitar pérdida de datos: el lienzo tiene cargado ` +
        `${cargadoDe ? `"${cargadoDe}"` : 'ningún flujo'} y se intentaba escribir ` +
        `${cuantos} elemento(s) sobre "${workflowId}".`
    );
}

// ─── WorkflowService — Supabase ──────────────────────────────────────────────

export class WorkflowService {

    static async getWorkflows(organizationId: string): Promise<Workflow[]> {
        // Join con profiles para derivar el responsable desde created_by
        const { data, error } = await supabase
            .from('workflows')
            .select('*, profiles:created_by(name)')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (error) {
            // Fallback si el join falla (FK ausente): traer sin profiles
            const { data: plain } = await supabase
                .from('workflows')
                .select('*')
                .eq('organization_id', organizationId)
                .order('created_at', { ascending: false });
            return (plain ?? []).map(mapWorkflow);
        }
        return (data ?? []).map(mapWorkflow);
    }

    static async getWorkflow(id: string, organizationId: string): Promise<Workflow | null> {
        const { data: wf, error: wfErr } = await supabase
            .from('workflows')
            .select('*')
            .eq('id', id)
            .eq('organization_id', organizationId)
            .single();

        if (wfErr || !wf) return null;

        // ⚠️ Comprobar el error, no solo el data. supabase-js NO lanza: devuelve
        // `{ data: null, error }`, y ese null acaba en `?? []` — un lienzo vacío
        // indistinguible de un flujo sin nodos. Hasta el 12/08/2026 no se miraba,
        // y el autoguardado convertía esa lectura fallida en un DELETE real.
        const { data: nodes,       error: nodesErr } = await supabase.from('workflow_nodes').select('*').eq('workflow_id', id);
        if (nodesErr) throw new Error(`No se pudieron leer los nodos del flujo: ${nodesErr.message}`);

        const { data: connections, error: connErr }  = await supabase.from('workflow_connections').select('*').eq('workflow_id', id);
        if (connErr) throw new Error(`No se pudieron leer las conexiones del flujo: ${connErr.message}`);

        const workflow = mapWorkflow(wf);
        workflow.nodes       = (nodes ?? []).map(n => ({
            id:             n.id,
            type:           n.type,
            category:       n.category,
            title:          n.title,
            position:       { x: n.position_x, y: n.position_y },
            config:         n.config_json ?? {},
            connections:    [],
            status:         n.status,
        } as WorkflowNodeData));
        workflow.connections = (connections ?? []).map(c => ({
            id:       c.id,
            sourceId: c.source_node_id,
            targetId: c.target_node_id,
            branch:   c.branch ?? undefined,
        } as WorkflowConnection));

        return workflow;
    }

    static async createWorkflow(
        organizationId: string,
        createdBy: string,
        data: Pick<Workflow, 'name' | 'description'>
    ): Promise<Workflow> {
        const { data: row, error } = await supabase
            .from('workflows')
            .insert({
                organization_id: organizationId,
                created_by:      createdBy,
                name:            data.name,
                description:     data.description,
            })
            .select()
            .single();

        if (error) throw new Error(error.message);
        return mapWorkflow(row);
    }

    static async updateWorkflow(
        id: string,
        organizationId: string,
        patch: Partial<Pick<Workflow, 'name' | 'description' | 'isActive' | 'status'>>
    ): Promise<Workflow> {
        const { data, error } = await supabase
            .from('workflows')
            .update({
                ...(patch.name        !== undefined && { name: patch.name }),
                ...(patch.description !== undefined && { description: patch.description }),
                ...(patch.isActive    !== undefined && { is_active: patch.isActive }),
                ...(patch.status      !== undefined && { status: patch.status }),
            })
            .eq('id', id)
            .eq('organization_id', organizationId)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return mapWorkflow(data);
    }

    // ── Ciclo de vida de la definición ────────────────────────────────────

    /**
     * Relee SOLO el estado de la definición.
     *
     * Hace falta porque editar el lienzo de un flujo publicado lo devuelve a
     * borrador **desde un trigger de la base**, sin que el navegador se entere.
     * Sin esta relectura la insignia seguiría diciendo «Publicado» sobre un
     * flujo que ya no lo está — un indicador que no mide, que es justo el fallo
     * del `✓ Guardado` de §12.2 y del `succeeded` de pg_cron.
     *
     * Devuelve `null` si no se pudo leer. Quien llama debe dejar la insignia
     * como estaba y no inventarse un estado: no saber no es saber que sí.
     */
    static async getEstadoDefinicion(id: string, organizationId: string): Promise<EstadoDefinicion | null> {
        const { data, error } = await supabase
            .from('workflows')
            .select('estado_definicion')
            .eq('id', id)
            .eq('organization_id', organizationId)
            .single();

        if (error || !data) return null;
        return (data.estado_definicion as EstadoDefinicion) ?? null;
    }

    /**
     * Mueve un flujo por `borrador → en_revision → publicado`.
     *
     * Todo lo que decide vive en la función `transicionar_flujo` de la base
     * (`database/migrations/20260814_ciclo_vida_flujos.sql`): quién puede hacer
     * qué, desde qué estado, los cuatro ojos —quien envió a revisión no
     * autoriza—, el motivo obligatorio al rechazar y las comprobaciones de
     * publicación (que haya nodos, que haya un disparador, que no quede un
     * `Decisión (Si/No)` sin configurar). Aquí NO se repite ninguna: este
     * método solo transporta la respuesta.
     *
     * Es a propósito. `authorize_workflows` en `ROLE_PERMISSIONS` decide qué
     * botón se pinta, nada más; si la regla viviera además aquí serían dos
     * copias que pueden discrepar, y este proyecto ya sabe cómo acaba eso
     * (CLAUDE.md §6.2). La única capa que manda es la base — un UPDATE directo
     * por API tampoco puede promover un flujo: lo impide un trigger.
     *
     * Los `RAISE EXCEPTION` de esa función están escritos para una persona, así
     * que `mensajeDeRpc` los deja pasar tal cual (§12.2).
     */
    static async transicionar(
        workflowId: string,
        accion: 'enviar' | 'autorizar' | 'rechazar' | 'despublicar',
        motivo?: string
    ): Promise<EstadoDefinicion> {
        const { data, error } = await supabase.rpc('transicionar_flujo', {
            p_workflow_id: workflowId,
            p_accion:      accion,
            p_motivo:      motivo?.trim() ? motivo.trim() : null,
        });

        if (error) throw new Error(mensajeDeRpc(error, 'el estado del flujo'));

        // ⚠️ La clave es `estado_definicion`, la misma que la columna. Esto leyó
        // `estado` hasta el 14/08/2026 y la transición SÍ ocurría —la RPC ya
        // había hecho su trabajo— pero el navegador la daba por fallida y pedía
        // recargar. Un caso más de los de §12.2: el «no» era mentira, no el «sí».
        // Que se notara enseguida es mérito del `throw` de abajo; leer un campo
        // ausente como `undefined` y pintarlo habría sido mucho peor.
        const estado = (data as { estado_definicion?: string } | null)?.estado_definicion;
        if (!estado) {
            // La RPC devuelve siempre `{ estado_definicion, ... }`. Si no viene,
            // algo cambió en la base y no vale suponer que salió bien: quien
            // llama usaría un estado inventado para pintar la pantalla.
            throw new Error('La base no devolvió el estado nuevo del flujo. Recarga la página para ver cómo quedó.');
        }
        return estado as EstadoDefinicion;
    }

    static async deleteWorkflow(id: string, organizationId: string): Promise<void> {
        const { error } = await supabase
            .from('workflows')
            .delete()
            .eq('id', id)
            .eq('organization_id', organizationId);

        if (error) throw new Error(error.message);
    }

    // ── Lienzo (nodos + conexiones, en una sola transacción) ──────────────

    /**
     * Guarda el lienzo entero llamando a la función `guardar_lienzo` de la base
     * (`database/migrations/20260814_guardar_lienzo_transaccional.sql`).
     *
     * Antes eran dos métodos —`saveNodes` y `saveConnections`— y esa separación
     * no era un detalle de estilo: era el fallo.
     *
     *   · Cada uno hacía `delete` + `insert` sin transacción, así que un insert
     *     fallido dejaba el flujo vacío. Quedó anotado como deuda abierta en
     *     CLAUDE.md §12.1 y esto es lo que la cierra.
     *   · Al ser dos llamadas, el CASCADE del FK de `workflow_connections`
     *     borraba TODAS las conexiones en la primera; si la segunda fallaba, el
     *     flujo quedaba con nodos sueltos y sin conexiones — y un flujo sin
     *     conexiones no da error: arranca el trigger y se para ahí.
     *
     * `exigirLienzoCargado` sigue siendo la segunda línea de defensa en el
     * navegador; la base repite la comprobación por su cuenta (un nodo que ya
     * pertenece a otro flujo se rechaza allí también). Dos capas, porque el
     * 12/08 se perdieron cuatro flujos teniendo solo una.
     */
    static async saveLienzo(
        workflowId: string,
        nodes: WorkflowNodeData[],
        connections: WorkflowConnection[],
        cargadoDe: string | null
    ): Promise<void> {
        exigirLienzoCargado(workflowId, cargadoDe, nodes.length + connections.length);

        const nodosPayload = nodes.map(n => ({
            id:          n.id,
            type:        n.type,
            category:    n.category,
            title:       n.title,
            position_x:  Math.round(n.position.x),
            position_y:  Math.round(n.position.y),
            config_json: n.config ?? {},
            status:      n.status ?? 'idle',
        }));

        // Deduplicar por source+target antes de enviar. Se queda aquí y no en
        // SQL porque es una peculiaridad del lienzo —arrastrar dos veces la
        // misma flecha—, no una regla del modelo de datos.
        const vistas = new Set<string>();
        const conexionesPayload = connections
            .filter(c => {
                const clave = `${c.sourceId}→${c.targetId}`;
                if (vistas.has(clave)) return false;
                vistas.add(clave);
                return true;
            })
            .map(c => ({
                id:             c.id,
                source_node_id: c.sourceId,
                target_node_id: c.targetId,
                branch:         c.branch ?? null,
            }));

        const { error } = await supabase.rpc('guardar_lienzo', {
            p_workflow_id: workflowId,
            p_nodes:       nodosPayload,
            p_connections: conexionesPayload,
        });

        if (error) throw new Error(mensajeDeRpc(error, 'el flujo'));
    }
}
