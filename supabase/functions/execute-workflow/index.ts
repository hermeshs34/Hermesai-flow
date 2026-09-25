// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Motor de Ejecución de Flujos
// Edge Function: execute-workflow
// Recibe: { workflowId, organizationId, triggeredBy? }
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enviarEmail as enviar, enviarEmailPersonalizado as enviarPersonalizado, canalEmail, escaparHtml } from '../_shared/email.ts';
import { fechaHoraVE, fechaVE } from '../_shared/fecha.ts';
import { resolverRegla, type ReglaMatriz } from '../_shared/matriz.ts';
import { destinatariosDelRol } from '../_shared/delegaciones.ts';
import { resolverModelo, saldosBalanceVacios, saldosResultadoVacios } from '../_shared/modelosFinancieros.ts';
import {
    bandaPorScore, similitudNombres, UMBRAL_TRGM, SCORE_MINIMO, SCORE_DOCUMENTO,
    type CandidatoLista, type MetodoScreening,
} from '../_shared/screeningNucleo.ts';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Credencial de las llamadas internas (cron-runner). Ver la puerta más abajo.
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// ── Quién puede lanzar un flujo ─────────────────────────────────────────────
// Es la lista de roles con el permiso `execute_workflows` de ROLE_PERMISSIONS
// (src/core/user.types.ts). Está copiada, no importada: una Edge Function corre
// en Deno y no alcanza el árbol de `src/`.
//
// ⚠️ SON DOS SITIOS QUE TIENEN QUE MOVERSE JUNTOS, igual que `view_audit` entre
// la UI y la política RLS de audit_log (§6 del CLAUDE.md). Si cambias
// ROLE_PERMISSIONS, cambia esto. Si solo cambias uno, la pantalla y el motor
// dejan de decir lo mismo y gana el que no miraste.
//
// Decisión de negocio de Hermes (08/08/2026): «la ejecución de los procesos es
// del dueño del proceso y el administrador o quien autoriza el proceso que está
// definido». Antes la lista incluía además `supervisor`, `operador` y los
// legacy `editor`/`operator`; se estrechó a estos tres.
//
// Fuera quedan a propósito: `supervisor` y `operador` (supervisan y operan,
// pero lanzar es del dueño), `cumplimiento` (aprueba, no ejecuta), `auditor` y
// `viewer` (solo lectura), y los legacy.
//
// `autorizador` sí ejecuta, pero ojo: la segregación de funciones sigue en pie
// en resolve-approval — quien lanza un flujo no puede aprobar su propia tarea.
const ROLES_QUE_EJECUTAN = new Set([
    'admin', 'dueno_proceso', 'autorizador',
]);

// Roles que pueden lanzar un flujo que TODAVÍA NO está publicado, o sea una
// ejecución de prueba de su propio borrador. Son los de `manage_workflows`
// (ROLE_PERMISSIONS): quien puede diseñarlo puede probarlo.
//
// Esto no ensancha nada — se cruza con ROLES_QUE_EJECUTAN, que ya se comprobó
// antes—, solo ESTRECHA quién lanza un borrador. Un flujo sin publicar no lo
// lanza el `autorizador`: él autoriza la definición, y ejecuta cuando ya está
// publicada.
const ROLES_QUE_DISENAN = new Set([
    'admin', 'dueno_proceso', 'editor',
]);

// Roles que un nodo de aprobación puede EXIGIR. Son los roles reales de
// `profiles.role` que además tienen el permiso `approve_tasks`.
// ⚠️ Copiada de la lista ROLES de `NodeConfigPanel.tsx` (el desplegable del
// Constructor), porque Deno no alcanza `src/`. Si cambias una, cambia la otra.
const ROLES_APROBADORES = new Set([
    'admin', 'supervisor', 'autorizador', 'cumplimiento',
]);

// ── Huella de la definición ─────────────────────────────────────────────────
//
// Los nodos se cargan al principio del handler, ANTES de saber si esto es un
// arranque o un `resume`. Así que un run que estuvo pausado esperando
// aprobación —hasta 48 h— reanuda con la definición que haya EN ESE MOMENTO en
// la base, no con la que se aprobó. Se aprueba la versión A y corre la B.
//
// La huella se guarda al pausar y se recalcula al reanudar. Cubre lo que cambia
// el comportamiento y deja fuera la posición en el lienzo: mover un nodo no
// cambia lo que hace, y un control que salta por arrastrar una caja es un
// control que la gente aprende a ignorar.
function canonico(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonico);
    if (v !== null && typeof v === 'object') {
        const orig = v as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        // Claves ordenadas: dos objetos iguales deben dar el mismo texto aunque
        // Postgres los devuelva con las claves en otro orden.
        for (const k of Object.keys(orig).sort()) out[k] = canonico(orig[k]);
        return out;
    }
    return v;
}

async function huellaDefinicion(nodes: any[], connections: any[]): Promise<string> {
    const n = [...(nodes ?? [])]
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map(x => [x.id, x.type, x.category, x.title ?? '', canonico(x.config_json ?? {})]);

    // `branch` entra en la huella: mover una conexión de la rama `true` a la
    // `false` no cambia qué nodos hay, pero cambia por completo lo que ocurre.
    const c = [...(connections ?? [])]
        .map(x => [x.source_node_id, x.target_node_id, x.branch ?? ''])
        .sort((a, b) => `${a[0]}→${a[1]}:${a[2]}`.localeCompare(`${b[0]}→${b[1]}:${b[2]}`));

    const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify({ n, c })),
    );
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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
    if (!expr) return expr;

    // Reemplazar todas las expresiones {{...}} dentro de una cadena
    if (expr.includes('{{')) {
        return expr.replace(/\{\{([^}]+)\}\}/g, (_, rawPath) => {
            const path = rawPath.trim();

            // {{summary}} → tabla HTML con todos los datos del contexto
            if (path === 'summary') return buildContextSummary(context);

            // {{previous.campo}} o {{previous.array.0.campo}}
            // Busca hacia atrás en todos los nodos del contexto hasta encontrar el campo.
            // Esto permite que un email post-aprobación resuelva datos del nodo AML anterior.
            if (path.startsWith('previous.')) {
                const field   = path.slice(9);
                const nodeIds = Object.keys(context).filter(k => k !== '__lastNodeId');
                for (let i = nodeIds.length - 1; i >= 0; i--) {
                    const nodeData = context[nodeIds[i]];
                    if (!nodeData || typeof nodeData !== 'object') continue;
                    let val: any = nodeData;
                    let found = true;
                    for (const segment of field.split('.')) {
                        if (val === null || val === undefined) { found = false; break; }
                        val = Array.isArray(val) ? val[Number(segment)] : val[segment];
                    }
                    if (found && val !== null && val !== undefined && val !== '') return val;
                }
                return '';
            }

            const parts = path.split('.');
            let val: any = context;
            for (const p of parts) val = val?.[p];
            return val ?? '';
        });
    }

    return expr;
}

// ── Formatea un valor para mostrar en HTML ───────────────────────────────────
function formatValue(val: any): string {
    if (val === null || val === undefined) return '—';
    if (Array.isArray(val)) {
        if (val.length === 0) return '—';
        // Array de objetos → mostrar solo el conteo
        if (typeof val[0] === 'object') return `${val.length} registros`;
        return val.join(', ');
    }
    if (typeof val === 'object') return JSON.stringify(val);
    if (typeof val === 'boolean') return val ? 'Sí' : 'No';
    // Formatear timestamps ISO
    if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T/)) {
        return fechaHoraVE(val);
    }
    return String(val);
}

// Campos a omitir en el resumen (demasiado verbose o internos)
const SKIP_FIELDS = new Set([
    'skipped','triggered','branch','evaluated','left','right','operator',
    'indicadores','alertas_activas','siniestros',
    // Metadatos de otros nodos: le dicen algo a quien depura, nada a quien lee
    // el correo. Llegaron a un informe de EE.FF. el 23/09/2026 como filas
    // «Modelo», «Tokens Output», «Email Id»…
    'modelo','tokens_input','tokens_output','email_id','sent','logged',
]);

// ── Resumen HTML del contexto para emails ────────────────────────────────────
function buildContextSummary(context: Record<string, any>): string {
    let rows = '';
    let bg = false;

    for (const [, nodeData] of Object.entries(context)) {
        if (typeof nodeData !== 'object' || nodeData === null) continue;

        for (const [k, val] of Object.entries(nodeData)) {
            if (SKIP_FIELDS.has(k)) continue;

            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const display = formatValue(val);

            // Colorear filas de semáforo
            let valueStyle = 'font-weight:600;font-size:13px;color:#111827';
            if (k === 'color') {
                const colors: Record<string,string> = { rojo:'#dc2626', amarillo:'#d97706', verde:'#16a34a' };
                valueStyle += `;color:${colors[String(val)] ?? '#111827'}`;
            }
            if (k === 'label') valueStyle += ';font-size:14px';

            const rowBg = bg ? '#f9fafb' : '#ffffff';

            // `display` viene de los sistemas conectados —una descripción de
            // siniestro, el nombre de una cuenta contable—: es dato ajeno dentro
            // de nuestra plantilla y va escapado.
            //
            // EXCEPCIÓN: los campos `*_html` son HTML que generó el propio motor
            // (hoy solo `reporte_html`, del nodo Regulatorio: un informe entero
            // que llega así al correo cuando el nodo Email no lleva cuerpo).
            // Escaparlos convertiría ese informe en código fuente a la vista.
            // Se distinguen por el nombre del campo, no por mirar el contenido:
            // adivinar si una cadena "parece HTML" es justo la heurística que
            // deja pasar lo que no debe.
            const esHtmlPropio = k.endsWith('_html');

            rows += `<tr style="background:${rowBg}">
                <td style="padding:8px 16px;color:#6b7280;font-size:12px;width:40%">${escaparHtml(label)}</td>
                <td style="padding:8px 16px;${valueStyle}">${esHtmlPropio ? display : escaparHtml(display)}</td>
            </tr>`;
            bg = !bg;
        }
    }

    return rows
        ? `<table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">${rows}</table>`
        : '<p style="color:#9ca3af;font-size:13px">Sin datos disponibles</p>';
}

// ── Tabla de coincidencias en listas restrictivas, para el correo ───────────
//
// TODAS las coincidencias, una cabecera por persona con sus siniestros, y
// debajo cada entrada de lista con su score. Estilo de los correos de alerta de
// RiskGuard (`_shared/alertas.ts` de ese proyecto). Sale del motor como campo
// `coincidencias_html` —el sufijo `_html` es lo que `buildContextSummary`
// reconoce como HTML propio— y la plantilla lo usa con
// {{previous.coincidencias_html}}. Antes la plantilla leía `hits.0.*` y el
// correo enseñaba solo la primera coincidencia de todo el lote.
//
// Todo dato que viene de RiskGuard pasa por `escaparHtml`.
const COLOR_BANDA: Record<string, string> = { alta: '#dc2626', media: '#d97706', baja: '#64748b' };
const ETIQUETA_ENTIDAD: Record<string, string> = {
    individual: 'Persona', entidad: 'Entidad', buque: 'Buque', aeronave: 'Aeronave',
};

function tablaCoincidenciasHtml(
    coincidencias: any[],
    info: { siniestrosRevisados: number | null; personasRevisadas: number; sinVerificar: string[]; loteIncompleto: boolean },
): string {
    const celdaEtq = 'padding:10px 14px;font-weight:700;color:#64748b;font-size:12px';
    const resumen: [string, string][] = [];
    if (info.siniestrosRevisados !== null) resumen.push(['Siniestros revisados', String(info.siniestrosRevisados)]);
    resumen.push(['Personas revisadas', String(info.personasRevisadas)]);
    resumen.push(['Personas con coincidencia', String(coincidencias.length)]);
    resumen.push(['Verificado', fechaHoraVE(new Date().toISOString())]);
    resumen.push(['Criterio', `Screening RiskGuard — documento exacto o nombre con score ≥ ${SCORE_MINIMO}`]);
    const tablaResumen = `<table style="width:100%;border-collapse:collapse;margin:0 0 20px;border:1px solid #e2e8f0">
      ${resumen.map(([k, v], i) => `<tr style="background:${i % 2 ? '#fff' : '#f8fafc'}"><td style="${celdaEtq};width:45%">${escaparHtml(k)}</td><td style="padding:10px 14px;font-weight:900;color:#0f172a;font-size:13px">${escaparHtml(v)}</td></tr>`).join('')}
    </table>`;

    const avisos: string[] = [];
    if (info.loteIncompleto) avisos.push('El lote de siniestros llegó a su tope: puede haber siniestros que no se leyeron ni se cruzaron con las listas.');
    if (info.sinVerificar.length) avisos.push(`${info.sinVerificar.length} siniestro(s) sin nombre ni documento del asegurado: NO se pudieron verificar (${info.sinVerificar.map(String).join(', ')}).`);
    const htmlAvisos = avisos.map(a =>
        `<p style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:10px 14px;color:#92400e;font-size:12px;font-weight:600;margin:0 0 12px">${escaparHtml(a)}</p>`
    ).join('');

    if (coincidencias.length === 0) {
        return `${tablaResumen}${htmlAvisos}<p style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:0 8px 8px 0;padding:12px 16px;color:#166534;font-size:13px;font-weight:700;margin:0">✅ Sin coincidencias en listas restrictivas</p>`;
    }

    const th = 'padding:8px 10px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px';
    const td = 'padding:8px 10px;font-size:12px;color:#0f172a;border-bottom:1px solid #f1f5f9;vertical-align:top';
    const bloques = coincidencias.map((c: any) => {
        const quien = escaparHtml(c.asegurado_nombre ?? c.asegurado_documento ?? '—');
        const doc = c.asegurado_documento && c.asegurado_nombre
            ? ` <span style="color:#94a3b8;font-weight:400;font-size:11px">(${escaparHtml(c.asegurado_documento)})</span>` : '';
        const sins = (c.siniestros ?? []).length
            ? `<div style="color:#cbd5e1;font-size:11px;font-weight:400;margin-top:2px">Siniestro${c.siniestros.length > 1 ? 's' : ''}: ${escaparHtml(c.siniestros.join(', '))}</div>` : '';
        const filas = (c.hits ?? []).map((h: any) => {
            const color = COLOR_BANDA[h.banda] ?? '#64748b';
            const entidad = h.tipo_entidad ? ETIQUETA_ENTIDAD[h.tipo_entidad] ?? h.tipo_entidad : null;
            const extra = [entidad, h.pais, h.documento ? `Doc. ${h.documento}` : null].filter(Boolean).map(x => escaparHtml(String(x))).join(' · ');
            return `<tr>
              <td style="${td};font-weight:700;white-space:nowrap">${escaparHtml(h.tipo_lista ?? '—')}</td>
              <td style="${td}"><strong>${escaparHtml(h.nombre ?? '—')}</strong>${extra ? `<div style="color:#64748b;font-size:11px;margin-top:2px">${extra}</div>` : ''}</td>
              <td style="${td};color:#475569;font-size:11px">${escaparHtml(h.motivo ?? '—')}</td>
              <td style="${td};text-align:center;white-space:nowrap"><span style="color:${color};font-weight:900;font-size:14px">${escaparHtml(String(h.score ?? '—'))}</span><div style="color:${color};font-size:10px;font-weight:700;text-transform:uppercase">${h.metodo === 'documento' ? 'documento' : escaparHtml(h.banda ?? '')}</div></td>
            </tr>`;
        }).join('');
        return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;border:1px solid #e2e8f0">
          <tr><td colspan="4" style="background:#0f172a;padding:10px 14px;color:#fff;font-weight:900;font-size:13px">${quien}${doc}${sins}</td></tr>
          <tr style="background:#f8fafc"><td style="${th}">Lista</td><td style="${th}">Nombre en lista</td><td style="${th}">Motivo</td><td style="${th};text-align:center">Score</td></tr>
          ${filas}
        </table>`;
    }).join('');

    return `${tablaResumen}${htmlAvisos}${bloques}
    <p style="color:#94a3b8;font-size:11px;margin:4px 0 0">Score 0–100: documento exacto = ${SCORE_DOCUMENTO}; por nombre, alta ≥ 85, media ≥ 72, baja ≥ ${SCORE_MINIMO}. Una coincidencia por nombre es un indicio para revisar, no una identificación.</p>`;
}

// ── Quién aprueba, según la matriz ──────────────────────────────────────────
//
// La matriz de aprobación llevaba desde F1 con CRUD completo en Gobierno y
// **sin que la leyera ni una Edge Function**: se configuraba y no gobernaba
// nada. Esto la conecta. El emparejamiento vive en `_shared/matriz.ts`, gemelo
// del de `src/utils/matrizAprobacion.ts` que alimenta el simulador.
async function reglaDeMatriz(
    db: any,
    organizationId: string,
    monto: number | null,
    categoria: string | null,
): Promise<ReglaMatriz> {
    const { data, error } = await db
        .from('matriz_aprobacion')
        .select('id, nombre, categoria, operador, umbral_monto, umbral_max, moneda, ' +
                'rol_aprobador, nivel, aprobadores_multiples, escalamiento_horas, ' +
                'aplica_automatico, condicion_extra, descripcion_regulatoria')
        .eq('organization_id', organizationId)
        .eq('activa', true);

    // supabase-js devuelve el error, no lo lanza (§5.1). Y una matriz que no se
    // ha podido leer NO es una matriz vacía: se para aquí en vez de continuar
    // como si no hubiera reglas, que es como se acaba asignando la aprobación
    // a quien no toca.
    if (error) {
        throw new Error(
            `No se pudo consultar la matriz de aprobación (${error.message}). ` +
            `El flujo se detiene aquí: sin matriz no hay forma de saber a quién ` +
            `corresponde autorizar este paso.`
        );
    }

    const resultado = resolverRegla((data ?? []) as ReglaMatriz[], monto, categoria);
    if (!resultado.ok) throw new Error(resultado.motivo);
    return resultado.regla;
}

// ── Ejecutor de nodo individual ──────────────────────────────────────────────
async function executeNode(
    node: any,
    context: Record<string, any>,
    db: any,
    organizationId: string,
): Promise<any> {
    const cfg      = node.config_json ?? {};
    const nodeKey  = `${node.type}:${node.category}`;

    switch (nodeKey) {

        // ── Triggers ─────────────────────────────────────────────────────
        case 'trigger:manual':
        case 'trigger:cron':
        case 'trigger:webhook':
            return { triggered: true, timestamp: new Date().toISOString() };

        // ── Email (ver _shared/email.ts) ──────────────────────────────────
        case 'output:email': {
            if (canalEmail() === 'ninguno') {
                throw new Error('Sin canal de correo: falta RESEND_API_KEY en Supabase Secrets');
            }
            const to      = resolveValue(cfg.to ?? '', context);
            const subject = resolveValue(cfg.subject ?? 'Notificación HermesAI Flow', context);
            let   body    = resolveValue(cfg.body ?? '', context);

            if (!to) throw new Error('Nodo Email: campo "to" requerido');

            // Si no hay cuerpo configurado, generar uno automático con todos los datos del flujo
            if (!body || body.trim() === '') {
                body = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#1e3a5f;padding:24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">📋 Resultado del Flujo — HermesAI Flow</h2>
  </div>
  <div style="padding:24px;background:#f8fafc">
    <p style="color:#374151;font-size:14px">El flujo se completó exitosamente. Datos obtenidos:</p>
    ${buildContextSummary(context)}
    <p style="color:#9ca3af;font-size:11px;margin-top:20px">Generado automáticamente · HermesAI Flow</p>
  </div>
</div>`;
            }

            const emailId = await enviar(to, subject, body, cfg.from);
            return { sent: true, email_id: emailId, to, subject };
        }

        // ── Enviar WhatsApp (Twilio) ─────────────────────────────────────
        case 'output:whatsapp': {
            const TWILIO_SID   = Deno.env.get('TWILIO_ACCOUNT_SID');
            const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
            // Sandbox de Twilio: whatsapp:+14155238886 — en producción, número WA aprobado
            const TWILIO_FROM  = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? 'whatsapp:+14155238886';
            if (!TWILIO_SID || !TWILIO_TOKEN)
                throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN no configurados en Supabase Secrets');

            const to      = resolveValue(cfg.to ?? '', context).trim();
            let   message = resolveValue(cfg.message ?? '', context).trim();
            if (!to) throw new Error('Nodo WhatsApp: campo "to" (número destino) requerido');

            // Normalizar destino: aceptar "+58414..." o "whatsapp:+58414..."
            const toWa = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
            if (!toWa.match(/^whatsapp:\+\d{8,15}$/))
                throw new Error(`Nodo WhatsApp: número inválido "${to}" — usar formato internacional +584141234567`);

            if (!message) {
                message = `📋 *HermesAI Flow*\nEl flujo se completó exitosamente.\n${fechaHoraVE(new Date())}`;
            }

            const twilioRes = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
                {
                    method:  'POST',
                    headers: {
                        Authorization:  'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        From: TWILIO_FROM.startsWith('whatsapp:') ? TWILIO_FROM : `whatsapp:${TWILIO_FROM}`,
                        To:   toWa,
                        Body: message.slice(0, 1600), // límite Twilio por mensaje
                    }),
                },
            );
            const twilioData = await twilioRes.json();
            if (!twilioRes.ok) {
                // Error 63015/21608: destinatario no unido al sandbox — mensaje claro para el usuario
                const hint = twilioData?.code === 21608 || twilioData?.code === 63015
                    ? ' (Sandbox: el destinatario debe enviar primero el código "join" al número de Twilio)'
                    : '';
                throw new Error(`Twilio API error ${twilioData?.code ?? twilioRes.status}: ${twilioData?.message ?? 'desconocido'}${hint}`);
            }
            return {
                sent:        true,
                whatsapp_sid: twilioData.sid,
                to:          toWa.replace('whatsapp:', ''),
                status:      twilioData.status, // queued | sent
            };
        }

        // ── Tasa BCV ─────────────────────────────────────────────────────
        case 'processor:bcv': {
            const ts = new Date().toISOString();

            // Fuente 1: pydolarve (API pública Venezuela)
            try {
                const r1 = await fetch('https://pydolarve.org/api/v1/dollar?page=bcv', {
                    headers: { 'Accept': 'application/json' },
                });
                if (r1.ok) {
                    const d1 = await r1.json();
                    const rate = d1?.monitors?.usd?.price ?? d1?.price ?? null;
                    if (rate) return { bcv_rate: Number(rate).toFixed(2), source: 'pydolarve.org (BCV)', timestamp: ts };
                }
            } catch { /* intentar siguiente */ }

            // Fuente 2: dolarapi.com
            try {
                const r2 = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
                if (r2.ok) {
                    const d2 = await r2.json();
                    const rate = d2?.promedio ?? d2?.price ?? null;
                    if (rate) return { bcv_rate: Number(rate).toFixed(2), source: 'dolarapi.com (BCV)', timestamp: ts };
                }
            } catch { /* intentar siguiente */ }

            // Fuente 3: dolartoday S3 (fallback original)
            try {
                const r3 = await fetch('https://s3.amazonaws.com/dolartoday/data.json');
                if (r3.ok) {
                    const d3 = await r3.json();
                    const rate = d3?.USD?.bcv ?? null;
                    if (rate) return { bcv_rate: Number(rate).toFixed(2), source: 'dolartoday.com (BCV)', timestamp: ts };
                }
            } catch { /* todas fallaron */ }

            return { bcv_rate: null, source: 'unavailable — todas las fuentes fallaron', timestamp: ts };
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
                case '==': result = String(left).toLowerCase().trim() === String(right).toLowerCase().trim(); break;
                case '!=': result = String(left).toLowerCase().trim() !== String(right).toLowerCase().trim(); break;
                case 'contains': result = String(left).toLowerCase().includes(String(right).toLowerCase()); break;
            }
            return { branch: result ? 'true' : 'false', evaluated: result, left, right, operator };
        }

        // ── Log de mensaje ────────────────────────────────────────────────
        case 'output:log': {
            const message = resolveValue(cfg.message ?? 'Log vacío', context);
            return { logged: message, timestamp: new Date().toISOString() };
        }

        // ── Aprobación Humana — pausa real (F2) ──────────────────────────
        case 'processor:aprobacion': {
            const descripcion = resolveValue(cfg.reason ?? 'Requiere revisión manual', context);
            const categoria   = cfg.categoria ? resolveValue(cfg.categoria, context) : null;

            // El importe puede venir de una plantilla (`{{nodo.total}}`). Si se
            // resuelve a algo que no es un número, se dice: un NaN no casaría
            // ningún umbral y el flujo moriría más abajo con «ninguna regla
            // cubre este paso», que es el motivo equivocado.
            let monto: number | null = null;
            if (cfg.monto !== undefined && cfg.monto !== null && String(cfg.monto).trim() !== '') {
                const crudo = resolveValue(String(cfg.monto), context);
                monto = Number(crudo);
                if (Number.isNaN(monto)) {
                    throw new Error(
                        `El importe del nodo de aprobación no es un número: "${crudo}". ` +
                        `Revisa el campo Monto en el Constructor.`
                    );
                }
            }

            // Dos caminos, y NINGÚN tercero con un rol por defecto:
            //  · el nodo fija el aprobador a dedo, o
            //  · lo dice la matriz de aprobación (Gobierno → Matriz).
            // Antes había un `cfg.approver ?? 'supervisor'` que asignaba la
            // tarea a un rol que durante meses no tuvo a NADIE: el flujo se
            // pausaba y nadie podía resolverlo. Un defecto silencioso en quién
            // autoriza no es un defecto, es un agujero de control.
            const rolFijado = typeof cfg.approver === 'string' ? cfg.approver.trim() : '';
            let rolAprobador: string;
            let regla: ReglaMatriz | null = null;
            let horasPorDefecto = 48;

            if (rolFijado) {
                rolAprobador = rolFijado;
            } else {
                regla           = await reglaDeMatriz(db, organizationId, monto, categoria);
                rolAprobador    = String(regla.rol_aprobador ?? '').trim();
                horasPorDefecto = Number(regla.escalamiento_horas) || 48;
            }

            // El rol tiene que EXISTIR. El nodo del flujo "Flujo F2 NR" tenía
            // guardado "Administrador" —la etiqueta del desplegable, no el rol—,
            // así que la tarea nacía pidiendo un rol inexistente y no la podía
            // resolver nadie: ni el Oficial de Cumplimiento ni el propio rol que
            // el usuario creía haber elegido. Fallar aquí, en claro, es mucho
            // mejor que pausar un flujo que ya nace muerto. Vale igual para un
            // rol que venga de la matriz: se teclea a mano y se equivoca igual.
            if (!ROLES_APROBADORES.has(rolAprobador)) {
                throw new Error(
                    regla
                        ? `La regla "${regla.nombre}" de la matriz de aprobación pide el rol ` +
                          `"${rolAprobador}", que no existe. Corrígela en Gobierno → Matriz de ` +
                          `aprobación eligiendo uno de: ${[...ROLES_APROBADORES].join(', ')}.`
                        : `Rol aprobador no válido: "${rolAprobador}". Abre el nodo de aprobación ` +
                          `en el Constructor y elige uno de: ${[...ROLES_APROBADORES].join(', ')}.`
                );
            }

            // Lo que ponga el nodo manda sobre el plazo de la regla; sin ninguno
            // de los dos, 48 h como siempre.
            const horasVence = cfg.horasVence ? Number(cfg.horasVence) : horasPorDefecto;
            const venceAt    = new Date(Date.now() + horasVence * 60 * 60 * 1000).toISOString();

            // La regla que decidió va en la descripción: quien aprueba tiene
            // derecho a saber POR QUÉ le ha llegado esto a él.
            const detalle = regla
                ? `${descripcion}\n\n— Asignado por la matriz de aprobación, regla «${regla.nombre}»` +
                  (regla.condicion_extra          ? `\n  Condición: ${regla.condicion_extra}` : '') +
                  (regla.descripcion_regulatoria  ? `\n  Base: ${regla.descripcion_regulatoria}` : '')
                : descripcion;

            // Señal para que el loop principal pause la ejecución
            throw {
                __pauseApproval: true,
                rolAprobador, descripcion: detalle, monto, categoria, venceAt,
                reglaNombre: regla?.nombre ?? null,
            };
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
            // El asegurado viaja en el resultado para que un "Verificar OFAC/ONU"
            // posterior sin nombre fijo revise a CADA asegurado del lote. Antes el
            // nodo AML solo sabía buscar un nombre escrito a mano, y el flujo
            // "Alerta de Siniestro" revisaba siempre a la misma persona.
            let query = rg
                .from('siniestros')
                .select('id,empresa_id,numero_siniestro,estado,ramo,fecha_ocurrencia,monto_reclamado,monto_usd,moneda,asegurado_nombre,asegurado_documento,asegurado_oracle_id,created_at')
                .order('created_at', { ascending: false })
                .limit(Number(cfg.limit) || 10);  // mismo tope que `limite`, abajo
            // `estado` vacío, ausente o 'todos' ⇒ cualquier estado. Se compara en
            // minúsculas: «Todos» filtraba por estado='Todos' y devolvía 0 filas.
            // Un estado que RiskGuard no conoce revienta: filtrar por él da 0
            // siniestros sin error, que se lee igual que «hoy no hubo ninguno».
            // (El antiguo defecto 'pendiente' era exactamente eso: no existe.)
            // Lista copiada del CHECK de `siniestros.estado` en RiskGuard.
            const ESTADOS_SINIESTRO = ['abierto', 'en_ajuste', 'en_evaluacion', 'aprobado', 'pagado', 'rechazado',
                'cerrado', 'reabierto', 'aviso', 'asignado', 'inspeccion', 'dictamen', 'pago_parcial', 'pago_final', 'apelacion'];
            const estadoCfg = String(cfg.estado ?? '').trim().toLowerCase();
            const estado = estadoCfg === 'todos' ? '' : estadoCfg;
            if (estado && !ESTADOS_SINIESTRO.includes(estado))
                throw new Error(`«${cfg.estado}» no es un estado de siniestro de RiskGuard. Deja el campo vacío para leerlos todos, o usa uno de: ${ESTADOS_SINIESTRO.join(', ')}.`);
            if (estado) query = query.eq('estado', estado);
            // Ventana de días: con un disparador diario y `dias=1` cada siniestro
            // se revisa una vez, no todos los días mientras siga pendiente.
            const dias = Number(cfg.dias);
            if (dias > 0) query = query.gte('created_at', new Date(Date.now() - dias * 86_400_000).toISOString());
            const limite = Number(cfg.limit) || 10;
            const { data: siniestros, error } = await query;
            if (error) throw new Error(`RiskGuard: ${error.message}${error.hint ? ` — ${error.hint}` : ''}`);
            // `asegurado_nombre`/`asegurado_documento` solo existen en la captura
            // manual de RiskGuard. Los siniestros que vienen de SIRWeb los dejan
            // vacíos e identifican al asegurado por `asegurado_oracle_id` contra el
            // padrón `oracle_asegurados` (clave empresa + id). Sin este cruce, dos
            // de cada tres siniestros salían «sin verificar» de las listas.
            const pendientes = (siniestros ?? []).filter((s: any) =>
                !String(s.asegurado_nombre ?? '').trim() && !String(s.asegurado_documento ?? '').trim() && s.asegurado_oracle_id);
            if (pendientes.length) {
                const ids = [...new Set(pendientes.map((s: any) => String(s.asegurado_oracle_id)))];
                const padron = new Map<string, any>();
                for (let i = 0; i < ids.length; i += 200) {
                    const { data: filas, error: errPadron } = await rg
                        .from('oracle_asegurados')
                        .select('empresa_id,id_oracle,nombre,rif_ci')
                        .in('id_oracle', ids.slice(i, i + 200));
                    if (errPadron) throw new Error(`RiskGuard padrón de asegurados: ${errPadron.message}${errPadron.hint ? ` — ${errPadron.hint}` : ''}`);
                    for (const f of filas ?? []) padron.set(`${f.empresa_id}|${f.id_oracle}`, f);
                }
                for (const s of pendientes as any[]) {
                    const a = padron.get(`${s.empresa_id}|${s.asegurado_oracle_id}`);
                    if (!a) continue;
                    s.asegurado_nombre = a.nombre ?? null;
                    s.asegurado_documento = a.rif_ci ?? null;
                    s.asegurado_fuente = 'padron_sirweb';
                }
            }
            const count = siniestros?.length ?? 0;
            // Llegar al tope significa que puede haber más siniestros que no se
            // leyeron — y que nadie revisará en listas. Se dice, no se calla.
            return { siniestros: siniestros ?? [], count, estado: estado || 'todos', dias: dias > 0 ? dias : null,
                     limite, limite_alcanzado: count >= limite };
        }

        // ── Verificación Listas Restrictivas (OFAC/ONU/UE) ───────────────────
        case 'processor:aml': {
            const RG_URL = Deno.env.get('RISKGUARD_SUPABASE_URL');
            const RG_KEY = Deno.env.get('RISKGUARD_SERVICE_ROLE_KEY');

            // Parámetros del nodo: nombre y/o documento a verificar
            const nombre    = cfg.nombre    ? resolveValue(String(cfg.nombre),    context) : null;
            const documento = cfg.documento ? resolveValue(String(cfg.documento), context) : null;
            // Sin PEP: RiskGuard no la carga desde el 13/09/2026. Mismo defecto que
            // `LISTAS_DISPONIBLES` de NodeConfigPanel.tsx.
            const tiposLista: string[] = cfg.listas ?? ['OFAC', 'ONU', 'UE', 'LOCAL', 'INTERPOL'];

            // Sin credenciales RiskGuard NO se inventa nada. Hasta el 25/09/2026
            // devolvía `en_lista: false` con un score al azar: una verificación
            // de listas que no se hizo salía como «limpio», y la rama `false`
            // de la decisión seguía como si nada. Decisión de Hermes: «prefiero
            // que se detenga con error, que inventar».
            if (!RG_URL || !RG_KEY) {
                throw new Error(
                    'No se pudo verificar en listas restrictivas: faltan las credenciales de RiskGuard ' +
                    '(RISKGUARD_SUPABASE_URL / RISKGUARD_SERVICE_ROLE_KEY en Supabase → Edge Functions → Secrets). ' +
                    'El flujo se detiene en vez de dar un resultado inventado.'
                );
            }

            // Limpiar y validar URL
            const rgUrl = RG_URL.trim().replace(/\/$/, '');
            if (!rgUrl.startsWith('https://') && !rgUrl.startsWith('http://')) {
                throw new Error(
                    `RISKGUARD_SUPABASE_URL inválida. Valor actual: "${rgUrl.substring(0, 40)}...". ` +
                    `Debe ser: https://xxxx.supabase.co (sin /rest/v1 ni rutas extra)`
                );
            }
            const rg = createClient(rgUrl, RG_KEY);

            // Una persona contra las listas, con el MISMO criterio que la cola de
            // screening de RiskGuard: su RPC `screening_candidatos` preselecciona
            // por trigramas (o documento exacto) y `screeningNucleo.ts` —gemelo
            // copiado— puntúa 0–100. Documento exacto = 100; por nombre se
            // reporta desde SCORE_MINIMO (60). Hasta el 25/09/2026 esto era un
            // `ilike` sobre la palabra más larga con tope de 20 filas y un
            // post-filtro de «dos palabras en común»: casó «José A. Rodríguez»
            // con «José Dionisio BRITO RODRÍGUEZ», y con un apellido común el
            // tope de 20 podía dejar fuera al sancionado de verdad. Si Flujos y
            // RiskGuard cribaran distinto, la misma persona saldría limpia en uno
            // y señalada en el otro.
            const tiposPedidos = new Set(tiposLista.map(t => String(t).toUpperCase()));
            const buscarEnListas = async (nom: string | null, doc: string | null): Promise<any[]> => {
                const { data, error } = await rg.rpc('screening_candidatos', {
                    p_nombre: nom, p_documento: doc, p_umbral: UMBRAL_TRGM, p_limite: 200,
                });
                if (error) throw new Error(`RiskGuard screening: ${error.message}`);
                const hits: any[] = [];
                for (const c of (data ?? []) as CandidatoLista[]) {
                    // La RPC no filtra por lista; las que el nodo no pidió se descartan aquí.
                    if (!tiposPedidos.has(String(c.tipo_lista).toUpperCase())) continue;
                    let score: number;
                    let metodo: MetodoScreening;
                    if (c.doc_exacto) {
                        score = SCORE_DOCUMENTO;
                        metodo = 'documento';
                    } else {
                        if (!nom) continue;
                        score = Math.round(similitudNombres(nom, c.nombre) * 100);
                        metodo = 'nombre_fuzzy';
                        if (score < SCORE_MINIMO) continue;
                    }
                    // Mismos campos que antes (id, tipo_lista, nombre, documento, pais,
                    // motivo) para que las plantillas {{previous.hits.0.*}} sigan valiendo.
                    hits.push({
                        id: c.id, tipo_lista: c.tipo_lista, nombre: c.nombre, documento: c.documento,
                        pais: c.pais, motivo: c.motivo, tipo_entidad: c.tipo_entidad ?? null,
                        score, banda: bandaPorScore(score), metodo,
                    });
                }
                hits.sort((a, b) => b.score - a.score);
                return hits;
            };
            const mejorScore = (hits: any[]) => hits.reduce((m, h) => Math.max(m, h.score), 0);
            const nivelDe = (score: number) => {
                if (score === 0) return 'bajo';
                const banda = bandaPorScore(score);
                return banda === 'alta' ? 'alto' : banda === 'media' ? 'medio' : 'bajo';
            };

            // ── Modo lote: sin nombre fijo, revisa a cada asegurado del lote ──
            // Lo alimenta un nodo RiskGuard anterior ("Leer Siniestros" o "Alerta
            // Siniestro"). Un nombre escrito en el nodo manda sobre el lote.
            if (!nombre && !documento) {
                let siniestros: any[] | null = null;
                let loteIncompleto = false;
                const ids = Object.keys(context).filter(k => k !== '__lastNodeId');
                for (let i = ids.length - 1; i >= 0 && !siniestros; i--) {
                    const v = context[ids[i]];
                    if (v && typeof v === 'object' && Array.isArray(v.siniestros)) {
                        siniestros = v.siniestros;
                        loteIncompleto = v.limite_alcanzado === true;
                    }
                }
                if (!siniestros) {
                    throw new Error('El nodo Verificar OFAC necesita un nombre o documento, o ir después de un nodo que lea siniestros de RiskGuard para revisar a sus asegurados.');
                }

                const sinDatos: string[] = [];
                // Se agrupa por PERSONA, no por siniestro: una sola consulta por
                // persona y una sola fila en el correo, con sus siniestros al lado.
                // Hasta el 25/09/2026 las coincidencias iban por siniestro y el
                // correo repetía «José A. Rodríguez» siete veces.
                const personas = new Map<string, { nom: string | null; doc: string | null; siniestros: string[] }>();
                for (const s of siniestros) {
                    const doc = String(s.asegurado_documento ?? '').trim() || null;
                    const nom = String(s.asegurado_nombre ?? '').trim() || null;
                    // Sin nombre ni documento NO es "limpio": es "no se pudo revisar",
                    // y se devuelve aparte para que no se confunda con un negativo.
                    if (!doc && !nom) { sinDatos.push(s.numero_siniestro ?? s.id); continue; }
                    const k = `${doc ?? ''}|${(nom ?? '').toLowerCase()}`;
                    const p = personas.get(k) ?? { nom, doc, siniestros: [] };
                    p.siniestros.push(String(s.numero_siniestro ?? s.id));
                    personas.set(k, p);
                }

                // De diez en diez: con cientos de personas en serie el nodo rozaba
                // el límite de 150 s de la Edge Function.
                const lista = [...personas.values()];
                const coincidencias: any[] = [];
                for (let i = 0; i < lista.length; i += 10) {
                    const tanda = lista.slice(i, i + 10);
                    const resultados = await Promise.all(tanda.map(p => buscarEnListas(p.nom, p.doc)));
                    tanda.forEach((p, j) => {
                        if (resultados[j].length) coincidencias.push({
                            asegurado_nombre:    p.nom,
                            asegurado_documento: p.doc,
                            siniestros:          p.siniestros,
                            mejor_score:         mejorScore(resultados[j]),
                            hits:                resultados[j],
                        });
                    });
                }
                // La persona más comprometida primero.
                coincidencias.sort((a, b) => b.mejor_score - a.mejor_score);

                const enLista = coincidencias.length > 0;
                const score = coincidencias.reduce((m, c) => Math.max(m, c.mejor_score), 0);
                const siniestrosRevisados = siniestros.length - sinDatos.length;
                return {
                    en_lista:   enLista,
                    // Aplanado y con la persona al lado, para que las plantillas de
                    // aprobación y correo ({{previous.hits.0.tipo_lista}}) sigan valiendo.
                    hits:       coincidencias.flatMap(c => c.hits.map((h: any) => ({
                        ...h,
                        asegurado_nombre: c.asegurado_nombre,
                        numero_siniestro: c.siniestros.join(', '),
                    }))),
                    hit_count:  coincidencias.reduce((n, c) => n + c.hits.length, 0),
                    aml_score:  score,
                    nivel:      nivelDe(score),
                    fuente:     'riskguard',
                    criterio:   'screening RiskGuard',
                    modo:       'lote',
                    siniestros_revisados: siniestrosRevisados,
                    personas_revisadas:   lista.length,
                    personas_con_coincidencia: coincidencias.length,
                    coincidencias,
                    sin_verificar:        sinDatos,
                    // «Leer Siniestros» llegó a su tope: pudo quedar alguno sin leer.
                    lote_incompleto:      loteIncompleto,
                    nombre_buscado:    enLista ? coincidencias.map(c => c.asegurado_nombre ?? c.asegurado_documento).join(', ') : null,
                    documento_buscado: enLista ? coincidencias.map(c => c.asegurado_documento).filter(Boolean).join(', ') || null : null,
                    coincidencias_html: tablaCoincidenciasHtml(coincidencias, {
                        siniestrosRevisados, personasRevisadas: lista.length, sinVerificar: sinDatos, loteIncompleto,
                    }),
                    timestamp:  new Date().toISOString(),
                };
            }

            const hits = await buscarEnListas(nombre, documento);
            const enLista = hits.length > 0;
            const amlScore = mejorScore(hits);
            const coincidencias = enLista
                ? [{ asegurado_nombre: nombre, asegurado_documento: documento, siniestros: [], mejor_score: amlScore, hits }]
                : [];

            return {
                en_lista:   enLista,
                hits,
                hit_count:  hits.length,
                aml_score:  amlScore,
                nivel:      nivelDe(amlScore),
                fuente:     'riskguard',
                criterio:   'screening RiskGuard',
                nombre_buscado:    nombre ?? null,
                documento_buscado: documento ?? null,
                coincidencias_html: tablaCoincidenciasHtml(coincidencias, {
                    siniestrosRevisados: null, personasRevisadas: 1, sinVerificar: [], loteIncompleto: false,
                }),
                timestamp:  new Date().toISOString(),
            };
        }

        // ── Indicadores de Gestión ────────────────────────────────────────
        // Schema real: indicadores_definicion + indicadores_valores + alertas
        case 'trigger:indicadores':
        case 'processor:indicadores': {
            const IND_URL = Deno.env.get('INDICADORES_SUPABASE_URL');
            const IND_KEY = Deno.env.get('INDICADORES_SERVICE_ROLE_KEY');
            if (!IND_URL || !IND_KEY) {
                return { skipped: true, reason: 'INDICADORES_SUPABASE_URL o INDICADORES_SERVICE_ROLE_KEY no configurados' };
            }
            const ind = createClient(IND_URL, IND_KEY);

            // Leer valores más recientes con datos del indicador
            let valQuery = ind
                .from('indicadores_valores')
                .select('id,valor_real,valor_meta,porcentaje_cumplimiento,estado,desviacion,indicador_id,indicadores_definicion(nombre,umbral_rojo,umbral_amarillo,activo)')
                .order('created_at', { ascending: false })
                .limit(Number(cfg.limit ?? 50));

            const { data: valores, error: valErr } = await valQuery;
            if (valErr) throw new Error(`Indicadores: ${valErr.message}`);

            const list = valores ?? [];

            // Contar por estado (el campo estado en indicadores_valores puede ser: critico, en_riesgo, logrado, en_progreso u otros)
            const critical_count = list.filter((v: any) => ['critico','critical','rojo'].includes(String(v.estado).toLowerCase())).length;
            const at_risk_count  = list.filter((v: any) => ['en_riesgo','at_risk','amarillo'].includes(String(v.estado).toLowerCase())).length;
            const achieved_count = list.filter((v: any) => ['logrado','achieved','verde','cumplido'].includes(String(v.estado).toLowerCase())).length;

            // Alertas no reconocidas
            const { data: alertas } = await ind
                .from('alertas')
                .select('titulo,severidad,mensaje,created_at')
                .eq('reconocida', false)
                .order('created_at', { ascending: false })
                .limit(10);

            const alertas_criticas = (alertas ?? []).filter((a: any) => ['critica','critical','alta'].includes(String(a.severidad).toLowerCase())).length;

            // Si es trigger, evaluar condición de disparo
            if (node.type === 'trigger') {
                const triggerOn = (cfg.trigger_on ?? 'critical') as string;
                const shouldFire =
                    triggerOn === 'any'     ? true :
                    triggerOn === 'critical' ? (critical_count + alertas_criticas) > 0 :
                    triggerOn === 'at_risk'  ? at_risk_count > 0 :
                    (critical_count + at_risk_count + alertas_criticas) > 0;
                if (!shouldFire) {
                    return { skipped: true, reason: `Sin indicadores críticos — flujo no disparado` };
                }
            }

            return {
                indicadores:      list,
                count:            list.length,
                critical_count,
                at_risk_count,
                achieved_count,
                alertas_activas:  alertas ?? [],
                alertas_criticas,
                timestamp:        new Date().toISOString(),
            };
        }

        // ── Semáforo de gestión ───────────────────────────────────────────
        case 'processor:semaforo': {
            const raw           = resolveValue(cfg.value ?? '0', context);
            const value         = Number(raw) || 0;
            const umbral_rojo   = Number(cfg.umbral_rojo   ?? 3);
            const umbral_amarillo = Number(cfg.umbral_amarillo ?? 1);

            const color = value >= umbral_rojo
                ? 'rojo'
                : value >= umbral_amarillo
                ? 'amarillo'
                : 'verde';

            const label = color === 'rojo'
                ? `🔴 CRÍTICO — ${value} indicadores requieren atención inmediata`
                : color === 'amarillo'
                ? `🟡 ADVERTENCIA — ${value} indicadores en riesgo`
                : `🟢 NORMAL — todos los indicadores dentro de parámetros`;

            return { color, label, value, umbral_rojo, umbral_amarillo };
        }

        // ── Estados Financieros ───────────────────────────────────────────
        // Schema real: companies (id, name, currency, industry),
        //              financial_periods (company_id, period_name, is_closed),
        //              financial_entries (company_id, period_id, account_code,
        //                                 account_name, balance_amount)
        //
        // ⚠️ Este comentario decía `income_statement_entries`, tabla que el código
        // no lee ni ha leído nunca: los dos pipelines de abajo salen de
        // `financial_entries`, que es la forma de un balance de comprobación.
        // Corregido el 15/08/2026. Es la misma clase de dato inventado que las
        // siete carpetas de Edge Functions vacías del árbol de CLAUDE.md §4.
        //
        // ⚠️ El PLAN DE CUENTAS lo decide `_shared/modelosFinancieros.ts`, no
        // este fichero. Hasta el 15/08/2026 la aritmética de SUDEASEG estaba
        // cableada aquí —grupo 2 = Activos, grupo 5 = Ingresos— y el nodo ni
        // siquiera leía `companies.industry`. Apuntado a una empresa industrial
        // devolvía el pasivo como activo y los costos como ingresos, con formato
        // de miles y porcentaje de margen incluidos. Ver SECTOR_ALIMENTOS.md §3.
        case 'processor:eeff': {
            const EEFF_URL = Deno.env.get('EEFF_SUPABASE_URL');
            const EEFF_KEY = Deno.env.get('EEFF_SERVICE_ROLE_KEY');
            if (!EEFF_URL || !EEFF_KEY) {
                return { skipped: true, reason: 'EEFF_SUPABASE_URL o EEFF_SERVICE_ROLE_KEY no configurados' };
            }
            const eeff      = createClient(EEFF_URL, EEFF_KEY);
            const queryType = cfg.query_type ?? 'summary';
            const ts        = new Date().toISOString();

            // Un `{ error }` sin leer deja `data` en null, y un null se lee como
            // «no hay»: una clave caducada o un proyecto caído acababan en
            // «Empresa no encontrada», que manda a buscar el fallo al sitio
            // equivocado. El `hint` va incluido porque es el que distingue una
            // clave mala de una clave de OTRO proyecto (§8.1).
            const fallaEeff = (que: string, e: { message: string; hint?: string | null }) =>
                new Error(`No se pudo leer ${que} de EE.FF.: ${e.message}${e.hint ? ` — ${e.hint}` : ''}`);

            // ── Modo "all": resumen de todas las empresas y períodos ──────
            if (queryType === 'all') {
                const { data: companies, error: coErr } = await eeff
                    .from('companies')
                    .select('id, name, currency, industry')
                    .eq('is_active', true);
                if (coErr) throw fallaEeff('las empresas', coErr);

                const lineas: string[] = [];
                for (const co of companies ?? []) {
                    const { data: periodos, error: peErr } = await eeff
                        .from('financial_periods')
                        .select('period_name, is_closed')
                        .eq('company_id', co.id)
                        .order('start_date', { ascending: false })
                        .limit(5);
                    if (peErr) throw fallaEeff(`los períodos de ${co.name}`, peErr);
                    const pList = (periodos ?? [])
                        .map((p: any) => `${p.period_name} (${p.is_closed ? 'cerrado' : 'abierto'})`)
                        .join(' | ');
                    // El modo "all" es el de diagnóstico: si una empresa no tiene
                    // plan de cuentas reconocible, aquí es donde se ve, y no
                    // cuando el cierre mensual reviente a las 8 de la mañana.
                    const m = resolverModelo(cfg.tipo_empresa, (co as any).industry, co.name);
                    const plan = m.ok ? m.modelo.nombre : '⚠ plan de cuentas sin determinar';
                    lineas.push(`${co.name} [${co.currency} · ${plan}]: ${pList || 'sin períodos'}`);
                }
                return {
                    total_empresas: (companies ?? []).length,
                    resumen:        lineas.join(' ── '),
                    detalle_linea1: lineas[0] ?? '—',
                    detalle_linea2: lineas[1] ?? '—',
                    detalle_linea3: lineas[2] ?? '—',
                    timestamp:      ts,
                };
            }

            // ── Buscar empresa por nombre (parcial) ───────────────────────
            // Los espacios no cuentan: "Hierro Fuerte" busca `%Hierro%Fuerte%`,
            // que casa con "HierroFuerte, C.A.". Se escapan `%`, `_` y `\`
            // para que lo que se teclea se busque literal.
            const palabras = (cfg.company ?? '').trim().split(/\s+/).filter(Boolean)
                .map((p: string) => p.replace(/[\\%_]/g, c => `\\${c}`));
            let companyQuery = eeff.from('companies').select('id, name, currency, industry').eq('is_active', true);
            if (palabras.length) {
                companyQuery = companyQuery.ilike('name', `%${palabras.join('%')}%`);
            }
            const { data: candidatas, error: coErr } = await companyQuery.order('name').limit(10);
            if (coErr) throw fallaEeff('las empresas', coErr);

            // Varias coincidencias ya no se resuelven quedándose con la primera:
            // eso sería leer los estados financieros de otra empresa sin avisar.
            // Solo se desempata si una casa entera sin espacios ni puntuación.
            const plano = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, '');
            let company = candidatas?.length === 1 ? candidatas[0] : undefined;
            if (!company && (candidatas?.length ?? 0) > 1) {
                const exactas = candidatas!.filter((c: { name: string }) => plano(c.name) === plano(cfg.company ?? ''));
                if (exactas.length === 1) company = exactas[0];
                else throw new Error(
                    `"${cfg.company}" coincide con varias empresas de EE.FF. (${candidatas!.map((c: { name: string }) => c.name).join(', ')}). ` +
                    `Escribe el nombre más completo en el nodo.`);
            }
            if (!company) {
                return { skipped: true, reason: `Empresa "${cfg.company}" no encontrada en EE.FF. (se busca entre las empresas activas)` };
            }

            // ── Con qué plan de cuentas se lee esta empresa ───────────────
            // Manda el nodo; si va en blanco, decide `companies.industry`; y si
            // no hay nada que case, ESTO REVIENTA. No hay modelo por defecto y
            // no puede haberlo: los dos planes son incompatibles, así que
            // elegir uno a ciegas no da un número aproximado, da el pasivo
            // puesto donde va el activo. Misma doctrina que la matriz de
            // aprobación (§6.5) y que la huella `NULL` (§9.5).
            const resModelo = resolverModelo(cfg.tipo_empresa, (company as any).industry, company.name);
            if (!resModelo.ok) throw new Error(resModelo.motivo);
            const modelo = resModelo.modelo;

            // ── Obtener período ───────────────────────────────────────────
            let periodQuery = eeff
                .from('financial_periods')
                .select('id, period_name, start_date, end_date, is_closed')
                .eq('company_id', company.id)
                .order('start_date', { ascending: false });

            const MES_NUM: Record<string,string> = {
                enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',
                julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12',
            };
            if (cfg.periodo?.trim()) {
                const periodoLower = cfg.periodo.trim().toLowerCase();
                // Extraer mes: acepta "Enero", "Enero 2025", "enero", etc.
                const primeraPalabra = periodoLower.split(/\s+/)[0];
                const mesNum = MES_NUM[periodoLower] ?? MES_NUM[primeraPalabra];
                // Extraer año si viene en el campo (ej: "Enero 2025" → año = "2025")
                const añoMatch = cfg.periodo.trim().match(/\b(20\d{2})\b/);
                const año = añoMatch ? añoMatch[1] : null;
                if (mesNum) {
                    // Buscar por número de mes y opcionalmente año en el period_name
                    // Ej: "Enero 2025" → busca "01/01/2025"; "Enero" → busca "01/01/"
                    const patron = año ? `%01/${mesNum}/${año}%` : `%01/${mesNum}/%`;
                    periodQuery = periodQuery.ilike('period_name', patron);
                } else {
                    periodQuery = periodQuery.ilike('period_name', `%${cfg.periodo.trim()}%`);
                }
            } else {
                periodQuery = periodQuery.eq('is_closed', false);
            }
            const { data: periods, error: peErr } = await periodQuery.limit(1);
            if (peErr) throw fallaEeff('los períodos', peErr);
            let period = periods?.[0];

            if (!period) {
                // Intentar con el período más reciente sin importar estado
                const { data: anyPeriod, error: anyErr } = await eeff
                    .from('financial_periods')
                    .select('id, period_name, start_date, end_date, is_closed')
                    .eq('company_id', company.id)
                    .order('start_date', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (anyErr) throw fallaEeff('los períodos', anyErr);
                if (!anyPeriod) return { empresa: company.name, periodo: 'Sin períodos cargados', timestamp: ts };
                period = anyPeriod;
            }

            // ── Intentar leer tabla de resumen balance_sheet primero ─────
            // balance_sheet no se usa en InsuranceModel — se lee directamente de financial_entries


            // ── Leer financial_entries ordenando por id DESC para tomar último balance ──
            const { data: entries, error: entErr } = await eeff
                .from('financial_entries')
                .select('*')
                .eq('company_id', company.id)
                .eq('period_id', (period as any)?.id ?? '')
                .order('id', { ascending: false })
                .limit(5000);

            if (entErr) throw new Error(`EE.FF. entries: ${entErr.message}`);

            // ══════════════════════════════════════════════════════════════
            // PIPELINE DEL BALANCE — es el MISMO para los dos modelos
            //
            // Lo que cambia entre seguros e industrial es solo la última línea:
            // a qué cubo va cada cuenta hoja. Todo lo de antes —dedup,
            // consolidación con signo, exclusión de totales, filtro de hojas— es
            // aritmética sobre un balance de comprobación y no depende del plan
            // de cuentas. Por eso el modelo se inyecta al final y este pipeline
            // NO se tocó al conectarlo: sigue siendo el que cuadró al céntimo
            // contra SQL el 10/06/2026.
            //
            // En seguros, el sistema EE.FF. importa dos fuentes para el mismo período:
            //   - SUDEASEG/dot  (2.xxx)  → Activos del Balance General
            //   - Profit Plus/dash (3xx-, 4xx-, 5xx-) → Gastos, Pasivos/Patrimonio, Ingresos
            //
            // Además de la clasificación por prefijo, aplica (validado vs SQL 10/06/2026,
            // réplica de extractBalanceSheetData de DataContext.tsx):
            //   0. DEDUP: filas idénticas (código+valor+nombre) se cuentan una sola vez
            //      (financial_entries tiene duplicados exactos del doble import)
            //   1. Consolidar por account_code: SUM CON SIGNO (no abs)
            //   2. Excluir cuentas cuyo nombre contiene 'total'/'resumen'/'sub-total'
            //   3. Filtrar cuentas HOJA: si un código tiene hijos con |saldo| > 0.01, se omite
            //   4. El modelo clasifica cada hoja. El signo llega intacto hasta ahí
            //      a propósito: el modelo industrial lo NECESITA (una depreciación
            //      acumulada resta del activo), y el de seguros lo descarta él.
            // ══════════════════════════════════════════════════════════════

            // Paso 0+1 — Dedup de filas idénticas y consolidación CON SIGNO por account_code
            const consolidated = new Map<string, { balance: number; name: string; esTotal: boolean }>();
            const seenRows = new Set<string>();
            for (const e of (entries ?? []) as any[]) {
                const code = String(e.account_code ?? '').trim();
                if (!code) continue;
                const bal  = Number(e.balance_amount ?? 0);
                if (bal === 0) continue;
                const name = String(e.account_name ?? '');
                const hash = `${code}|${bal.toFixed(2)}|${name}`;
                if (seenRows.has(hash)) continue; // duplicado exacto — ignorar
                seenRows.add(hash);
                const lname   = name.toLowerCase();
                const esTotal = lname.includes('total') || lname.includes('resumen') || lname.includes('sub-total');
                if (consolidated.has(code)) {
                    const cur = consolidated.get(code)!;
                    cur.balance += bal;
                    cur.esTotal = cur.esTotal || esTotal;
                } else {
                    consolidated.set(code, { balance: bal, name, esTotal });
                }
            }

            // Paso 2 — Leaf filtering: cleanCode = quitar todos los no-alfanuméricos
            // Si un código tiene hijos activos (children_sum > 0.01), se omite (es padre).
            const cleanFn = (c: string) => c.replace(/[^a-zA-Z0-9]/g, '');
            const allCleans = new Map<string, string>(); // code → cleanCode
            for (const [code] of consolidated) allCleans.set(code, cleanFn(code));

            const leafItems = new Map<string, number>(); // code → balance CON SIGNO
            for (const [code, { balance, esTotal }] of consolidated) {
                if (esTotal) continue; // totales explícitos por nombre — redundantes
                const cc = allCleans.get(code)!;
                // Suma de |saldo| de hijos directos y transitivos
                let childrenSum = 0;
                for (const [otherCode, otherClean] of allCleans) {
                    if (otherCode === code) continue;
                    if (otherClean.startsWith(cc) && otherClean.length > cc.length) {
                        childrenSum += Math.abs(consolidated.get(otherCode)!.balance);
                    }
                }
                // Strict leaf filter: excluir si tiene hijos con saldo significativo
                if (childrenSum <= 0.01 && Math.abs(balance) > 0.01) {
                    leafItems.set(code, balance);
                }
            }

            // Paso 3 — el MODELO clasifica cada hoja. Aquí ya no hay ni un
            // prefijo de cuentas escrito: los que había eran los de SUDEASEG.
            const saldosB = saldosBalanceVacios();
            for (const [code, balance] of leafItems) {
                modelo.clasificarBalance(code, consolidated.get(code)?.name ?? '', balance, saldosB);
            }

            // ══════════════════════════════════════════════════════════════
            // MOTOR P&L — pipeline DISTINTO al del balance, y también común a
            // los dos modelos (validado vs SQL 10/06/2026, reproduce
            // ingresos/costo/utilidad del sistema EE.FF. al céntimo):
            //   - SIN dedup; consolidación CON SIGNO por código
            //   - Excluye códigos terminados en '-' (totalizadores Profit Plus)
            //   - Filtro de hoja ESTRICTO: si un código tiene descendientes con
            //     saldo, es un padre y no se cuenta. El MISMO criterio que el
            //     balance de arriba, a propósito (ver la nota de abajo).
            //   - La clasificación por grupo la pone el modelo, no este bloque.
            // ══════════════════════════════════════════════════════════════
            const consolidatedPL = new Map<string, { val: number; name: string }>();
            for (const e of (entries ?? []) as any[]) {
                const code = String(e.account_code ?? '').trim();
                if (!code || code === '0') continue;
                const val = Number(e.balance_amount ?? 0);
                if (consolidatedPL.has(code)) {
                    consolidatedPL.get(code)!.val += val;
                } else {
                    consolidatedPL.set(code, { val, name: String(e.account_name ?? '') });
                }
            }
            const plCleans = new Map<string, string>();
            for (const [code] of consolidatedPL) plCleans.set(code, cleanFn(code));

            const saldosR = saldosResultadoVacios();
            for (const [code, { val, name }] of consolidatedPL) {
                if (code.endsWith('-')) continue;
                if (Math.abs(val) <= 0.01) continue;
                const cc = plCleans.get(code)!;
                let childrenSum = 0;
                for (const [otherCode, otherClean] of plCleans) {
                    if (otherCode === code) continue;
                    if (otherClean.startsWith(cc) && otherClean.length > cc.length) {
                        childrenSum += Math.abs(consolidatedPL.get(otherCode)!.val);
                    }
                }
                // ⚠️ Aquí había la regla del 80% —«es padre solo si sus hijos
                // suman más del 80% de su saldo»— copiada del sistema EE.FF.
                // (`DataContext.tsx`, motor de resultados). Es una heurística, y
                // en un plan real falla: HierroFuerte tiene `5.3.03 Gastos
                // Generales` = 406.618,94 con hijos que suman 255.878,59, o sea
                // el 62,9%. La regla concluía «no es un totalizador» y contaba
                // el padre Y los hijos.
                //
                // Que el padre SÍ es un rollup no es una opinión: con filtro
                // estricto el balance de comprobación de HierroFuerte suma
                // exactamente 0,00 (grupos 1+2+3+4+5) y la utilidad sale
                // +109.273,86, que es justo Activo − Pasivo − Patrimonio. Con la
                // regla del 80% salía una PÉRDIDA de 297.345,08. Un rollup mal
                // sumado en el origen no deja de ser un rollup.
                //
                // Medido el 15/08/2026 sobre las tres empresas de EE.FF.: en los
                // grupos 3, 4 y 5 las dos reglas dan un resultado IDÉNTICO para
                // las dos aseguradoras (ningún padre se colaba), así que esto no
                // mueve ni un céntimo de las cifras de seguros que cuadraron el
                // 10/06/2026. Solo corrige el plan industrial.
                //
                // Y ahora hay UNA sola definición de «hoja» en el fichero, no
                // dos que podían contestar cosas distintas a la misma pregunta.
                if (childrenSum > 0.01) continue; // es un padre

                modelo.clasificarResultado(code, name, val, saldosR);
            }

            const ingresos         = saldosR.ingresos;
            const costoVentas      = saldosR.costo_ventas;
            const gastosOperativos = saldosR.gastos_operativos;
            // Los financieros solo los separa el modelo industrial (grupos 7-8);
            // en seguros vienen en 0 y la suma queda igual que antes.
            const gastos   = costoVentas + gastosOperativos + saldosR.gastos_financieros;
            const utilidad = ingresos - gastos;

            let activos = saldosB.activos;
            const pasivos = saldosB.pasivos, patrimonio = saldosB.patrimonio;
            // Cuadrar el activo desde pasivo+patrimonio es un parche de la doble
            // importación de seguros, y solo vale ahí: en un balance de
            // comprobación industrial las tres cifras salen del mismo fichero,
            // así que un activo en cero es un dato que falta, y taparlo con la
            // suma del pasivo fabrica un número que nadie midió.
            if (modelo.rellenarActivosDesdePasivos && activos === 0 && (pasivos + patrimonio) > 0) {
                activos = pasivos + patrimonio;
            }

            // ── Conversión de moneda ───────────────────────────────────────
            const monedaReporte  = (cfg.moneda_reporte ?? '').toUpperCase() || company.currency;
            const tasaConversion = Number(cfg.tasa_conversion ?? 0);
            const convertir = (n: number) =>
                monedaReporte !== company.currency && tasaConversion > 0 ? n / tasaConversion : n;

            if (queryType === 'variacion') {
                const { data: prevPeriods } = await eeff
                    .from('financial_periods')
                    .select('id, period_name, start_date')
                    .eq('company_id', company.id)
                    .order('start_date', { ascending: false })
                    .limit(2);
                return {
                    empresa:          company.name,
                    moneda:           monedaReporte,
                    plan_cuentas:     modelo.nombre,
                    periodo_actual:   prevPeriods?.[0]?.period_name ?? '—',
                    periodo_anterior: prevPeriods?.[1]?.period_name ?? '—',
                    ingresos_total:   convertir(ingresos).toFixed(2),
                    gastos_total:     convertir(gastos).toFixed(2),
                    utilidad_neta:    convertir(utilidad).toFixed(2),
                    timestamp:        ts,
                };
            }

            const fmt = (n: number) => convertir(n).toLocaleString('es-VE', { minimumFractionDigits: 2 });

            // Períodos disponibles para diagnóstico
            const { data: allPeriods } = await eeff
                .from('financial_periods')
                .select('period_name, start_date, is_closed')
                .eq('company_id', company.id)
                .order('start_date', { ascending: false })
                .limit(12);
            const periodosDisponibles = (allPeriods ?? [])
                .map((p: any) => `${p.period_name} (${p.is_closed ? 'cerrado' : 'abierto'})`)
                .join(' | ');

            // El detalle del activo y los KPIs solo los produce el modelo
            // industrial. En seguros salen todos en 0, y añadirlos llenaría de
            // ceros el correo del nodo Reporte Gerencial, que vuelca TODAS las
            // claves del contexto (`buildContextSummary`). Un cero que no se ha
            // medido se lee igual que un cero medido.
            const detalle = modelo.id === 'industrial' ? {
                efectivo:              fmt(saldosB.efectivo),
                cuentas_por_cobrar:    fmt(saldosB.cuentas_por_cobrar),
                inventario:            fmt(saldosB.inventario),
                inventario_concepto:   modelo.etiquetaInventario,
                activo_fijo:           fmt(saldosB.activo_fijo),
                cuentas_por_pagar:     fmt(saldosB.cuentas_por_pagar),
                gastos_financieros:    fmt(saldosR.gastos_financieros),
                utilidad_bruta:        fmt(ingresos - costoVentas),
            } : {};

            // Cada KPI entra además con su `id` como clave y su valor SIN
            // formatear, para que un `processor:decision` pueda comparar
            // `{{previous.margen_bruto}}` contra un número. Formateado con
            // separador de millares no compararía nada.
            const kpis = modelo.kpis(saldosB, saldosR);
            const kpisPlanos = Object.fromEntries(kpis.map(k => [k.id, k.valor.toFixed(2)]));

            return {
                empresa:               company.name,
                moneda:                monedaReporte,
                periodo:               (period as any)?.period_name ?? '—',
                periodo_estado:        (period as any)?.is_closed ? 'Cerrado' : 'Abierto',
                plan_cuentas:          modelo.nombre,
                plan_cuentas_origen:   resModelo.origen === 'nodo'
                    ? 'configurado en el nodo'
                    : `industria de la empresa en EE.FF. (${(company as any).industry ?? '—'})`,
                activos:               fmt(activos),
                pasivos:               fmt(pasivos),
                patrimonio:            fmt(patrimonio),
                ...detalle,
                ingresos:              fmt(ingresos),
                costo_ventas:          fmt(costoVentas),
                gastos_admin:          fmt(gastosOperativos),
                gastos:                fmt(gastos),
                utilidad_neta:         fmt(utilidad),
                margen_pct:            ingresos > 0 ? ((utilidad / ingresos) * 100).toFixed(1) + '%' : '0%',
                ...kpisPlanos,
                indicadores:           kpis.length
                    ? kpis.map(k => `${k.etiqueta}: ${k.valor.toFixed(1)}${k.unidad === 'porcentaje' ? '%' : ''} — ${k.comentario}`).join(' · ')
                    : 'sin indicadores para este plan de cuentas',
                periodos_disponibles:  periodosDisponibles,
                timestamp:             ts,
            };
        }

        // ── Reporte Gerencial (email formateado) ──────────────────────────
        case 'processor:reporte':
        case 'output:reporte': {
            if (canalEmail() === 'ninguno') throw new Error('Sin canal de correo configurado');
            const to      = resolveValue(cfg.to ?? '', context);
            const subject = resolveValue(cfg.subject ?? '📊 Reporte Gerencial — HermesAI Flow', context);
            let   body    = resolveValue(cfg.body ?? '', context);
            if (!to) throw new Error('Nodo Reporte Gerencial: campo "to" requerido');

            if (!body?.trim()) {
                body = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff">
  <div style="background:linear-gradient(135deg,#1e1b4b,#4f46e5);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px">📊 Reporte de Gestión</h1>
    <p style="color:#a5b4fc;margin:8px 0 0;font-size:13px">Informe ejecutivo generado automáticamente · ${fechaVE(new Date())}</p>
  </div>
  <div style="padding:28px 24px;background:#f8fafc">
    ${buildContextSummary(context)}
    <p style="color:#9ca3af;font-size:11px;margin-top:20px;text-align:center">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`;
            }

            const emailId = await enviar(to, subject, body, cfg.from);
            return { sent: true, email_id: emailId, to, subject };
        }

        // ── Nodo no implementado ──────────────────────────────────────────
        // ── Agente IA (Claude) ────────────────────────────────────────────
        case 'processor:agente': {
            const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
            if (!ANTHROPIC_KEY) {
                return { skipped: true, reason: 'ANTHROPIC_API_KEY no configurado en Supabase Secrets' };
            }

            const modo          = cfg.modo           ?? 'analisis';
            const modelo        = cfg.modelo         ?? 'claude-sonnet-4-6';
            const campoResult   = cfg.campo_resultado ?? 'analisis_ia';
            const condicionSi   = (cfg.condicion_si  ?? 'aprobar').toLowerCase().trim();
            const systemPrompt  = cfg.system_prompt  ?? 'Eres un analista experto en seguros, reaseguros y cumplimiento normativo venezolano (SUDEASEG, SUDEBAN, OFAC).';
            const rawPrompt     = cfg.prompt ?? 'Analiza los datos disponibles y proporciona un análisis ejecutivo detallado.';
            const userPrompt    = resolveValue(rawPrompt, context);

            // Inyectar contexto del flujo si el prompt no usa {{previous.*}} explícitamente
            const OMITIR_AI = new Set(['branch','evaluated','skipped','triggered','modelo','tokens_input','tokens_output']);
            let contextBlock = '';
            if (!rawPrompt.includes('{{previous.')) {
                const lines: string[] = [];
                for (const nodeData of Object.values(context)) {
                    if (!nodeData || typeof nodeData !== 'object') continue;
                    for (const [k, v] of Object.entries(nodeData as Record<string, any>)) {
                        if (OMITIR_AI.has(k) || v === null || v === undefined || v === '') continue;
                        const display = typeof v === 'object' ? JSON.stringify(v) : String(v);
                        lines.push(`- ${k}: ${display}`);
                    }
                }
                if (lines.length) contextBlock = `## Datos del Flujo\n${lines.join('\n')}\n\n## Tu tarea\n`;
            }

            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key':         ANTHROPIC_KEY,
                    'anthropic-version': '2023-06-01',
                    'content-type':      'application/json',
                },
                body: JSON.stringify({
                    model:      modelo,
                    max_tokens: cfg.max_tokens ?? 8192,
                    system:     systemPrompt,
                    messages:   [{ role: 'user', content: contextBlock + userPrompt }],
                }),
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Anthropic API error: ${txt}`);
            }

            const data       = await res.json();

            // Una respuesta cortada por el límite de tokens NO es un informe:
            // es medio informe con el HTML sin cerrar. El 23/09/2026 el de
            // EE.FF. llegó al correo terminado en una viñeta vacía (4096 de
            // 4096 tokens) y parecía completo. Se detiene aquí, antes de que
            // un nodo posterior lo envíe como si estuviera entero.
            if (data?.stop_reason === 'max_tokens') {
                throw new Error(
                    `El Agente IA se quedó sin espacio y su respuesta salió cortada ` +
                    `(${data?.usage?.output_tokens ?? '?'} tokens). No se envía un informe a medias: ` +
                    `pide en el prompt un texto más breve o sube el límite de tokens del nodo.`
                );
            }

            const respuesta  = data?.content?.[0]?.text ?? '';
            const inputTokens  = data?.usage?.input_tokens  ?? 0;
            const outputTokens = data?.usage?.output_tokens ?? 0;

            const resultado: Record<string, any> = {
                [campoResult]: respuesta,
                modelo,
                tokens_input:  inputTokens,
                tokens_output: outputTokens,
                timestamp:     new Date().toISOString(),
            };

            if (modo === 'decision') {
                const decisionSi = respuesta.toLowerCase().includes(condicionSi);
                resultado.branch      = decisionSi ? 'true' : 'false';
                resultado.decision    = decisionSi ? 'SI' : 'NO';
                resultado.condicion_evaluada = condicionSi;
            }

            return resultado;
        }

        // ── Reporte Regulatorio (SUDEASEG / SUDEBAN) ──────────────────────
        case 'processor:regulatorio': {
            const tipo       = cfg.tipo       ?? 'SUDEASEG';
            const periodo    = resolveValue(cfg.periodo    ?? '', context) || fechaVE(new Date(), { month: 'long', year: 'numeric' });
            const empresa    = cfg.empresa    ?? 'Entidad no especificada';
            const referencia = resolveValue(cfg.referencia ?? '', context);
            const fechaHora  = fechaHoraVE(new Date());

            const OMITIR_REP = new Set(['branch','evaluated','skipped','triggered','timestamp','fuente','generado_por','modelo','tokens_input','tokens_output']);

            // Consolidar deduplicando — el último valor de cada campo gana
            const consolidated: Record<string, any> = {};
            for (const [, nodeData] of Object.entries(context)) {
                if (!nodeData || typeof nodeData !== 'object') continue;
                for (const [k, v] of Object.entries(nodeData as Record<string, any>)) {
                    if (OMITIR_REP.has(k) || v === null || v === undefined || v === '') continue;
                    consolidated[k] = v;
                }
            }

            // Construir filas HTML
            const colorHeader  = tipo === 'SUDEASEG' ? '#7c3aed' : '#0369a1';
            const enLista      = consolidated['en_lista'];
            const alertaBanner = enLista === true
                ? `<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;margin-bottom:20px;border-radius:0 8px 8px 0">
                     <p style="margin:0;color:#991b1b;font-weight:700;font-size:14px">⚠️ ALERTA — Sujeto identificado en listas restrictivas internacionales</p>
                   </div>`
                : `<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;margin-bottom:20px;border-radius:0 8px 8px 0">
                     <p style="margin:0;color:#166534;font-weight:700;font-size:14px">✅ Sin coincidencias en listas restrictivas</p>
                   </div>`;

            let filas = '';
            let bg = false;
            for (const [k, v] of Object.entries(consolidated)) {
                if (k === 'hits') continue; // se renderiza aparte
                const label   = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

                // Dos de estas ramas son HTML a propósito (el Sí/No en color y
                // el nivel de riesgo) y las otras dos son dato que viene de los
                // sistemas conectados. Se escapa el dato y se deja la etiqueta:
                // escapar en bloque teñiría de gris los semáforos del informe.
                let display   = typeof v === 'boolean' ? (v ? '<span style="color:#dc2626;font-weight:700">Sí</span>' : '<span style="color:#16a34a;font-weight:700">No</span>')
                              : Array.isArray(v)        ? `${v.length} registros`
                              : k.endsWith('_html')     ? String(v)   // HTML del propio motor, ver buildContextSummary
                              : typeof v === 'object'   ? escaparHtml(JSON.stringify(v))
                              : escaparHtml(v);
                if (k === 'nivel') {
                    const c = v === 'alto' ? '#dc2626' : v === 'medio' ? '#d97706' : '#16a34a';
                    display = `<span style="color:${c};font-weight:700;text-transform:uppercase">${escaparHtml(v)}</span>`;
                }
                filas += `<tr style="background:${bg ? '#f9fafb' : '#fff'}">
                    <td style="padding:9px 16px;color:#6b7280;font-size:12px;width:42%;border-bottom:1px solid #f3f4f6">${escaparHtml(label)}</td>
                    <td style="padding:9px 16px;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #f3f4f6">${display}</td>
                </tr>`;
                bg = !bg;
            }

            // Tabla de hits
            let hitsHtml = '';
            const hits = consolidated['hits'];
            if (Array.isArray(hits) && hits.length > 0) {
                const hitRows = hits.map((h: any) =>
                    `<tr>
                        <td style="padding:8px 12px;font-size:12px;color:#111827;border-bottom:1px solid #fee2e2">${escaparHtml(h.tipo_lista ?? '—')}</td>
                        <td style="padding:8px 12px;font-size:12px;color:#111827;border-bottom:1px solid #fee2e2;font-weight:600">${escaparHtml(h.nombre ?? '—')}</td>
                        <td style="padding:8px 12px;font-size:11px;color:#6b7280;border-bottom:1px solid #fee2e2">${escaparHtml(h.motivo ?? '—')}</td>
                    </tr>`
                ).join('');
                hitsHtml = `
                <h3 style="color:#991b1b;font-size:14px;margin:24px 0 8px">Coincidencias en Listas Restrictivas (${hits.length})</h3>
                <table style="width:100%;border-collapse:collapse;background:#fff8f8;border:1px solid #fecaca;border-radius:8px;overflow:hidden">
                    <thead>
                        <tr style="background:#fee2e2">
                            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#991b1b;text-transform:uppercase">Lista</th>
                            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#991b1b;text-transform:uppercase">Nombre</th>
                            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#991b1b;text-transform:uppercase">Motivo</th>
                        </tr>
                    </thead>
                    <tbody>${hitRows}</tbody>
                </table>`;
            }

            const reporte_html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
  <div style="background:linear-gradient(135deg,${colorHeader},#1e3a5f);padding:28px 24px">
    <p style="margin:0 0 4px;color:rgba(255,255,255,0.7);font-size:11px;text-transform:uppercase;letter-spacing:1px">${escaparHtml(tipo)} — INFORME REGULATORIO</p>
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">${escaparHtml(empresa)}</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:13px">Período: ${escaparHtml(periodo)} &nbsp;·&nbsp; Emitido: ${escaparHtml(fechaHora)}</p>
    ${referencia ? `<p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:12px">Referencia: ${escaparHtml(referencia)}</p>` : ''}
  </div>
  <div style="padding:24px">
    ${alertaBanner}
    <h3 style="color:#374151;font-size:14px;margin:0 0 8px">Datos del Caso</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">${filas}</table>
    ${hitsHtml}
    <p style="color:#9ca3af;font-size:11px;margin-top:24px;text-align:center;border-top:1px solid #f3f4f6;padding-top:16px">
      Generado automáticamente por <strong>HermesAI Flow</strong> · ${fechaHora}
    </p>
  </div>
</div>`;

            return {
                reporte_html,
                tipo_reporte:    tipo,
                periodo,
                empresa,
                referencia_caso: referencia || 'N/A',
                fecha_emision:   fechaHora,
                generado_por:    'HermesAI Flow',
            };
        }

        default:
            return { skipped: true, reason: `Tipo "${nodeKey}" — implementación pendiente` };
    }
}

// ── Handler principal ────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    // Declarados fuera del try porque el catch exterior los necesita para cerrar
    // el run. Cuando vivían dentro, el catch no los veía y la fila se quedaba en
    // 'running' para siempre.
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    let runId: string | null = null;

    try {
        const body = await req.json();
        const {
            workflowId, organizationId, triggeredBy = 'manual',
            action,       // 'resume' para reanudar tras aprobación
            runId: resumeRunId, // ID del run pausado (solo cuando action='resume')
            approverId,   // auth.uid() del aprobador (solo cuando action='resume')
        } = body;

        if (!workflowId || !organizationId) {
            return new Response(
                JSON.stringify({ error: 'workflowId y organizationId son requeridos' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        // ── Autenticación del llamante ───────────────────────────────────────
        // Llamadas internas (cron-runner) traen el service role key. Las del
        // frontend traen el JWT del usuario: se valida contra Supabase Auth y
        // se verifica que su perfil pertenezca a la organización del body —
        // nunca se confía en organizationId/approverId sin esta verificación.
        //
        // ⚠️ Una llamada interna se reconoce por `x-cron-secret`, NO por que
        // `Authorization` traiga la service_role key. Este proyecto usa el
        // formato nuevo de claves de Supabase (`sb_secret_…`, que no es un JWT)
        // y supabase-js las envía en `apikey`, dejando `Authorization` vacía:
        // comparar contra SERVICE_ROLE_KEY daba siempre falso y el cron acabó
        // recibiendo un 401 en cada disparo. Se mantiene la comparación con la
        // clave por compatibilidad, exigiendo que el token NO esté vacío —
        // si algún día la variable llegara vacía, '' === '' dejaría la puerta
        // abierta a cualquiera que no mandase cabecera.
        const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
        const secretoCron = (req.headers.get('x-cron-secret') ?? '').trim();
        const esLlamadaInterna =
            (CRON_SECRET !== '' && secretoCron === CRON_SECRET) ||
            (token !== '' && token === SERVICE_ROLE_KEY);

        let callerUserId: string | null = null;
        let callerRole: string | null = null;
        if (!esLlamadaInterna) {
            const { data: userData } = token
                ? await supabase.auth.getUser(token)
                : { data: { user: null } };
            if (!userData?.user) {
                // Distinguir los dos casos, que se arreglan de forma muy
                // distinta: sin cabecera es un llamante mal configurado; con
                // cabecera y sin usuario es una sesión caducada de verdad.
                return new Response(
                    JSON.stringify({
                        error: token === ''
                            ? 'No autenticado — la petición no trae cabecera Authorization'
                            : 'No autenticado — sesión inválida o expirada',
                    }),
                    { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
            callerUserId = userData.user.id;
            const { data: callerProfile } = await supabase
                .from('profiles')
                .select('organization_id, role')
                .eq('id', callerUserId)
                .single();
            if (!callerProfile || callerProfile.organization_id !== organizationId) {
                return new Response(
                    JSON.stringify({ error: 'No autorizado para esta organización' }),
                    { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
            // El rol también manda. Hasta el 07/08/2026 esto solo leía
            // `organization_id`: bastaba una sesión válida en la organización
            // para lanzar cualquier flujo llamando a la función a mano, aunque
            // fueras `viewer` o `auditor`. La pantalla escondía el botón y la
            // API no lo impedía — el mismo patrón del incidente de audit_log.
            if (!ROLES_QUE_EJECUTAN.has(callerProfile.role)) {
                // Este texto llega tal cual al usuario: el navegador lo lee del
                // cuerpo de la respuesta (utils/errores.ts). Que se entienda sin
                // saber qué es un rol de base de datos.
                return new Response(
                    JSON.stringify({
                        error: 'Tu rol no puede ejecutar flujos. La ejecución del proceso es del ' +
                               'Administrador, el Dueño de Proceso o el Autorizador Máximo.',
                    }),
                    { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
            callerRole = callerProfile.role;
        }

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

        // ── El estado de la definición ──────────────────────────────────────
        //
        // (20260814_ciclo_vida_flujos.sql). Aquí el estado solo RESTRINGE: nunca
        // le da permiso de ejecutar a quien no lo tenía — ROLES_QUE_EJECUTAN ya
        // se comprobó arriba y sigue mandando.
        //
        // ⚠️ Reanudar está exento a propósito, y no por comodidad: `resume` no
        // lanza nada, continúa un run que arrancó cuando el flujo sí estaba
        // publicado, y lo que garantiza que se reanuda LA MISMA definición es la
        // huella de §9.5, no este estado. Bloquear aquí dejaría colgado para
        // siempre cualquier run pausado cuyo flujo se despublicara mientras
        // esperaba la aprobación — que es justo lo que hace el trigger de
        // despublicación en cuanto alguien lo edita. Es el mismo error que
        // paralizó "Prueba Flujo 02032026" (§6).
        //
        // Un NULL (flujo anterior a la migración) se trata como borrador: lo que
        // no se puede comprobar no puede acabar diciendo que sí — misma familia
        // que `token !== ''` (§6.1) y la huella NULL (§9.5).
        const estadoDefinicion = workflow.estado_definicion ?? 'borrador';
        if (action !== 'resume' && estadoDefinicion !== 'publicado') {
            if (esLlamadaInterna) {
                // El cron ya filtra por publicado; si llega algo aquí es que se
                // despublicó entre el filtro y el disparo. No es un error del
                // usuario: se para y se dice.
                return new Response(
                    JSON.stringify({
                        error: `El flujo "${workflow.name}" no está publicado (${estadoDefinicion}). ` +
                               'No se dispara hasta que se autorice de nuevo.',
                    }),
                    { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
            if (!ROLES_QUE_DISENAN.has(callerRole ?? '')) {
                return new Response(
                    JSON.stringify({
                        error: `Este flujo todavía no está publicado (está en ${
                            estadoDefinicion === 'en_revision' ? 'revisión' : 'borrador'
                        }). Mientras tanto solo puede probarlo quien lo diseña: el Dueño de ` +
                        'Proceso o el Administrador. Para ponerlo en marcha hay que enviarlo a ' +
                        'revisión y que lo autoricen.',
                    }),
                    { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
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

        // 3. Crear o reutilizar registro de ejecución  (runId se declara arriba)
        let startedAt: number;
        let restoredContext: Record<string, any> = {};
        let completedNodeIds: Set<string> = new Set();

        if (action === 'resume' && resumeRunId) {
            // Reanudar run pausado — acepta esperando_aprobacion o error (reintento tras fallo de resume)
            const { data: existingRun, error: fetchErr } = await supabase
                .from('execution_runs')
                .select('id, context_json, completed_node_ids, definicion_huella')
                .eq('id', resumeRunId)
                .in('status', ['esperando_aprobacion', 'error'])
                .not('paused_node_id', 'is', null)
                .single();
            if (fetchErr || !existingRun) throw new Error('Run pausado no encontrado — ya completado o sin pausa registrada');

            // ── El flujo tiene que seguir siendo el que se aprobó ────────────
            //
            // Los nodos se cargaron arriba, así que aquí ya tenemos la
            // definición ACTUAL. Si no coincide con la del momento de pausar,
            // continuar significaría ejecutar algo que nadie autorizó.
            //
            // Falla cerrado, y una huella ausente cuenta como fallo: `null` es
            // «no se puede comprobar», no «adelante». Es la misma trampa del
            // `'' === ''` que ya nos costó una rama muerta (CLAUDE.md §9.4).
            const huellaAhora = await huellaDefinicion(nodes, connections ?? []);
            if (existingRun.definicion_huella !== huellaAhora) {
                const motivo = existingRun.definicion_huella
                    ? 'El flujo se modificó después de que se aprobara esta tarea, así que no se reanuda: ' +
                      'se aprobó una versión y se ejecutaría otra. Vuelve a lanzar el flujo para que se ' +
                      'apruebe la versión actual.'
                    : 'No se puede comprobar que el flujo siga siendo el que se aprobó, porque la pausa es ' +
                      'anterior a esta comprobación. Vuelve a lanzar el flujo.';

                // El run NO puede quedarse en `esperando_aprobacion`: su tarea ya
                // está aprobada, así que el vencimiento de cron-runner —que solo
                // mira tareas pendientes— no lo tocaría nunca y quedaría colgado
                // para siempre. Es justo cómo se paralizó "Prueba Flujo 02032026".
                await supabase.from('execution_runs').update({
                    status:        'error',
                    error_message: motivo,
                    finished_at:   new Date().toISOString(),
                }).eq('id', existingRun.id);

                await supabase.from('execution_logs').insert({
                    organization_id:  organizationId,
                    workflow_id:      workflowId,
                    execution_run_id: existingRun.id,
                    node_id:          null,
                    status:           'error',
                    message:          `⛔ No se reanudó: ${motivo}`,
                    details_json:     {
                        huella_al_aprobar: existingRun.definicion_huella,
                        huella_ahora:      huellaAhora,
                    },
                    executed_at:      new Date().toISOString(),
                });

                return new Response(
                    JSON.stringify({ error: motivo }),
                    { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }

            runId            = existingRun.id;
            startedAt        = Date.now();
            restoredContext  = (existingRun.context_json as Record<string, any>) ?? {};
            completedNodeIds = new Set((existingRun.completed_node_ids as string[]) ?? []);
            await supabase.from('execution_runs').update({ status: 'running' }).eq('id', runId);
        } else {
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
            runId     = run.id;
            startedAt = Date.now();
        }

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
                details_json:     details ?? null,
                executed_at:      new Date().toISOString(),
            };
            logBuffer.push({ ...entry, timestamp: entry.executed_at });
            const { error: logErr } = await supabase.from('execution_logs').insert(entry);
            if (logErr) console.error('addLog error:', logErr.message);
        };

        // 4. Ordenar nodos topológicamente
        const sorted = topologicalSort(nodes, connections ?? []);

        // 5. Ejecutar nodos en secuencia
        const context: Record<string, any> = { ...restoredContext };
        const skippedNodes = new Set<string>();

        // Al reanudar: reconstruir qué ramas fueron descartadas por nodos Decisión ya completados.
        // Sin esto, al reanudar el flujo el set skippedNodes empieza vacío y la rama perdida ejecuta igual.
        if (action === 'resume') {
            for (const completedId of completedNodeIds) {
                const completedNode = (nodes ?? []).find((n: any) => n.id === completedId);
                if (completedNode?.category !== 'decision') continue;
                const decisionResult = restoredContext[completedId];
                if (!decisionResult?.branch) continue;
                const losingBranch = decisionResult.branch === 'true' ? 'false' : 'true';
                for (const c of (connections ?? [])) {
                    if (c.source_node_id === completedId && c.branch === losingBranch) {
                        skippedNodes.add(c.target_node_id);
                    }
                }
            }
        }
        let hasError    = false;
        let errorMessage = '';
        let paused      = false;

        await addLog(null, 'info',
            action === 'resume'
                ? `↩ Flujo "${workflow.name}" reanudado tras aprobación`
                : `▶ Flujo "${workflow.name}" iniciado (${sorted.length} nodos)`
        );

        for (const node of sorted) {
            // Al reanudar: saltar nodos ya completados antes de la pausa
            if (completedNodeIds.has(node.id)) continue;

            // Omitir nodos en rama no seleccionada por una Decisión anterior
            if (skippedNodes.has(node.id)) {
                await supabase.from('workflow_nodes').update({ status: 'idle' }).eq('id', node.id);
                await addLog(node.id, 'warning', `↷ Nodo "${node.title}" omitido (rama no activa)`);
                const connList = connections ?? [];
                for (const c of connList) {
                    if (c.source_node_id === node.id) skippedNodes.add(c.target_node_id);
                }
                continue;
            }

            const nodeStart = Date.now();
            try {
                await supabase
                    .from('workflow_nodes')
                    .update({ status: 'running' })
                    .eq('id', node.id);

                const result = await executeNode(node, context, supabase, organizationId);

                context[node.id] = result;
                completedNodeIds.add(node.id);
                const elapsed = Date.now() - nodeStart;

                if (node.category === 'decision' && result.branch) {
                    const losingBranch = result.branch === 'true' ? 'false' : 'true';
                    const connList = connections ?? [];
                    for (const c of connList) {
                        if (c.source_node_id === node.id && c.branch === losingBranch) {
                            skippedNodes.add(c.target_node_id);
                        }
                    }
                    await addLog(
                        node.id, 'info',
                        `🔀 Decisión: condición ${result.evaluated ? 'VERDADERA' : 'FALSA'} → tomando rama ${result.branch === 'true' ? 'SI ✅' : 'NO ❌'}`
                    );
                }

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
                // ── Pausa por aprobación pendiente ────────────────────────
                if (err.__pauseApproval) {
                    paused = true;
                    await supabase.from('workflow_nodes').update({ status: 'idle' }).eq('id', node.id);

                    // Crear tarea en bandeja del aprobador
                    await supabase.from('tareas_aprobacion').insert({
                        organization_id:  organizationId,
                        workflow_id:      workflowId,
                        execution_run_id: runId,
                        node_id:          node.id,
                        node_title:       node.title ?? 'Aprobación',
                        // Identidad real del llamante (JWT); el approverId del body
                        // solo se acepta en llamadas internas con service role key
                        solicitante_id:   callerUserId ?? approverId ?? null,
                        rol_aprobador:    err.rolAprobador,
                        descripcion:      err.descripcion,
                        monto:            err.monto,
                        categoria:        err.categoria,
                        vence_at:         err.venceAt,
                    });

                    // Persistir contexto acumulado para reanudar después
                    // Incluir el nodo de aprobación en completedNodeIds para no re-ejecutarlo al reanudar
                    //
                    // `definicion_huella` fija QUÉ se está aprobando. Al reanudar
                    // se recalcula sobre la definición de entonces y, si no
                    // coincide, no se reanuda: el flujo cambió después de
                    // aprobarse. Sin esto se aprueba una versión y corre otra.
                    const { error: errPausa } = await supabase.from('execution_runs').update({
                        status:             'esperando_aprobacion',
                        context_json:       context,
                        completed_node_ids: [...completedNodeIds, node.id],
                        paused_node_id:     node.id,
                        definicion_huella:  await huellaDefinicion(nodes, connections ?? []),
                    }).eq('id', runId);

                    // supabase-js no lanza: devuelve el error. Uno que nadie lee
                    // deja el run en `running` con una tarea pendiente colgando,
                    // y eso ya pasó en este proyecto (CLAUDE.md §5.1).
                    if (errPausa) {
                        console.error(`execute-workflow: no se pudo pausar el run ${runId} — ${errPausa.message}`);
                        await addLog(node.id, 'error',
                            `No se pudo registrar la pausa del flujo: ${errPausa.message}`
                        );
                    }

                    // Queda escrito de dónde salió el aprobador. Si mañana alguien
                    // pregunta por qué esta tarea le llegó a este rol, la respuesta
                    // está aquí y no hay que reconstruirla desde la matriz de hoy
                    // —que ya puede ser otra.
                    await addLog(node.id, 'warning',
                        `⏸ Flujo pausado — esperando aprobación de rol "${err.rolAprobador}"` +
                        (err.reglaNombre
                            ? ` (matriz de aprobación, regla «${err.reglaNombre}»)`
                            : ' (rol fijado en el nodo)') +
                        `. Vence: ${fechaHoraVE(err.venceAt)} (hora de Venezuela)`
                    );

                    // ── Notificar por email a los aprobadores del rol requerido ──
                    if (canalEmail() !== 'ninguno') {
                        try {
                            // Los que TIENEN el rol más los suplentes con una
                            // delegación vigente. Antes era un `.eq('role', …)` a
                            // secas: la persona a la que se le había delegado la
                            // firma habría sido la única del sistema que no se
                            // entera de que hay algo que aprobar.
                            const aprobadores = await destinatariosDelRol(
                                supabase, organizationId, err.rolAprobador,
                            );

                            // Un correo distinto para cada aprobador (saluda por su
                            // nombre), pero UNA sola petición: antes era un bucle con
                            // un envío por persona y el límite de Resend son 2
                            // peticiones por segundo. Ver _shared/email.ts.
                            const mensajes = (aprobadores ?? [])
                                .filter((ap: any) => ap.email)
                                .map((ap: any) => ({
                                    to:      ap.email,
                                    subject: `⏸ Aprobación requerida — ${workflow.name}`,
                                    html:    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#1e3a5f;padding:24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">⏸ Aprobación Pendiente</h2>
    <p style="color:#a5b4fc;margin:8px 0 0;font-size:13px">HermesAI Flow — Automatización de Procesos</p>
  </div>
  <div style="padding:24px;background:#f8fafc">
    <p style="color:#374151;font-size:14px">Hola <strong>${escaparHtml(ap.name)}</strong>,</p>
    <p style="color:#374151;font-size:14px">El flujo <strong>"${escaparHtml(workflow.name)}"</strong> requiere tu aprobación para continuar.</p>
    ${ap.porDelegacionDe ? `<p style="color:#92400e;font-size:13px;background:#fef3c7;border-left:3px solid #f59e0b;padding:10px 12px;margin:12px 0">Te llega por la <strong>delegación vigente de ${escaparHtml(ap.porDelegacionDe)}</strong>. Al resolverla quedará registrado que actuaste en su nombre.</p>` : ''}
    <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <tr style="background:#f1f5f9"><td style="padding:10px 16px;color:#6b7280;font-size:12px;width:40%">Descripción</td><td style="padding:10px 16px;font-weight:600;font-size:13px">${escaparHtml(err.descripcion ?? '—')}</td></tr>
      ${err.monto ? `<tr><td style="padding:10px 16px;color:#6b7280;font-size:12px;background:#f8fafc">Monto</td><td style="padding:10px 16px;font-weight:600;font-size:13px">${escaparHtml(err.monto)}</td></tr>` : ''}
      ${err.categoria ? `<tr style="background:#f1f5f9"><td style="padding:10px 16px;color:#6b7280;font-size:12px">Categoría</td><td style="padding:10px 16px;font-weight:600;font-size:13px">${escaparHtml(err.categoria)}</td></tr>` : ''}
      <tr${err.categoria ? '' : ' style="background:#f1f5f9"'}><td style="padding:10px 16px;color:#6b7280;font-size:12px">Vence</td><td style="padding:10px 16px;font-weight:600;font-size:13px;color:#dc2626">${fechaHoraVE(err.venceAt)} (hora de Venezuela)</td></tr>
    </table>
    <p style="color:#374151;font-size:14px">Ingresa a <strong>Gobierno → Bandeja de Aprobación</strong> para aprobar o rechazar.</p>
    <p style="color:#9ca3af;font-size:11px;margin-top:20px">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`,
                                }));

                            if (mensajes.length > 0) await enviarPersonalizado(mensajes);
                        } catch {
                            // No interrumpir el flujo si el email falla
                        }
                    }
                    break;
                }

                // ── Error real ────────────────────────────────────────────
                hasError     = true;
                errorMessage = err.message;
                await supabase.from('workflow_nodes').update({ status: 'error' }).eq('id', node.id);
                await addLog(node.id, 'error', `✗ Nodo "${node.title}" falló: ${err.message}`);
                break;
            }
        }

        // 6. Finalizar ejecución (solo si no está pausado)
        const totalMs = Date.now() - startedAt;

        if (paused) {
            return new Response(
                JSON.stringify({
                    success:  false,
                    paused:   true,
                    runId,
                    duration: totalMs,
                    logs:     logBuffer.length,
                    message:  'Flujo pausado — esperando aprobación humana',
                }),
                { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        const finalStatus = hasError ? 'error' : 'success';

        await Promise.all([
            supabase.from('execution_runs').update({
                status:        finalStatus,
                finished_at:   new Date().toISOString(),
                duration_ms:   totalMs,
                logs_count:    logBuffer.length,
                error_message: errorMessage || null,
            }).eq('id', runId),

            supabase.from('workflows').update({
                last_run_at:     new Date().toISOString(),
                execution_count: (workflow.execution_count ?? 0) + 1,
                status:          hasError ? 'error' : 'active',
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
        // Cerrar el run antes de salir. Sin esto, cualquier excepción fuera del
        // bucle de nodos dejaba la fila en 'running' para siempre: nadie la
        // reclama después, porque el escalamiento del cron-runner solo mira
        // 'esperando_aprobacion'. Así quedaron colgados dos runs del 29/07/2026
        // hasta que se cerraron a mano el 01/08.
        //
        // Esto NO cubre el caso de que la función muera del todo (límite de
        // tiempo, memoria): ahí no se ejecuta ningún catch. Para eso hace falta
        // un vigilante externo que cierre los runs en 'running' pasado un plazo.
        if (runId) {
            await supabase.from('execution_runs').update({
                status:        'error',
                finished_at:   new Date().toISOString(),
                error_message: err.message,
            }).eq('id', runId).in('status', ['running', 'pending']);
        }

        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    }
});
