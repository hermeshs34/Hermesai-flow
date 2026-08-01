// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Cron Runner
// Se ejecuta cada minuto vía pg_cron. Dos responsabilidades:
//   1. Disparar flujos con nodo trigger:cron cuya expresión coincide con la hora
//   2. Escalar/vencer aprobaciones cuyo vence_at pasó (F4):
//        nivel 0 → escala al rol superior, nuevo plazo, email a los aprobadores
//        nivel 1 → 'expirado', run en error, email al solicitante
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enviarEmail as enviar, canalEmail } from '../_shared/email.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Jerarquía de escalamiento BPM: rol vencido → rol que recibe la tarea
const ESCALA_A: Record<string, string> = {
    operador:      'supervisor',
    supervisor:    'dueno_proceso',
    dueno_proceso: 'admin',
    autorizador:   'admin',
    cumplimiento:  'admin',
    // admin no tiene superior → al vencer se cancela directamente
};

const MAX_NIVEL_ESCALAMIENTO = 1; // 1 escalamiento; al segundo vencimiento se cancela

// Margen tras el cual un run en 'running' se da por muerto. Una Edge Function
// no puede durar tanto: el techo son minutos. Subirlo solo si algún flujo
// legítimo tarda más que esto, cosa que hoy no ocurre.
const MINUTOS_RUN_COLGADO = 15;

async function enviarEmail(to: string[], subject: string, html: string): Promise<void> {
    if (canalEmail() === 'ninguno' || to.length === 0) return;
    try {
        await enviar(to, subject, html);
    } catch {
        // No interrumpir el ciclo del cron si falla el email
    }
}

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

        // ══ 3. Escalamiento de aprobaciones vencidas (F4) ════════════════════
        const escaladas: string[] = [];
        const vencidas:  string[] = [];

        const { data: tareasVencidas } = await supabase
            .from('tareas_aprobacion')
            .select('*')
            .eq('estado', 'pendiente')
            .not('vence_at', 'is', null)
            .lt('vence_at', now.toISOString());

        for (const tarea of tareasVencidas ?? []) {
            const nivel    = tarea.nivel_escalamiento ?? 0;
            const rolSube  = ESCALA_A[tarea.rol_aprobador];
            const { data: wfData } = await supabase
                .from('workflows').select('name').eq('id', tarea.workflow_id).single();
            const wfName = wfData?.name ?? 'Flujo';

            if (nivel < MAX_NIVEL_ESCALAMIENTO && rolSube) {
                // ── Escalar al rol superior con nuevo plazo ──────────────────
                // Nuevo plazo: misma ventana que la original (mín. 1h, máx. 72h)
                const ventanaMs = Math.min(
                    Math.max(new Date(tarea.vence_at).getTime() - new Date(tarea.created_at).getTime(), 3_600_000),
                    72 * 3_600_000,
                );
                const nuevoVence = new Date(now.getTime() + ventanaMs).toISOString();

                // Igual que en la rama de expiración: si la tarea no se pudo
                // mover, no se escriben logs. Es lo único que impide que un
                // UPDATE fallido se convierta en un bucle de un log por minuto.
                const { error: errEscalar } = await supabase
                    .from('tareas_aprobacion')
                    .update({
                        rol_aprobador:          rolSube,
                        rol_aprobador_original: tarea.rol_aprobador_original ?? tarea.rol_aprobador,
                        nivel_escalamiento:     nivel + 1,
                        escalado_at:            now.toISOString(),
                        vence_at:               nuevoVence,
                    })
                    .eq('id', tarea.id);

                if (errEscalar) {
                    console.error(
                        `cron-runner: no se pudo escalar la tarea ${tarea.id} — ${errEscalar.message}. ` +
                        `Se omite sin escribir logs para no reincidir en el bucle.`
                    );
                    continue;
                }

                await supabase.from('audit_log').insert({
                    organization_id: tarea.organization_id,
                    accion:          'escalamiento',
                    entidad:         'aprobacion',
                    entidad_id:      tarea.id,
                    descripcion:     `Aprobación "${tarea.node_title ?? ''}" vencida sin respuesta de ${tarea.rol_aprobador} — escalada a ${rolSube}`,
                });

                await supabase.from('execution_logs').insert({
                    workflow_id:      tarea.workflow_id,
                    organization_id:  tarea.organization_id,
                    execution_run_id: tarea.execution_run_id,
                    status:           'info',
                    message:          `⏫ Aprobación escalada: ${tarea.rol_aprobador} no respondió a tiempo → ahora la resuelve ${rolSube}`,
                    details_json:     { escalamiento: nivel + 1, rol_anterior: tarea.rol_aprobador, rol_nuevo: rolSube },
                });

                // Notificar por email a los usuarios activos del rol que recibe
                const { data: aprobadores } = await supabase
                    .from('profiles')
                    .select('email, name')
                    .eq('organization_id', tarea.organization_id)
                    .eq('role', rolSube)
                    .eq('is_active', true);
                const emails = (aprobadores ?? []).map((p: any) => p.email).filter(Boolean);
                await enviarEmail(
                    emails,
                    `⏫ Aprobación escalada — ${wfName}`,
                    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#92400e;padding:24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">⏫ Aprobación Escalada</h2>
    <p style="color:#fcd34d;margin:8px 0 0;font-size:13px">HermesAI Flow — Automatización de Procesos</p>
  </div>
  <div style="padding:24px;background:#f8fafc">
    <p style="color:#374151;font-size:14px">El rol <strong>${tarea.rol_aprobador}</strong> no respondió a tiempo la aprobación del flujo <strong>"${wfName}"</strong>. La tarea fue escalada a tu rol (<strong>${rolSube}</strong>).</p>
    ${tarea.descripcion ? `<p style="color:#374151;font-size:13px"><strong>Solicitud:</strong> ${tarea.descripcion}</p>` : ''}
    ${tarea.monto ? `<p style="color:#374151;font-size:13px"><strong>Monto:</strong> ${tarea.monto}</p>` : ''}
    <p style="color:#374151;font-size:13px"><strong>Nuevo vencimiento:</strong> ${new Date(nuevoVence).toLocaleString('es-VE')}</p>
    <p style="color:#374151;font-size:13px">Resuélvela desde la <strong>Cola de Trabajo</strong> de HermesAI Flow.</p>
    <p style="color:#9ca3af;font-size:11px;margin-top:20px">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`,
                );

                escaladas.push(`${wfName} — ${tarea.rol_aprobador} → ${rolSube}`);
            } else {
                // ── Sin nivel superior o ya escalada: expirar y cancelar run ──
                // 'expirado' y resolved_at son los nombres REALES de la tabla, los
                // que creó 20260601_f2_aprobaciones.sql. Aquí decía 'vencido' y
                // 'resuelto_at', que no existen: el UPDATE fallaba, la tarea seguía
                // en 'pendiente', el cron la reencontraba al minuto siguiente y
                // volvía a insertar los dos logs de abajo. 1.005.828 filas y 743 MB
                // entre el 11/06 y el 01/08/2026, sobre 14 tareas.
                // Por eso ahora se comprueba el error y se sale sin escribir nada:
                // si la tarea no se pudo cerrar, repetir los logs no arregla nada.
                const { error: errExpirar } = await supabase
                    .from('tareas_aprobacion')
                    .update({ estado: 'expirado', resolved_at: now.toISOString() })
                    .eq('id', tarea.id);

                if (errExpirar) {
                    console.error(
                        `cron-runner: no se pudo expirar la tarea ${tarea.id} — ${errExpirar.message}. ` +
                        `Se omite sin escribir logs para no reincidir en el bucle.`
                    );
                    continue;
                }

                await supabase.from('execution_runs').update({
                    status:        'error',
                    finished_at:   now.toISOString(),
                    error_message: `Aprobación vencida sin respuesta${nivel > 0 ? ` (escalada a ${tarea.rol_aprobador} sin éxito)` : ''}`,
                }).eq('id', tarea.execution_run_id)
                  .in('status', ['esperando_aprobacion', 'error']);

                await supabase.from('audit_log').insert({
                    organization_id: tarea.organization_id,
                    accion:          'vencimiento',
                    entidad:         'aprobacion',
                    entidad_id:      tarea.id,
                    descripcion:     `Aprobación "${tarea.node_title ?? ''}" vencida definitivamente${nivel > 0 ? ' tras escalamiento' : ''} — flujo cancelado`,
                });

                await supabase.from('execution_logs').insert({
                    workflow_id:      tarea.workflow_id,
                    organization_id:  tarea.organization_id,
                    execution_run_id: tarea.execution_run_id,
                    status:           'error',
                    message:          `⛔ Flujo cancelado: aprobación vencida sin respuesta${nivel > 0 ? ` (incluso tras escalar a ${tarea.rol_aprobador})` : ''}`,
                    details_json:     { vencimiento: true, nivel_escalamiento: nivel },
                });

                // Notificar al solicitante
                if (tarea.solicitante_id) {
                    const { data: solicitante } = await supabase
                        .from('profiles').select('email, name')
                        .eq('id', tarea.solicitante_id).single();
                    if (solicitante?.email) {
                        await enviarEmail(
                            [solicitante.email],
                            `⛔ Flujo cancelado por aprobación vencida — ${wfName}`,
                            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#7f1d1d;padding:24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">⛔ Aprobación Vencida</h2>
    <p style="color:#fca5a5;margin:8px 0 0;font-size:13px">HermesAI Flow — Automatización de Procesos</p>
  </div>
  <div style="padding:24px;background:#f8fafc">
    <p style="color:#374151;font-size:14px">Hola <strong>${solicitante.name ?? ''}</strong>,</p>
    <p style="color:#374151;font-size:14px">Tu solicitud del flujo <strong>"${wfName}"</strong> fue <strong style="color:#dc2626">cancelada</strong>: la aprobación venció sin respuesta${nivel > 0 ? ' incluso después de escalarla al nivel superior' : ''}.</p>
    ${tarea.descripcion ? `<p style="color:#374151;font-size:13px"><strong>Solicitud:</strong> ${tarea.descripcion}</p>` : ''}
    <p style="color:#374151;font-size:13px">Puedes volver a ejecutar el flujo si la solicitud sigue vigente.</p>
    <p style="color:#9ca3af;font-size:11px;margin-top:20px">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`,
                        );
                    }
                }

                vencidas.push(`${wfName} — nivel ${nivel}`);
            }
        }

        // ══ 4. Vigilante de ejecuciones colgadas ═════════════════════════════
        // Una Edge Function que muere del todo —límite de tiempo, memoria— no
        // ejecuta ningún catch, así que su run se queda en 'running' y nadie lo
        // reclama: el escalamiento de arriba solo mira 'esperando_aprobacion'.
        // Así aparecieron dos runs del 29/07/2026 que seguían "ejecutándose"
        // tres días después. El límite de una Edge Function son minutos, no
        // horas: pasado el margen, el run está muerto con certeza.
        const runsRescatados: string[] = [];
        const limiteColgado = new Date(now.getTime() - MINUTOS_RUN_COLGADO * 60_000).toISOString();

        const { data: colgados } = await supabase
            .from('execution_runs')
            .update({
                status:        'error',
                finished_at:   now.toISOString(),
                error_message: `Ejecución sin cerrar tras ${MINUTOS_RUN_COLGADO} min — la función terminó sin registrar el resultado`,
            })
            .eq('status', 'running')
            .lt('started_at', limiteColgado)
            .select('id');

        for (const r of colgados ?? []) runsRescatados.push(r.id);

        return new Response(
            JSON.stringify({
                checked:  (cronNodes ?? []).length,
                fired:    fired.length,
                fired_workflows:   fired,
                skipped_workflows: skipped,
                aprobaciones_escaladas: escaladas,
                aprobaciones_vencidas:  vencidas,
                runs_colgados_cerrados: runsRescatados,
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
