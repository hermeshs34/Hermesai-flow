// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Motor de Ejecución de Flujos
// Edge Function: execute-workflow
// Recibe: { workflowId, organizationId, triggeredBy? }
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enviarEmail as enviar, enviarEmailPersonalizado as enviarPersonalizado, canalEmail, escaparHtml } from '../_shared/email.ts';
import { fechaHoraVE, fechaVE } from '../_shared/fecha.ts';

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

// ── Ejecutor de nodo individual ──────────────────────────────────────────────
async function executeNode(
    node: any,
    context: Record<string, any>,
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
            const rolAprobador = cfg.approver ?? 'supervisor';
            const descripcion  = resolveValue(cfg.reason ?? 'Requiere revisión manual', context);
            const monto        = cfg.monto ? Number(resolveValue(String(cfg.monto), context)) : null;
            const categoria    = cfg.categoria ? resolveValue(cfg.categoria, context) : null;
            const horasVence   = cfg.horasVence ? Number(cfg.horasVence) : 48;
            const venceAt      = new Date(Date.now() + horasVence * 60 * 60 * 1000).toISOString();
            // Señal para que el loop principal pause la ejecución
            throw { __pauseApproval: true, rolAprobador, descripcion, monto, categoria, venceAt };
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

        // ── Verificación Listas Restrictivas (OFAC/PEP/ONU/UE) ───────────────
        case 'processor:aml': {
            const RG_URL = Deno.env.get('RISKGUARD_SUPABASE_URL');
            const RG_KEY = Deno.env.get('RISKGUARD_SERVICE_ROLE_KEY');

            // Parámetros del nodo: nombre y/o documento a verificar
            const nombre    = cfg.nombre    ? resolveValue(String(cfg.nombre),    context) : null;
            const documento = cfg.documento ? resolveValue(String(cfg.documento), context) : null;
            const tiposLista: string[] = cfg.listas ?? ['OFAC', 'PEP', 'ONU', 'UE', 'LOCAL', 'INTERPOL'];

            // Sin credenciales RiskGuard → mock (entorno dev / secrets no configurados)
            if (!RG_URL || !RG_KEY) {
                const score = Math.floor(Math.random() * 100);
                return {
                    en_lista:   false,
                    hits:       [],
                    aml_score:  score,
                    nivel:      score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo',
                    fuente:     'mock',
                    timestamp:  new Date().toISOString(),
                };
            }

            if (!nombre && !documento) {
                throw new Error('El nodo Verificar OFAC requiere configurar "nombre" o "documento" a verificar');
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

            let hits: any[] = [];
            let rgErr: any = null;

            if (documento) {
                // Búsqueda exacta por documento
                const res = await rg
                    .from('listas_restrictivas')
                    .select('id, tipo_lista, nombre, documento, pais, motivo, fecha_inclusion')
                    .in('tipo_lista', tiposLista)
                    .eq('activo', true)
                    .eq('documento', documento)
                    .limit(10);
                hits  = res.data ?? [];
                rgErr = res.error;
            } else if (nombre) {
                // Búsqueda parcial con ilike — más robusta que textSearch en todos los entornos
                // El tipo explícito no es adorno: `nombre` es any, así que sin él
                // `palabras` también lo es y los tres callbacks de abajo daban
                // TS7006. Anotar el origen los arregla los tres.
                const palabras: string[] = nombre.trim().split(/\s+/);
                const palabraMasFuerte = palabras.reduce((a, b) => b.length > a.length ? b : a, palabras[0]);
                const res = await rg
                    .from('listas_restrictivas')
                    .select('id, tipo_lista, nombre, documento, pais, motivo, fecha_inclusion')
                    .in('tipo_lista', tiposLista)
                    .eq('activo', true)
                    .ilike('nombre', `%${palabraMasFuerte}%`)
                    .limit(20);
                // Post-filtrar: al menos 2 palabras del nombre deben coincidir
                const resData = res.data ?? [];
                const nombreLower = nombre.toLowerCase();
                hits = resData.filter((r: any) => {
                    const rl = (r.nombre ?? '').toLowerCase();
                    return palabras.filter(p => p.length > 2 && rl.includes(p.toLowerCase())).length >= Math.min(2, palabras.length);
                });
                // Si no hay coincidencias con 2 palabras, usar resultado ilike directo
                if (hits.length === 0 && resData.length > 0) {
                    hits = resData.filter((r: any) => (r.nombre ?? '').toLowerCase().includes(nombreLower));
                }
                rgErr = res.error;
            }

            if (rgErr) throw new Error(`RiskGuard listas: ${rgErr.message}`);

            const enLista = (hits ?? []).length > 0;
            // Score: 100 si está en lista, 0 si no
            const amlScore = enLista ? 100 : 0;

            return {
                en_lista:   enLista,
                hits:       hits ?? [],
                hit_count:  (hits ?? []).length,
                aml_score:  amlScore,
                nivel:      enLista ? 'alto' : 'bajo',
                fuente:     'riskguard',
                nombre_buscado:    nombre ?? null,
                documento_buscado: documento ?? null,
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
        // Schema real: companies, financial_periods (company_id, period_name, is_closed)
        //              income_statement_entries (company_id, amount, entry_type)
        case 'processor:eeff': {
            const EEFF_URL = Deno.env.get('EEFF_SUPABASE_URL');
            const EEFF_KEY = Deno.env.get('EEFF_SERVICE_ROLE_KEY');
            if (!EEFF_URL || !EEFF_KEY) {
                return { skipped: true, reason: 'EEFF_SUPABASE_URL o EEFF_SERVICE_ROLE_KEY no configurados' };
            }
            const eeff      = createClient(EEFF_URL, EEFF_KEY);
            const queryType = cfg.query_type ?? 'summary';
            const ts        = new Date().toISOString();

            // ── Modo "all": resumen de todas las empresas y períodos ──────
            if (queryType === 'all') {
                const { data: companies } = await eeff
                    .from('companies')
                    .select('id, name, currency')
                    .eq('is_active', true);

                const lineas: string[] = [];
                for (const co of companies ?? []) {
                    const { data: periodos } = await eeff
                        .from('financial_periods')
                        .select('period_name, is_closed')
                        .eq('company_id', co.id)
                        .order('start_date', { ascending: false })
                        .limit(5);
                    const pList = (periodos ?? [])
                        .map((p: any) => `${p.period_name} (${p.is_closed ? 'cerrado' : 'abierto'})`)
                        .join(' | ');
                    lineas.push(`${co.name} [${co.currency}]: ${pList || 'sin períodos'}`);
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
            let companyQuery = eeff.from('companies').select('id, name, currency').eq('is_active', true);
            if (cfg.company?.trim()) {
                companyQuery = companyQuery.ilike('name', `%${cfg.company.trim()}%`);
            }
            const { data: companies } = await companyQuery.limit(1);
            const company = companies?.[0];
            if (!company) {
                return { skipped: true, reason: `Empresa "${cfg.company}" no encontrada en EE.FF.` };
            }

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
            const { data: periods } = await periodQuery.limit(1);
            let period = periods?.[0];

            if (!period) {
                // Intentar con el período más reciente sin importar estado
                const { data: anyPeriod } = await eeff
                    .from('financial_periods')
                    .select('id, period_name, start_date, end_date, is_closed')
                    .eq('company_id', company.id)
                    .order('start_date', { ascending: false })
                    .limit(1)
                    .maybeSingle();
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
            // LÓGICA InsuranceModel (replica DataContext.tsx del sistema EE.FF.)
            //
            // El sistema EE.FF. importa dos fuentes para el mismo período:
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
            //   4. InsuranceModel: Math.abs se aplica AL CLASIFICAR cada hoja.
            //      '2' = Activos, '3' = Gastos, '4' = Pasivos/Patrimonio (409/410/411), '5' = Ingresos
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

            // Paso 3 — InsuranceModel (BALANCE): clasificar 2/4 por prefijo de account_code
            let activos = 0, pasivos = 0, patrimonio = 0;
            let leafCount = 0;

            for (const [code, balance] of leafItems) {
                leafCount++;
                const v       = Math.abs(balance);
                const clean   = allCleans.get(code)!;
                const name    = consolidated.get(code)?.name.toLowerCase() ?? '';

                if (code.match(/^2[\.\-]/i) || code.match(/^2\d/)) {
                    // 2.xxx → ACTIVOS (SUDEASEG). InsuranceModel.mapAccount suma |saldo|
                    // de cada hoja (el neteo de contra-activos ya ocurrió al consolidar con signo).
                    activos += v;
                } else if (code.match(/^4[\.\-]/i) || code.match(/^4\d/)) {
                    // 4xx- → PASIVOS o PATRIMONIO (Profit Plus)
                    const isEquity = clean.startsWith('409') || clean.startsWith('410') || clean.startsWith('411') ||
                        clean.startsWith('4409') || clean.startsWith('4410') || clean.startsWith('4411') ||
                        name.includes('capital social') || name.includes('patrimonio') ||
                        name.includes('reserva legal') || name.includes('superavit') ||
                        name.includes('utilidad del ejercicio') || name.includes('utilidades no distribuidas') ||
                        name.includes('resultado del ejercicio') || name.includes('perdida del ejercicio');
                    if (isEquity) patrimonio += v; else pasivos += v;
                }
                // Grupos 3 y 5 se procesan en el motor P&L (pipeline separado, abajo)
            }

            // ══════════════════════════════════════════════════════════════
            // MOTOR P&L (réplica exacta de extractIncomeStatementData — Seguros)
            // Pipeline DISTINTO al del balance (validado vs SQL 10/06/2026,
            // reproduce ingresos/costo/utilidad del sistema EE.FF. al céntimo):
            //   - SIN dedup; consolidación CON SIGNO por código
            //   - Excluye códigos terminados en '-' (totalizadores Profit Plus)
            //   - Totalizador 80%: padre se excluye solo si sus hijos suman > 80% de su |saldo|
            //   - Grupo 5: saldo < 0 → Ingresos; saldo > 0 → Costos Técnicos (reversiones)
            //   - Grupo 3: técnico solo por prefijo 30/311/312/32/33/34/317+«técnico» → COGS;
            //     resto → Gastos Admin (sin palabras clave adicionales)
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

            let ingresos = 0, costoVentas = 0, gastosOperativos = 0;
            for (const [code, { val, name }] of consolidatedPL) {
                if (code.endsWith('-')) continue;
                if (Math.abs(val) <= 0.01) continue;
                const cc = plCleans.get(code)!;
                let hasChildren = false;
                let childrenSum = 0;
                for (const [otherCode, otherClean] of plCleans) {
                    if (otherCode === code) continue;
                    if (otherClean.startsWith(cc) && otherClean.length > cc.length) {
                        hasChildren = true;
                        childrenSum += Math.abs(consolidatedPL.get(otherCode)!.val);
                    }
                }
                if (hasChildren && childrenSum > Math.abs(val) * 0.8) continue; // totalizador

                const mainGroup = code.charAt(0);
                const digits    = code.replace(/[^0-9]/g, '');
                const lname     = name.toLowerCase();

                if (mainGroup === '5') {
                    if (val < 0) ingresos += Math.abs(val);
                    else costoVentas += val; // reversiones positivas en G5 → costos técnicos
                } else if (mainGroup === '3') {
                    const isTechnical = digits.startsWith('30') || digits.startsWith('311') ||
                        digits.startsWith('312') || digits.startsWith('32') ||
                        digits.startsWith('33') || digits.startsWith('34') ||
                        (digits.startsWith('317') && (lname.includes('tecnico') || lname.includes('técnico')));
                    if (isTechnical) costoVentas += Math.abs(val);
                    else gastosOperativos += Math.abs(val);
                }
            }

            const gastos  = costoVentas + gastosOperativos;
            const utilidad = ingresos - gastos;
            if (activos === 0 && (pasivos + patrimonio) > 0) activos = pasivos + patrimonio;

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

            return {
                empresa:               company.name,
                moneda:                monedaReporte,
                periodo:               (period as any)?.period_name ?? '—',
                periodo_estado:        (period as any)?.is_closed ? 'Cerrado' : 'Abierto',
                activos:               fmt(activos),
                pasivos:               fmt(pasivos),
                patrimonio:            fmt(patrimonio),
                ingresos:              fmt(ingresos),
                costo_ventas:          fmt(costoVentas),
                gastos_admin:          fmt(gastosOperativos),
                gastos:                fmt(gastos),
                utilidad_neta:         fmt(utilidad),
                margen_pct:            ingresos > 0 ? ((utilidad / ingresos) * 100).toFixed(1) + '%' : '0%',
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
                    max_tokens: cfg.max_tokens ?? 4096,
                    system:     systemPrompt,
                    messages:   [{ role: 'user', content: contextBlock + userPrompt }],
                }),
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Anthropic API error: ${txt}`);
            }

            const data       = await res.json();
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
                return new Response(
                    JSON.stringify({ error: `El rol "${callerProfile.role}" no puede ejecutar flujos` }),
                    { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
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
                .select('id, context_json, completed_node_ids')
                .eq('id', resumeRunId)
                .in('status', ['esperando_aprobacion', 'error'])
                .not('paused_node_id', 'is', null)
                .single();
            if (fetchErr || !existingRun) throw new Error('Run pausado no encontrado — ya completado o sin pausa registrada');
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

                const result = await executeNode(node, context);

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
                    await supabase.from('execution_runs').update({
                        status:             'esperando_aprobacion',
                        context_json:       context,
                        completed_node_ids: [...completedNodeIds, node.id],
                        paused_node_id:     node.id,
                    }).eq('id', runId);

                    await addLog(node.id, 'warning',
                        `⏸ Flujo pausado — esperando aprobación de rol "${err.rolAprobador}". Vence: ${fechaHoraVE(err.venceAt)} (hora de Venezuela)`
                    );

                    // ── Notificar por email a los aprobadores del rol requerido ──
                    if (canalEmail() !== 'ninguno') {
                        try {
                            const { data: aprobadores } = await supabase
                                .from('profiles')
                                .select('name, email')
                                .eq('organization_id', organizationId)
                                .eq('role', err.rolAprobador)
                                .eq('is_active', true);

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
