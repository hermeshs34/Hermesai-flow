// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Resolución de Aprobaciones (F2)
// POST { tareaId, decision: 'aprobado'|'rechazado', comentario?, approverId }
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY') ?? '';

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

        // 2. Verificar SoD: el aprobador no puede ser quien SOLICITÓ/EJECUTÓ esta tarea
        // (se compara con solicitante_id, no created_by — el diseñador puede ser el aprobador)
        if (tarea.solicitante_id && tarea.solicitante_id === approverId) {
            return new Response(
                JSON.stringify({ error: 'Segregación de funciones: quien ejecutó el flujo no puede aprobarlo' }),
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

            // Insertar evento final en el log para que Monitoreo lo muestre
            await supabase.from('execution_logs').insert({
                workflow_id:      tarea.workflow_id,
                organization_id:  tarea.organization_id,
                execution_run_id: tarea.execution_run_id,
                status:           'error',
                message:          `❌ Flujo rechazado — "${tarea.node_title ?? 'Aprobación'}"${comentario ? `: ${comentario}` : ''}`,
                details_json:     { decision: 'rechazado', aprobador_id: approverId, comentario: comentario ?? null },
            });

            // Notificar al solicitante si tiene email registrado
            if (RESEND_API_KEY && tarea.solicitante_id) {
                try {
                    const { data: solicitante } = await supabase
                        .from('profiles')
                        .select('name, email')
                        .eq('id', tarea.solicitante_id)
                        .single();

                    if (solicitante?.email) {
                        const { data: wfData } = await supabase
                            .from('workflows').select('name').eq('id', tarea.workflow_id).single();

                        await fetch('https://api.resend.com/emails', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                from:    'HermesAI Flow <onboarding@resend.dev>',
                                to:      [solicitante.email],
                                subject: `❌ Flujo rechazado — ${wfData?.name ?? 'Flujo'}`,
                                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#7f1d1d;padding:24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">❌ Solicitud Rechazada</h2>
    <p style="color:#fca5a5;margin:8px 0 0;font-size:13px">HermesAI Flow — Automatización de Procesos</p>
  </div>
  <div style="padding:24px;background:#f8fafc">
    <p style="color:#374151;font-size:14px">Hola <strong>${solicitante.name}</strong>,</p>
    <p style="color:#374151;font-size:14px">Tu solicitud del flujo <strong>"${wfData?.name ?? ''}"</strong> fue <strong style="color:#dc2626">rechazada</strong>.</p>
    ${tarea.descripcion ? `<p style="color:#374151;font-size:13px"><strong>Solicitud:</strong> ${tarea.descripcion}</p>` : ''}
    ${comentario ? `<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:4px;margin:12px 0"><p style="margin:0;color:#7f1d1d;font-size:13px"><strong>Motivo:</strong> ${comentario}</p></div>` : ''}
    <p style="color:#9ca3af;font-size:11px;margin-top:20px">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`,
                            }),
                        });
                    }
                } catch {
                    // No interrumpir si falla el email
                }
            }

            return new Response(
                JSON.stringify({ success: true, decision: 'rechazado', runId: tarea.execution_run_id }),
                { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 5. Garantizar que el run esté en esperando_aprobacion (puede estar en error por reintento previo)
        await supabase.from('execution_runs')
            .update({ status: 'esperando_aprobacion', error_message: null })
            .eq('id', tarea.execution_run_id)
            .in('status', ['esperando_aprobacion', 'error']);

        // 6. Devolver datos para que el FRONTEND llame a execute-workflow con action=resume
        // (llamadas inter-función tienen problemas de JWT; el frontend ya tiene sesión válida)
        return new Response(
            JSON.stringify({
                success:        true,
                decision:       'aprobado',
                runId:          tarea.execution_run_id,
                workflowId:     tarea.workflow_id,
                organizationId: tarea.organization_id,
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
