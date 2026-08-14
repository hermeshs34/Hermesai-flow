// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Resolución de Aprobaciones (F2)
// POST { tareaId, decision: 'aprobado'|'rechazado', comentario?, approverId }
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enviarEmail as enviar, canalEmail, escaparHtml } from '../_shared/email.ts';
import { delegacionesVigentes } from '../_shared/delegaciones.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET      = Deno.env.get('CRON_SECRET') ?? '';

// ── Regla de negocio: quién puede resolver qué ─────────────────────────────
// Los procesos de cumplimiento y legitimación de capitales los autoriza SOLO
// el Oficial de Cumplimiento — ni siquiera el admin. El resto de tareas las
// resuelve el rol indicado en `rol_aprobador` o un admin.
//
// ⚠️ GEMELO de `puedeResolverTarea` en `src/core/user.types.ts`, porque Deno no
// alcanza `src/`. Es el mismo caso que ROLES_QUE_EJECUTAN (CLAUDE.md §6): si
// cambias una, cambia la otra. **Manda esta**: el frontend solo pinta botones.
//
// Hasta el 14/08/2026 el frontend tenía la regla suelta en CINCO sitios y los
// cinco decían cosas distintas —a un supervisor le contaban tareas de `admin`,
// a un solicitante le pintaban «Aprobar» sobre su propia tarea—. Ahora el
// frontend tiene UNA copia; esta sigue siendo la que impide de verdad.
//
// Hasta el 11/08/2026 esta comprobación NO EXISTÍA aquí: la función validaba
// organización y segregación de funciones, pero nunca que el aprobador tuviera
// el rol que la tarea exige. La regla del Oficial de Cumplimiento vivía solo en
// el navegador, así que por API cualquier usuario autenticado de la
// organización que no fuera el solicitante podía aprobar una tarea suya. Mismo
// patrón que audit_log y que execute-workflow antes del 07/08.
const ROLES_REGULATORIOS = ['cumplimiento'];

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        const { tareaId, decision, comentario, approverId: bodyApproverId } = await req.json();

        if (!tareaId || !decision) {
            return new Response(
                JSON.stringify({ error: 'tareaId y decision son requeridos' }),
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

        // ── Autenticación: el aprobador se deriva del JWT, nunca del body ───
        // El approverId del body solo se acepta en llamadas internas que traen
        // el service role key — desde el frontend la identidad sale del token.
        const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
        let approverId: string;
        // `token !== ''` no es adorno: si SERVICE_ROLE_KEY llegara vacía por un
        // despliegue mal configurado, '' === '' haría interna toda petición SIN
        // cabecera, y una llamada interna aquí elige a dedo quién aprueba.
        if (token !== '' && token === SERVICE_ROLE_KEY) {
            if (!bodyApproverId) {
                return new Response(
                    JSON.stringify({ error: 'approverId requerido en llamadas internas' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
            approverId = bodyApproverId;
        } else {
            const { data: userData } = token
                ? await supabase.auth.getUser(token)
                : { data: { user: null } };
            if (!userData?.user) {
                return new Response(
                    JSON.stringify({ error: 'No autenticado — sesión inválida o expirada' }),
                    { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
            approverId = userData.user.id;
        }

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

        // 2a. El aprobador debe pertenecer a la organización de la tarea
        const { data: aprobadorProfile } = await supabase
            .from('profiles')
            .select('organization_id, email, role')
            .eq('id', approverId)
            .single();
        if (!aprobadorProfile || aprobadorProfile.organization_id !== tarea.organization_id) {
            return new Response(
                JSON.stringify({ error: 'No autorizado — el aprobador no pertenece a esta organización' }),
                { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 2b. El aprobador debe tener el rol que la tarea exige (ver ROLES_REGULATORIOS)
        //
        // Un rol se puede tener de dos maneras: por el propio perfil, o por una
        // delegación vigente de quien sí lo tiene. La suplencia alcanza también a
        // las tareas regulatorias —si no, no serviría de nada: el único punto
        // único de fallo real es que hay un solo Oficial de Cumplimiento—, y lo
        // que impide que se convierta en la puerta de al lado de §6.2 es que un
        // admin NO puede crear una delegación en nombre de un rol regulatorio.
        // Eso lo guarda `delegaciones_validar()` en la base, no este código.
        const rolAprobador = aprobadorProfile.role;

        // Si esto falla, falla la resolución. Tragarse el error convertiría «no
        // se pudo comprobar» en «no tienes permiso», que es un 403 mintiendo.
        const delegaciones = await delegacionesVigentes(supabase, approverId, tarea.organization_id);
        const delegacionUsada = delegaciones.find(d => d.rol === tarea.rol_aprobador)
            ?? (ROLES_REGULATORIOS.includes(tarea.rol_aprobador)
                    ? undefined
                    : delegaciones.find(d => d.rol === 'admin'));

        const roles = [rolAprobador, ...delegaciones.map(d => d.rol)];
        const esRegulatoria  = ROLES_REGULATORIOS.includes(tarea.rol_aprobador);
        const puedeResolver  = esRegulatoria
            ? roles.includes(tarea.rol_aprobador)
            : roles.includes('admin') || roles.includes(tarea.rol_aprobador);
        if (!puedeResolver) {
            return new Response(
                JSON.stringify({
                    error: esRegulatoria
                        ? `Esta aprobación es de "${tarea.rol_aprobador}" y solo la resuelve ese rol — ni siquiera un administrador. Si esa persona no está disponible, puede dejar una delegación desde Gobierno → Delegaciones.`
                        : `El rol "${rolAprobador}" no puede resolver una aprobación de "${tarea.rol_aprobador}"`,
                }),
                { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // Si el rol propio ya bastaba, no se anota delegación aunque exista una:
        // el hecho a registrar es «resolvió POR delegación», no «además tenía una».
        const rolPropioBastaba = esRegulatoria
            ? rolAprobador === tarea.rol_aprobador
            : rolAprobador === 'admin' || rolAprobador === tarea.rol_aprobador;
        const delegacion = rolPropioBastaba ? undefined : delegacionUsada;

        // 2c. Verificar SoD: el aprobador no puede ser quien SOLICITÓ/EJECUTÓ esta tarea
        // (se compara con solicitante_id, no created_by — el diseñador puede ser el aprobador)
        if (tarea.solicitante_id && tarea.solicitante_id === approverId) {
            return new Response(
                JSON.stringify({ error: 'Segregación de funciones: quien ejecutó el flujo no puede aprobarlo' }),
                { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 3. Marcar tarea resuelta
        const { error: errResolver } = await supabase.from('tareas_aprobacion').update({
            estado:        decision,
            aprobador_id:  approverId,
            comentario:    comentario ?? null,
            resolved_at:   new Date().toISOString(),
            // Queda escrito que se resolvió por suplencia. `delegaciones` se
            // puede borrar, así que inferirlo después mirando la tabla no
            // serviría: un control cuya evidencia se puede borrar no es un
            // control. Los nombres, en `audit_log`, unas líneas más abajo.
            delegacion_id: delegacion?.delegacionId ?? null,
        }).eq('id', tareaId);

        // Esto NO puede fallar en silencio: si el UPDATE no entra, la tarea sigue
        // 'pendiente' y abajo se reanudaría un run cuya aprobación no consta. Es
        // el fallo de siempre —supabase-js devuelve el error, no lo lanza— y ya
        // costó dos meses de auditoría de aprobaciones perdida (§5.1).
        if (errResolver) {
            return new Response(
                JSON.stringify({ error: `No se pudo registrar la decisión: ${errResolver.message}` }),
                { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // 4. Registrar en audit_log
        // La columna es usuario_id, no actor_id: audit_log la creó
        // 20260531_f1_gobierno.sql con usuario_id + usuario_email. Aquí decía
        // actor_id, que no existe, así que PostgREST rechazaba el INSERT y
        // supabase-js devolvía el error en `error` — nadie lo miraba. Resultado:
        // ni una sola resolución de aprobación quedó auditada desde F2 (la tabla
        // no tiene una sola fila 'aprobar' ni 'rechazar'), pese a que el flujo
        // funcionaba de cara al usuario. Por eso ahora se comprueba el error.
        const { error: errAudit } = await supabase.from('audit_log').insert({
            organization_id: tarea.organization_id,
            usuario_id:      approverId,
            usuario_email:   aprobadorProfile.email ?? null,
            accion:          decision === 'aprobado' ? 'aprobar' : 'rechazar',
            entidad:         'aprobacion',
            entidad_id:      tareaId,
            descripcion:     `${decision === 'aprobado' ? 'Aprobado' : 'Rechazado'}: ${tarea.descripcion ?? ''}` +
                             // Los DOS nombres, en texto y aquí mismo. Un auditor
                             // no debería tener que cruzar tres tablas para saber
                             // quién autorizó en nombre de quién.
                             (delegacion ? ` [por delegación de ${delegacion.titularNombre} (${tarea.rol_aprobador})]` : '') +
                             `${comentario ? ` — ${comentario}` : ''}`,
        });

        // El audit no debe tumbar la resolución —la tarea ya está resuelta— pero
        // tampoco puede volver a perderse en silencio: queda en los logs.
        if (errAudit) {
            console.error(`resolve-approval: audit_log no registró la tarea ${tareaId} — ${errAudit.message}`);
        }

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
            if (canalEmail() !== 'ninguno' && tarea.solicitante_id) {
                try {
                    const { data: solicitante } = await supabase
                        .from('profiles')
                        .select('name, email')
                        .eq('id', tarea.solicitante_id)
                        .single();

                    if (solicitante?.email) {
                        const { data: wfData } = await supabase
                            .from('workflows').select('name').eq('id', tarea.workflow_id).single();

                        await enviar(
                            solicitante.email,
                            `❌ Flujo rechazado — ${wfData?.name ?? 'Flujo'}`,
                            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#7f1d1d;padding:24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">❌ Solicitud Rechazada</h2>
    <p style="color:#fca5a5;margin:8px 0 0;font-size:13px">HermesAI Flow — Automatización de Procesos</p>
  </div>
  <div style="padding:24px;background:#f8fafc">
    <p style="color:#374151;font-size:14px">Hola <strong>${escaparHtml(solicitante.name)}</strong>,</p>
    <p style="color:#374151;font-size:14px">Tu solicitud del flujo <strong>"${escaparHtml(wfData?.name ?? '')}"</strong> fue <strong style="color:#dc2626">rechazada</strong>.</p>
    ${tarea.descripcion ? `<p style="color:#374151;font-size:13px"><strong>Solicitud:</strong> ${escaparHtml(tarea.descripcion)}</p>` : ''}
    ${comentario ? `<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:4px;margin:12px 0"><p style="margin:0;color:#7f1d1d;font-size:13px"><strong>Motivo:</strong> ${escaparHtml(comentario)}</p></div>` : ''}
    <p style="color:#9ca3af;font-size:11px;margin-top:20px">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`,
                        );
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

        // 6. Reanudar el flujo desde AQUÍ, por la vía interna (`x-cron-secret`)
        //
        // Antes esto lo hacía el FRONTEND, llamando a execute-workflow con el JWT
        // del aprobador. El comentario que lo justificaba —"las llamadas
        // inter-función tienen problemas de JWT"— era cierto hasta el 07/08/2026;
        // desde que existe `x-cron-secret` (CLAUDE.md §6.1) ya no lo es.
        //
        // Y esa vía estaba ROTA: execute-workflow exige que el llamante esté en
        // ROLES_QUE_EJECUTAN {admin, dueno_proceso, autorizador}, así que un
        // `cumplimiento` aprobaba la tarea y acto seguido recibía un 403 al
        // reanudar — el run se quedaba en esperando_aprobacion para siempre.
        // Reanudar NO es lanzar: es la continuación de un run que arrancó otro, y
        // quien la autoriza es la aprobación que acaba de concederse, no el rol
        // del aprobador. Por eso va como llamada interna y no hereda esa matriz.
        //
        // ⚠️ Sin CRON_SECRET la llamada no se reconocería como interna y
        // execute-workflow devolvería 401. Se avisa en claro en vez de dejar el
        // run colgado sin explicación.
        let reanudado  = false;
        let errorResume: string | null = null;

        if (CRON_SECRET === '') {
            errorResume = 'CRON_SECRET no está configurado en esta función — no se puede reanudar el flujo';
            console.error(`resolve-approval: ${errorResume}`);
        } else {
            const { data: resumeData, error: resumeErr } = await supabase.functions.invoke('execute-workflow', {
                headers: { 'x-cron-secret': CRON_SECRET },
                body: {
                    workflowId:     tarea.workflow_id,
                    organizationId: tarea.organization_id,
                    triggeredBy:    'approval',
                    action:         'resume',
                    runId:          tarea.execution_run_id,
                    approverId,
                },
            });

            if (resumeErr) {
                // `resumeErr.message` es siempre "Edge Function returned a non-2xx
                // status code". El motivo va en el cuerpo, que supabase-js deja en
                // `context` — mismo tratamiento que en cron-runner.
                errorResume = resumeErr.message;
                const ctx = (resumeErr as unknown as { context?: Response }).context;
                if (ctx && typeof ctx.text === 'function') {
                    try {
                        const cuerpo = (await ctx.text()).slice(0, 600);
                        // El motivo va en `error` del JSON. Se saca en limpio
                        // porque este texto acaba en un toast delante del
                        // aprobador: «El flujo se modificó después de que se
                        // aprobara…» se entiende; «HTTP 409 — {"error":…}» no.
                        let motivo = '';
                        try { motivo = String(JSON.parse(cuerpo)?.error ?? ''); } catch { /* no era JSON */ }
                        errorResume = motivo !== '' ? motivo : `HTTP ${ctx.status} — ${cuerpo}`;
                    } catch { /* cuerpo ya consumido */ }
                }
                console.error(`resolve-approval: no se pudo reanudar el run ${tarea.execution_run_id} — ${errorResume}`);
            } else {
                reanudado = !resumeData?.error;
                if (!reanudado) errorResume = String(resumeData?.error);
            }
        }

        return new Response(
            JSON.stringify({
                success:        true,
                decision:       'aprobado',
                runId:          tarea.execution_run_id,
                workflowId:     tarea.workflow_id,
                organizationId: tarea.organization_id,
                reanudado,
                errorResume,
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
