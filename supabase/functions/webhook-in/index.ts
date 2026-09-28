// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Puerta del webhook de entrada
// Edge Function: webhook-in   (PÚBLICA — se despliega con --no-verify-jwt)
// POST /functions/v1/webhook-in/<workflow_id>
//   cabecera x-webhook-secret: hfw_…   (o ?secreto= si el flujo lo permite)
//   cabecera Idempotency-Key: …        (opcional, recomendada)
// Diseño: docs/superpowers/specs/2026-09-28-webhook-entrada-design.md
//
// No ejecuta nodos. Valida, autentica, registra la llamada y le pasa el
// testigo a execute-workflow por la vía interna (x-cron-secret) con SOLO el id
// de la recepción: el motor lee los datos de la base al anclarla.
//
// Sin CORS a propósito: es una llamada entre servidores. Un navegador que la
// hiciera estaría enseñando el secreto a quien abra la página.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enviarEmail, escaparHtml } from '../_shared/email.ts';
import { fechaHoraVE } from '../_shared/fecha.ts';
import { destinatariosDelRol } from '../_shared/delegaciones.ts';
import {
    MAX_BYTES, LIMITE_POR_MINUTO,
    extraerIdFlujo, validarEntrada, validarIdempotencyKey, elegirSecreto,
    sha256Hex, igualesTiempoConstante, motivoDeCuerpo,
} from '../_shared/webhook.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Se lee al arrancar el isolate (§6.1.1): un secreto recién rotado entra al reciclarse.
const CRON_SECRET      = Deno.env.get('CRON_SECRET') ?? '';

const ESTADOS_ACEPTADOS = ['aceptada', 'lanzada', 'fallo_al_lanzar'];

// Se compara contra esto cuando el flujo no tiene webhook, para que el tiempo
// de respuesta no delate qué flujos lo tienen.
const HUELLA_NULA = '0'.repeat(64);

function json(status: number, cuerpo: unknown, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(cuerpo), {
        status,
        headers: { 'Content-Type': 'application/json', ...extra },
    });
}

// Idéntico para «no existe», «sin webhook» y «secreto erróneo».
const noAutorizado = () => json(401, { error: 'No autorizado' });

const haceMs = (ms: number) => new Date(Date.now() - ms).toISOString();

// ── Filas de rechazo: como mucho UNA por flujo, estado y minuto ─────────────
// Quien tiene el secreto no puede llenar la tabla a base de llamadas
// rechazadas: el usuario ve que hubo rechazos, no cada uno. Un fallo aquí no
// cambia la respuesta: se registra en el log de la función.
async function registrarLimitado(
    db: SupabaseClient, org: string, workflowId: string, estado: string,
    motivo: string, eventoId: string | null, runId: string | null,
): Promise<void> {
    try {
        const { count, error } = await db.from('webhook_recepciones')
            .select('id', { count: 'exact', head: true })
            .eq('workflow_id', workflowId).eq('estado', estado).gte('recibido_at', haceMs(60_000));
        if (error) throw error;
        if ((count ?? 0) > 0) return;
        const { error: insErr } = await db.from('webhook_recepciones').insert({
            organization_id: org, workflow_id: workflowId, estado, motivo,
            evento_id: eventoId, execution_run_id: runId,
        });
        if (insErr) throw insErr;
    } catch (e) {
        console.error(`webhook-in: no se pudo registrar «${estado}» del flujo ${workflowId}: ${(e as { message?: string }).message}`);
    }
}

interface RecepcionPrevia {
    execution_run_id: string | null;
    estado:           string;
    motivo:           string | null;
}

async function buscarPrevia(db: SupabaseClient, workflowId: string, eventoId: string): Promise<RecepcionPrevia | null> {
    const { data, error } = await db.from('webhook_recepciones')
        .select('execution_run_id, estado, motivo')
        .eq('workflow_id', workflowId).eq('evento_id', eventoId).in('estado', ESTADOS_ACEPTADOS)
        .maybeSingle();
    if (error) throw new Error(`No se pudo comprobar si la llamada estaba repetida: ${error.message}`);
    return data;
}

// La respuesta dice cómo acabó la llamada original, no solo que hubo una
// repetida: «duplicada» a secas no distingue una que corrió de una que se
// quedó en 'aceptada' o que falló al lanzar — el mismo «✓ Guardado» que no
// medía nada (§12.2), aquí del lado del que llama.
async function responderDuplicada(
    db: SupabaseClient, org: string, workflowId: string, eventoId: string, previa: RecepcionPrevia,
): Promise<Response> {
    await registrarLimitado(db, org, workflowId, 'duplicada',
        `Llamada repetida con Idempotency-Key «${eventoId}»: no se vuelve a ejecutar.`, eventoId, previa.execution_run_id);
    const cuerpo: Record<string, unknown> = {
        duplicada:        true,
        execution_run_id: previa.execution_run_id,
        estado_original:  previa.estado,
    };
    if (previa.estado === 'fallo_al_lanzar') {
        const razon = (previa.motivo ?? '').trim();
        cuerpo.motivo = (razon ? `${razon} ` : '') +
            'La llamada original no llegó a ejecutarse; para reintentar, usa una Idempotency-Key nueva.';
    }
    return json(200, cuerpo);
}

// ── Aviso a los administradores: uno por flujo y hora ───────────────────────
// El turno se toma con un UPDATE condicional: si dos fallos llegan a la vez,
// solo uno devuelve fila y solo ese manda el correo.
async function avisarFallo(
    db: SupabaseClient, p: { workflowId: string; organizationId: string; nombreFlujo: string }, motivo: string,
): Promise<void> {
    try {
        const { data: turno, error } = await db.from('workflow_webhooks')
            .update({ ultimo_aviso_fallo_at: new Date().toISOString() })
            .eq('workflow_id', p.workflowId)
            .or(`ultimo_aviso_fallo_at.is.null,ultimo_aviso_fallo_at.lt."${haceMs(3_600_000)}"`)
            .select('workflow_id');
        if (error) throw error;
        if (!turno || turno.length === 0) return;   // ya se avisó en la última hora

        const admins = await destinatariosDelRol(db, p.organizationId, 'admin');
        const emails = admins.map(a => a.email).filter(Boolean);
        if (emails.length === 0) {
            console.error(`webhook-in: fallo al lanzar «${p.nombreFlujo}» y no hay administradores activos a quien avisar`);
            return;
        }
        await enviarEmail(
            emails,
            `⚠️ Webhook recibido pero el flujo no arrancó — ${p.nombreFlujo}`,
            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#b45309;font-size:18px">Una llamada al webhook no pudo lanzar el flujo</h2>
  <p style="color:#374151;font-size:14px">
    <strong>Flujo:</strong> ${escaparHtml(p.nombreFlujo)}<br>
    <strong>Hora:</strong> ${escaparHtml(fechaHoraVE(new Date()))} (hora de Venezuela)
  </p>
  <p style="color:#374151;font-size:14px"><strong>Motivo:</strong> ${escaparHtml(motivo)}</p>
  <p style="color:#6b7280;font-size:13px">La llamada quedó guardada con sus datos, en estado «Falló al lanzar»,
  en el panel del nodo Webhook del Constructor. Se envía como máximo un aviso por flujo y hora.</p>
</div>`,
        );
    } catch (e) {
        console.error(`webhook-in: no se pudo avisar del fallo de «${p.nombreFlujo}»: ${(e as { message?: string }).message}`);
    }
}

// ── Lanzar el motor (en segundo plano, tras responder 202) ──────────────────
async function lanzar(
    db: SupabaseClient,
    p: { recepcionId: string; workflowId: string; organizationId: string; nombreFlujo: string },
): Promise<void> {
    let motivo: string | null = null;

    if (CRON_SECRET === '') {
        motivo = 'CRON_SECRET no está configurado en webhook-in: la llamada se recibió pero no se pudo lanzar el flujo.';
    } else {
        try {
            const { error } = await db.functions.invoke('execute-workflow', {
                headers: { 'x-cron-secret': CRON_SECRET },
                body: {
                    workflowId:     p.workflowId,
                    organizationId: p.organizationId,   // de la fila del flujo, nunca del cuerpo recibido
                    triggeredBy:    'webhook',
                    recepcionId:    p.recepcionId,
                },
            });
            if (error) {
                // `error.message` es siempre «non-2xx status code»: el motivo va en el cuerpo (§12.2).
                motivo = error.message;
                const ctx = (error as unknown as { context?: Response }).context;
                if (ctx && typeof ctx.text === 'function') {
                    try { motivo = motivoDeCuerpo(ctx.status, await ctx.text()); } catch { /* cuerpo ya consumido */ }
                }
            }
        } catch (e) {
            motivo = `No se pudo llamar al motor: ${(e as { message?: string }).message}`;
        }
    }

    if (motivo === null) return;   // el motor respondió 2xx: lo que pase después está en el run
    console.error(`webhook-in: fallo al lanzar la recepción ${p.recepcionId} — ${motivo}`);

    // Solo si sigue en 'aceptada'. Si el motor ya la ancló ('lanzada'), el fallo
    // pertenece al run y se ve en Monitoreo: no se pisa ni se avisa dos veces.
    const { data: cambiadas, error } = await db.from('webhook_recepciones')
        .update({ estado: 'fallo_al_lanzar', motivo })
        .eq('id', p.recepcionId).eq('estado', 'aceptada')
        .select('id');
    if (error) {
        console.error(`webhook-in: no se pudo marcar la recepción ${p.recepcionId} como fallida: ${error.message}`);
    } else if (!cambiadas || cambiadas.length === 0) {
        return;
    }
    await avisarFallo(db, p, motivo);
}

serve(async (req: Request) => {
    try {
        const url        = new URL(req.url);
        const workflowId = extraerIdFlujo(url.pathname);
        if (!workflowId) return noAutorizado();

        // Tope antes de leer: una cabecera honesta nos ahorra cargar el cuerpo.
        const declarado = Number(req.headers.get('content-length') ?? '0');
        if (req.method === 'POST' && Number.isFinite(declarado) && declarado > MAX_BYTES) {
            return json(413, { error: `El cuerpo supera el máximo de ${MAX_BYTES / 1024} KB.` });
        }

        // ── 1. Forma de la llamada (no se registra) ─────────────────────────
        const cuerpo  = new Uint8Array(await req.arrayBuffer());
        const entrada = validarEntrada(req.method, req.headers.get('content-type'), cuerpo);
        if (!entrada.ok) return json(entrada.status, { error: entrada.error });

        const clave = validarIdempotencyKey(req.headers.get('idempotency-key'));
        if (!clave.ok) return json(clave.status, { error: clave.error });

        const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // ── 2. Autenticación (no se registra: solo console.warn, sin el secreto)
        const { data: hook, error: hookErr } = await db.from('workflow_webhooks')
            .select('workflow_id, organization_id, secreto_hash, permite_secreto_url')
            .eq('workflow_id', workflowId)
            .maybeSingle();
        if (hookErr) {
            console.error(`webhook-in: no se pudo leer workflow_webhooks: ${hookErr.message}`);
            return json(500, { error: 'No se pudo comprobar la llamada. Inténtalo más tarde.' });
        }

        const secreto = elegirSecreto(
            req.headers.get('x-webhook-secret'),
            url.searchParams.get('secreto'),
            hook?.permite_secreto_url === true,
        );
        // Siempre se calcula y se compara, exista o no el flujo.
        const huella = await sha256Hex(secreto ?? '');
        const casa   = igualesTiempoConstante(huella, (hook?.secreto_hash as string | undefined) ?? HUELLA_NULA);
        if (!hook || secreto === null || !casa) {
            console.warn(`webhook-in: llamada no autorizada al flujo ${workflowId} (${hook ? 'secreto ausente o erróneo' : 'sin webhook'})`);
            return noAutorizado();
        }
        const org = hook.organization_id as string;

        // ── 3. ¿El flujo puede recibir? ─────────────────────────────────────
        const { data: wf, error: wfErr } = await db.from('workflows')
            .select('name, organization_id, estado_definicion, is_active')
            .eq('id', workflowId)
            .maybeSingle();
        if (wfErr) throw new Error(`No se pudo leer el flujo: ${wfErr.message}`);

        const { count: disparadores, error: trigErr } = await db.from('workflow_nodes')
            .select('id', { count: 'exact', head: true })
            .eq('workflow_id', workflowId).eq('type', 'trigger').eq('category', 'webhook');
        if (trigErr) throw new Error(`No se pudieron leer los nodos del flujo: ${trigErr.message}`);

        const nombreFlujo = (wf?.name as string | undefined) ?? workflowId;
        let noApto: string | null = null;
        if (!wf || wf.organization_id !== org) {
            noApto = 'El flujo ya no existe.';
        } else if (wf.estado_definicion !== 'publicado') {
            noApto = `El flujo «${nombreFlujo}» no está publicado (está en ${wf.estado_definicion}): tiene que pasar por revisión antes de aceptar llamadas.`;
        } else if (!wf.is_active) {
            noApto = `El flujo «${nombreFlujo}» está desactivado.`;
        } else if (!disparadores) {
            noApto = `El flujo «${nombreFlujo}» no tiene un nodo «Webhook Entrante»: no sabría por dónde empezar.`;
        }
        if (noApto) {
            await registrarLimitado(db, org, workflowId, 'rechazada_inactivo', noApto, clave.valor, null);
            return json(409, { error: noApto });
        }

        // ── 4. Límite por minuto ────────────────────────────────────────────
        const { count: recientes, error: limErr } = await db.from('webhook_recepciones')
            .select('id', { count: 'exact', head: true })
            .eq('workflow_id', workflowId).in('estado', ESTADOS_ACEPTADOS).gte('recibido_at', haceMs(60_000));
        if (limErr) throw new Error(`No se pudo contar las llamadas recientes: ${limErr.message}`);
        if ((recientes ?? 0) >= LIMITE_POR_MINUTO) {
            const m = `Más de ${LIMITE_POR_MINUTO} llamadas a este flujo en el último minuto. Espera un momento.`;
            await registrarLimitado(db, org, workflowId, 'frenada_limite', m, clave.valor, null);
            return json(429, { error: m }, { 'Retry-After': '60' });
        }

        // ── 5. ¿Repetida? ───────────────────────────────────────────────────
        if (clave.valor) {
            const previa = await buscarPrevia(db, workflowId, clave.valor);
            if (previa) return await responderDuplicada(db, org, workflowId, clave.valor, previa);
        }

        // ── 6. Aceptar ──────────────────────────────────────────────────────
        const { data: nueva, error: insErr } = await db.from('webhook_recepciones')
            .insert({
                organization_id: org,
                workflow_id:     workflowId,
                evento_id:       clave.valor,
                estado:          'aceptada',
                payload:         entrada.valor,
                bytes:           cuerpo.byteLength,
            })
            .select('id')
            .single();
        if (insErr) {
            // Dos llamadas iguales a la vez: la base decidió; la segunda es duplicada.
            if (insErr.code === '23505' && clave.valor) {
                const previa = await buscarPrevia(db, workflowId, clave.valor);
                return await responderDuplicada(db, org, workflowId, clave.valor,
                    previa ?? { execution_run_id: null, estado: 'aceptada', motivo: null });
            }
            throw new Error(`No se pudo registrar la llamada: ${insErr.message}`);
        }

        EdgeRuntime.waitUntil(lanzar(db, {
            recepcionId: nueva.id as string, workflowId, organizationId: org, nombreFlujo,
        }));
        return json(202, { recibido: true, recepcion_id: nueva.id });
    } catch (e) {
        console.error(`webhook-in: ${(e as { message?: string }).message}`);
        return json(500, { error: 'No se pudo procesar la llamada. Inténtalo más tarde.' });
    }
});
