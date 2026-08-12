import { supabase } from '../core/supabase.ts';
import type { Workflow, WorkflowNodeData, WorkflowConnection } from '../types/workflow.ts';

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
    };
}

// ─── La invariante que protege los nodos ─────────────────────────────────────

/**
 * `saveNodes` y `saveConnections` BORRAN todo lo del flujo antes de insertar, así
 * que un guardado con la lista equivocada no es un guardado malo: es un borrado.
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

    static async deleteWorkflow(id: string, organizationId: string): Promise<void> {
        const { error } = await supabase
            .from('workflows')
            .delete()
            .eq('id', id)
            .eq('organization_id', organizationId);

        if (error) throw new Error(error.message);
    }

    // ── Nodos ─────────────────────────────────────────────────────────────

    static async saveNodes(
        workflowId: string,
        organizationId: string,
        nodes: WorkflowNodeData[],
        cargadoDe: string | null
    ): Promise<void> {
        exigirLienzoCargado(workflowId, cargadoDe, nodes.length);

        // Borrar nodos anteriores y reemplazar (estrategia simple para canvas)
        await supabase.from('workflow_nodes').delete().eq('workflow_id', workflowId);

        if (nodes.length === 0) return;

        const rows = nodes.map(n => ({
            id:              n.id,
            workflow_id:     workflowId,
            organization_id: organizationId,
            type:            n.type,
            category:        n.category,
            title:           n.title,
            position_x:      Math.round(n.position.x),
            position_y:      Math.round(n.position.y),
            config_json:     n.config,
            status:          n.status ?? 'idle',
        }));

        const { error } = await supabase.from('workflow_nodes').insert(rows);
        if (error) throw new Error(error.message);
    }

    static async saveConnections(
        workflowId: string,
        connections: WorkflowConnection[],
        cargadoDe: string | null
    ): Promise<void> {
        exigirLienzoCargado(workflowId, cargadoDe, connections.length);

        await supabase.from('workflow_connections').delete().eq('workflow_id', workflowId);

        if (connections.length === 0) return;

        // Deduplicar por source+target antes de enviar
        const seen  = new Set<string>();
        const rows  = connections
            .filter(c => {
                const key = `${c.sourceId}→${c.targetId}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map(c => ({
                id:             c.id,
                workflow_id:    workflowId,
                source_node_id: c.sourceId,
                target_node_id: c.targetId,
                branch:         c.branch ?? null,
            }));

        const { error } = await supabase
            .from('workflow_connections')
            .insert(rows);
        if (error) throw new Error(error.message);
    }
}
