// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Cron Runner
// Se ejecuta cada minuto vía pg_cron.
// Busca flujos con nodo trigger:cron cuya expresión coincide con la hora actual
// y los dispara llamando a execute-workflow.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Verificar si la hora actual coincide con la expresión cron ───────────────
function matchesCron(expr: string, now: Date): boolean {
    try {
        const [min, hour, dom, month, dow] = expr.trim().split(/\s+/);

        const matches = (field: string, value: number): boolean => {
            if (field === '*') return true;
            // Rangos: 1-5
            if (field.includes('-')) {
                const [a, b] = field.split('-').map(Number);
                return value >= a && value <= b;
            }
            // Intervalos: */5
            if (field.startsWith('*/')) {
                const step = Number(field.slice(2));
                return value % step === 0;
            }
            // Listas: 1,3,5
            if (field.includes(',')) {
                return field.split(',').map(Number).includes(value);
            }
            return Number(field) === value;
        };

        return (
            matches(min,   now.getUTCMinutes())     &&
            matches(hour,  now.getUTCHours())        &&
            matches(dom,   now.getUTCDate())         &&
            matches(month, now.getUTCMonth() + 1)    &&
            matches(dow,   now.getUTCDay())
        );
    } catch {
        return false;
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const now      = new Date();
    const fired: string[]  = [];
    const skipped: string[] = [];

    try {
        // 1. Buscar todos los nodos tipo trigger:cron de flujos activos
        const { data: cronNodes, error } = await supabase
            .from('workflow_nodes')
            .select('workflow_id, config_json, workflows(organization_id, name, status)')
            .eq('type', 'trigger')
            .eq('category', 'cron');

        if (error) throw new Error(`Error consultando nodos cron: ${error.message}`);

        for (const node of cronNodes ?? []) {
            const wf      = node.workflows as any;
            const expr    = node.config_json?.cron ?? '';
            const orgId   = wf?.organization_id;
            const wfName  = wf?.name ?? node.workflow_id;

            // Solo flujos activos con expresión cron configurada
            if (!expr || !orgId || wf?.status === 'paused') {
                skipped.push(`${wfName} — sin cron o pausado`);
                continue;
            }

            if (!matchesCron(expr, now)) {
                skipped.push(`${wfName} — cron "${expr}" no coincide con ${now.toISOString()}`);
                continue;
            }

            // 2. Disparar la ejecución
            const { data, error: execErr } = await supabase.functions.invoke('execute-workflow', {
                body: {
                    workflowId:     node.workflow_id,
                    organizationId: orgId,
                    triggeredBy:    'cron',
                },
            });

            if (execErr) {
                skipped.push(`${wfName} — error al ejecutar: ${execErr.message}`);
            } else {
                fired.push(`${wfName} — runId: ${data?.runId}`);
            }
        }

        return new Response(
            JSON.stringify({
                checked:  (cronNodes ?? []).length,
                fired:    fired.length,
                fired_workflows:   fired,
                skipped_workflows: skipped,
                timestamp: now.toISOString(),
            }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } }
        );

    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    }
});
