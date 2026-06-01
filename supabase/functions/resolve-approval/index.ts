// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Resolución de Aprobaciones (F2)
// POST { tareaId, decision: 'aprobado'|'rechazado', comentario?, approverId }
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        const { tareaId, decision, comentario, approverId } = await req.json();

        if (!tareaId || !decision || !approverId) {
            return new Response(
                JSON.stringify({ error: 'tareaId, decision y approverId son requeridos' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
        if (!['aprobado', 'rechazado'].includes(decision)) {
            return new Response(
                JSON.stringify({ error: 'decision debe ser "aprobado" o "rechazado"' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // 1. Cargar la tarea
        const { data: tarea, error: tareaErr } = await supabase
            .from('tareas_aprobacion')
            .select('*')
            .eq('id', tareaId)
            .eq('estado', 'pendiente')
            .single();

        if (tareaErr || !tarea) {
            return new Response(
                JSON.stringify({ error: 'Tarea no encontrada o ya resuelta' }),
                { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 2. Verificar SoD: el aprobador no puede ser quien creó el flujo
        const { data: wf } = await supabase
            .from('workflows')
            .select('created_by')
            .eq('id', tarea.workflow_id)
            .single();

        if (wf?.created_by && wf.created_by === approverId) {
            return new Response(
                JSON.stringify({ error: 'Segregación de funciones: el creador del flujo no puede aprobarlo' }),
                { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 3. Marcar tarea resuelta
        await supabase.from('tareas_aprobacion').update({
            estado:      decision,
            aprobador_id: approverId,
            comentario:  comentario ?? null,
            resolved_at: new Date().toISOString(),
        }).eq('id', tareaId);

        // 4. Registrar en audit_log
        await supabase.from('audit_log').insert({
            organization_id: tarea.organization_id,
            actor_id:        approverId,
            accion:          decision === 'aprobado' ? 'aprobar' : 'rechazar',
            entidad:         'aprobacion',
            entidad_id:      tareaId,
            descripcion:     `${decision === 'aprobado' ? 'Aprobado' : 'Rechazado'}: ${tarea.descripcion ?? ''}${comentario ? ` — ${comentario}` : ''}`,
        });

        if (decision === 'rechazado') {
            // Marcar run como rechazado
            await supabase.from('execution_runs').update({
                status:        'rechazado',
                finished_at:   new Date().toISOString(),
                error_message: `Rechazado por aprobador. ${comentario ?? ''}`,
            }).eq('id', tarea.execution_run_id);

            return new Response(
                JSON.stringify({ success: true, decision: 'rechazado', runId: tarea.execution_run_id }),
                { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 5. Aprobado → reanudar el flujo llamando a execute-workflow con action='resume'
        const resumeRes = await fetch(`${SUPABASE_URL}/functions/v1/execute-workflow`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
                workflowId:      tarea.workflow_id,
                organizationId:  tarea.organization_id,
                triggeredBy:     'approval',
                action:          'resume',
                runId:           tarea.execution_run_id,
                approverId,
            }),
        });

        const resumeData = await resumeRes.json();

        // Si execute-workflow devolvió error, marcar el run con el error real
        if (!resumeRes.ok || resumeData?.error) {
            const errMsg = resumeData?.error ?? `HTTP ${resumeRes.status}`;
            await supabase.from('execution_runs').update({
                status:        'error',
                finished_at:   new Date().toISOString(),
                error_message: `Error al reanudar tras aprobación: ${errMsg}`,
            }).eq('id', tarea.execution_run_id).eq('status', 'esperando_aprobacion');

            return new Response(
                JSON.stringify({ success: false, error: `Error al reanudar flujo: ${errMsg}`, resume: resumeData }),
                { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ success: true, decision: 'aprobado', resume: resumeData }),
            { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );

    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    }
});
