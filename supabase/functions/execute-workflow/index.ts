// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Motor de Ejecución de Flujos
// Edge Function: execute-workflow
// Recibe: { workflowId, organizationId, triggeredBy? }
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') ?? '';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Topological sort (Kahn's algorithm) ─────────────────────────────────────
function topologicalSort(nodes: any[], connections: any[]): any[] {
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]>    = {};

    for (const n of nodes) {
        inDegree[n.id] = 0;
        adj[n.id]      = [];
    }
    for (const c of connections) {
        adj[c.source_node_id]?.push(c.target_node_id);
        inDegree[c.target_node_id] = (inDegree[c.target_node_id] ?? 0) + 1;
    }

    const queue  = nodes.filter(n => (inDegree[n.id] ?? 0) === 0);
    const sorted: any[] = [];

    while (queue.length) {
        const node = queue.shift()!;
        sorted.push(node);
        for (const neighbor of (adj[node.id] ?? [])) {
            inDegree[neighbor]--;
            if (inDegree[neighbor] === 0) {
                const neighborNode = nodes.find(n => n.id === neighbor);
                if (neighborNode) queue.push(neighborNode);
            }
        }
    }
    // Nodos sin conexiones o en ciclos van al final
    const missing = nodes.filter(n => !sorted.find(s => s.id === n.id));
    return [...sorted, ...missing];
}

// ── Resolución de valores de contexto ───────────────────────────────────────
function resolveValue(expr: string, context: Record<string, any>): any {
    if (!expr || !expr.startsWith('{{')) return expr;
    const path = expr.replace('{{', '').replace('}}', '').trim();
    const parts = path.split('.');
    let val: any = context;
    for (const p of parts) {
        val = val?.[p];
    }
    return val;
}

// ── Ejecutor de nodo individual ──────────────────────────────────────────────
async function executeNode(
    node: any,
    context: Record<string, any>,
    deps: { supabase: any; resendKey: string }
): Promise<any> {
    const cfg      = node.config_json ?? {};
    const nodeKey  = `${node.type}:${node.category}`;

    switch (nodeKey) {

        // ── Triggers ─────────────────────────────────────────────────────
        case 'trigger:manual':
        case 'trigger:cron':
        case 'trigger:webhook':
            return { triggered: true, timestamp: new Date().toISOString() };

        // ── Email (Resend) ────────────────────────────────────────────────
        case 'output:email': {
            if (!deps.resendKey) throw new Error('RESEND_API_KEY no configurado en Supabase Secrets');
            const to      = resolveValue(cfg.to, context);
            const subject = resolveValue(cfg.subject, context) ?? 'Notificación HermesAI Flow';
            const body    = resolveValue(cfg.body, context)    ?? '';

            if (!to) throw new Error('Nodo Email: campo "to" requerido');

            const res = await fetch('https://api.resend.com/emails', {
                method:  'POST',
                headers: {
                    Authorization:   `Bearer ${deps.resendKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from:    cfg.from   ?? 'HermesAI Flow <noreply@hermesai.io>',
                    to:      [to],
                    subject,
                    html:    `<div style="font-family:sans-serif;max-width:600px">${body}</div>`,
                }),
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Resend API error: ${txt}`);
            }
            const data = await res.json();
            return { sent: true, email_id: data.id, to, subject };
        }

        // ── Tasa BCV ─────────────────────────────────────────────────────
        case 'processor:bcv': {
            try {
                const res  = await fetch('https://s3.amazonaws.com/dolartoday/data.json');
                const data = await res.json();
                const bcv  = data?.USD?.bcv ?? null;
                return { bcv_rate: bcv, source: 'dolartoday', timestamp: new Date().toISOString() };
            } catch {
                return { bcv_rate: null, source: 'unavailable', timestamp: new Date().toISOString() };
            }
        }

        // ── Decisión (branching) ──────────────────────────────────────────
        case 'processor:decision': {
            const left     = resolveValue(cfg.left ?? '', context);
            const right    = cfg.right ?? '';
            const operator = cfg.operator ?? '==';
            let result     = false;

            switch (operator) {
                case '>':  result = Number(left) > Number(right);  break;
                case '<':  result = Number(left) < Number(right);  break;
                case '>=': result = Number(left) >= Number(right); break;
                case '<=': result = Number(left) <= Number(right); break;
                case '==': result = String(left)  === String(right); break;
                case '!=': result = String(left)  !== String(right); break;
                case 'contains': result = String(left).includes(String(right)); break;
            }
            return { branch: result ? 'true' : 'false', evaluated: result, left, right, operator };
        }

        // ── Log de mensaje ────────────────────────────────────────────────
        case 'output:log': {
            const message = resolveValue(cfg.message ?? 'Log vacío', context);
            return { logged: message, timestamp: new Date().toISOString() };
        }

        // ── Siniestro RiskGuard ───────────────────────────────────────────
        case 'trigger:riskguard':
        case 'processor:riskguard': {
            const RG_URL = Deno.env.get('RISKGUARD_SUPABASE_URL');
            const RG_KEY = Deno.env.get('RISKGUARD_SERVICE_ROLE_KEY');
            if (!RG_URL || !RG_KEY) {
                return { skipped: true, reason: 'RISKGUARD_SUPABASE_URL o RISKGUARD_SERVICE_ROLE_KEY no configurados' };
            }
            const rg = createClient(RG_URL, RG_KEY);
            const { data: siniestros, error } = await rg
                .from('siniestros')
                .select('id,estado,monto_reclamado,ramo,fecha_ocurrencia')
                .eq('estado', cfg.estado ?? 'pendiente')
                .limit(cfg.limit ?? 10);
            if (error) throw new Error(`RiskGuard: ${error.message}`);
            return { siniestros: siniestros ?? [], count: siniestros?.length ?? 0 };
        }

        // ── Score AML ─────────────────────────────────────────────────────
        case 'processor:aml': {
            const score = Math.floor(Math.random() * 100);
            return {
                aml_score:  score,
                nivel:      score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo',
                timestamp:  new Date().toISOString(),
            };
        }

        // ── Nodo no implementado ──────────────────────────────────────────
        default:
            return { skipped: true, reason: `Tipo "${nodeKey}" — implementación pendiente en F2` };
    }
}

// ── Handler principal ────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        const { workflowId, organizationId, triggeredBy = 'manual' } = await req.json();

        if (!workflowId || !organizationId) {
            return new Response(
                JSON.stringify({ error: 'workflowId y organizationId son requeridos' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // 1. Cargar flujo
        const { data: workflow, error: wfErr } = await supabase
            .from('workflows')
            .select('*')
            .eq('id', workflowId)
            .eq('organization_id', organizationId)
            .single();

        if (wfErr || !workflow) {
            return new Response(
                JSON.stringify({ error: 'Flujo no encontrado' }),
                { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 2. Cargar nodos y conexiones
        const [{ data: nodes }, { data: connections }] = await Promise.all([
            supabase.from('workflow_nodes').select('*').eq('workflow_id', workflowId),
            supabase.from('workflow_connections').select('*').eq('workflow_id', workflowId),
        ]);

        if (!nodes || nodes.length === 0) {
            return new Response(
                JSON.stringify({ error: 'El flujo no tiene nodos. Agrega nodos en el constructor.' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 3. Crear registro de ejecución
        const { data: run, error: runErr } = await supabase
            .from('execution_runs')
            .insert({
                organization_id: organizationId,
                workflow_id:     workflowId,
                triggered_by:    triggeredBy,
                status:          'running',
            })
            .select()
            .single();

        if (runErr || !run) throw new Error(`No se pudo crear execution_run: ${runErr?.message}`);

        const runId     = run.id;
        const startedAt = Date.now();
        const logBuffer: any[] = [];

        const addLog = async (
            nodeId: string | null,
            status: 'info' | 'success' | 'error' | 'warning',
            message: string,
            details?: any
        ) => {
            const entry = {
                organization_id:  organizationId,
                workflow_id:      workflowId,
                execution_run_id: runId,
                node_id:          nodeId,
                status,
                message,
                details:          details ? JSON.stringify(details) : null,
                timestamp:        new Date().toISOString(),
            };
            logBuffer.push(entry);
            await supabase.from('execution_logs').insert(entry);
        };

        // 4. Ordenar nodos topológicamente
        const sorted = topologicalSort(nodes, connections ?? []);

        // 5. Ejecutar nodos en secuencia
        const context: Record<string, any> = {};
        let hasError = false;
        let errorMessage = '';

        await addLog(null, 'info', `▶ Flujo "${workflow.name}" iniciado (${sorted.length} nodos)`);

        for (const node of sorted) {
            const nodeStart = Date.now();
            try {
                await supabase
                    .from('workflow_nodes')
                    .update({ status: 'running' })
                    .eq('id', node.id);

                const result = await executeNode(node, context, {
                    supabase,
                    resendKey: RESEND_API_KEY,
                });

                context[node.id]   = result;
                const elapsed      = Date.now() - nodeStart;

                await supabase
                    .from('workflow_nodes')
                    .update({ status: result.skipped ? 'idle' : 'success' })
                    .eq('id', node.id);

                await addLog(
                    node.id,
                    result.skipped ? 'warning' : 'success',
                    result.skipped
                        ? `⚠ Nodo "${node.title}" omitido: ${result.reason}`
                        : `✓ Nodo "${node.title}" completado (${elapsed}ms)`,
                    result
                );
            } catch (err: any) {
                hasError     = true;
                errorMessage = err.message;

                await supabase
                    .from('workflow_nodes')
                    .update({ status: 'error' })
                    .eq('id', node.id);

                await addLog(node.id, 'error', `✗ Nodo "${node.title}" falló: ${err.message}`);
                break;
            }
        }

        // 6. Finalizar ejecución
        const totalMs    = Date.now() - startedAt;
        const finalStatus = hasError ? 'error' : 'success';

        await Promise.all([
            supabase.from('execution_runs').update({
                status:       finalStatus,
                finished_at:  new Date().toISOString(),
                duration_ms:  totalMs,
                logs_count:   logBuffer.length,
                error_message: errorMessage || null,
            }).eq('id', runId),

            supabase.from('workflows').update({
                last_run_at:      new Date().toISOString(),
                execution_count:  (workflow.execution_count ?? 0) + 1,
                status:           hasError ? 'error' : 'active',
            }).eq('id', workflowId),
        ]);

        const finalMsg = hasError
            ? `✗ Flujo finalizado con error después de ${totalMs}ms`
            : `✓ Flujo completado exitosamente en ${totalMs}ms`;

        await addLog(null, hasError ? 'error' : 'success', finalMsg);

        return new Response(
            JSON.stringify({
                success:  !hasError,
                runId,
                duration: totalMs,
                logs:     logBuffer.length,
                error:    errorMessage || undefined,
            }),
            { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );

    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    }
});
