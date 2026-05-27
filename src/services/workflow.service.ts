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
    };
}

// ─── WorkflowService — Supabase ──────────────────────────────────────────────

export class WorkflowService {

    static async getWorkflows(organizationId: string): Promise<Workflow[]> {
        const { data, error } = await supabase
            .from('workflows')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);
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

        const { data: nodes }       = await supabase.from('workflow_nodes').select('*').eq('workflow_id', id);
        const { data: connections } = await supabase.from('workflow_connections').select('*').eq('workflow_id', id);

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
        nodes: WorkflowNodeData[]
    ): Promise<void> {
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
            position_x:      n.position.x,
            position_y:      n.position.y,
            config_json:     n.config,
            status:          n.status ?? 'idle',
        }));

        const { error } = await supabase.from('workflow_nodes').insert(rows);
        if (error) throw new Error(error.message);
    }

    static async saveConnections(
        workflowId: string,
        connections: WorkflowConnection[]
    ): Promise<void> {
        await supabase.from('workflow_connections').delete().eq('workflow_id', workflowId);

        if (connections.length === 0) return;

        const rows = connections.map(c => ({
            id:             c.id,
            workflow_id:    workflowId,
            source_node_id: c.sourceId,
            target_node_id: c.targetId,
        }));

        const { error } = await supabase.from('workflow_connections').insert(rows);
        if (error) throw new Error(error.message);
    }
}
