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
    if (!expr) return expr;

    // Reemplazar todas las expresiones {{...}} dentro de una cadena
    if (expr.includes('{{')) {
        return expr.replace(/\{\{([^}]+)\}\}/g, (_, rawPath) => {
            const path = rawPath.trim();

            // {{summary}} → tabla HTML con todos los datos del contexto
            if (path === 'summary') return buildContextSummary(context);

            // {{previous.campo}} → último nodo ejecutado
            if (path.startsWith('previous.')) {
                const field = path.slice(9);
                const nodeIds = Object.keys(context).filter(k => k !== '__lastNodeId');
                const lastId  = nodeIds[nodeIds.length - 1];
                return lastId ? (context[lastId]?.[field] ?? '') : '';
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
        return new Date(val).toLocaleString('es-VE');
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
            rows += `<tr style="background:${rowBg}">
                <td style="padding:8px 16px;color:#6b7280;font-size:12px;width:40%">${label}</td>
                <td style="padding:8px 16px;${valueStyle}">${display}</td>
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

            const res = await fetch('https://api.resend.com/emails', {
                method:  'POST',
                headers: {
                    Authorization:   `Bearer ${deps.resendKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from:    cfg.from ?? 'HermesAI Flow <onboarding@resend.dev>',
                    to:      [to],
                    subject,
                    html:    body,
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

        // ── Aprobación Humana ─────────────────────────────────────────────
        case 'processor:aprobacion': {
            // En Sprint S2: auto-aprueba y registra. Sprint S3 agregará pausa real con token.
            const approver = cfg.approver ?? 'supervisor';
            const reason   = resolveValue(cfg.reason ?? 'Requiere revisión manual', context);
            return {
                approved:    true,
                approver,
                reason,
                mode:        'auto-approved (Sprint S3 agregará pausa real)',
                timestamp:   new Date().toISOString(),
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

            if (cfg.periodo?.trim()) {
                periodQuery = periodQuery.ilike('period_name', `%${cfg.periodo.trim()}%`);
            } else {
                periodQuery = periodQuery.eq('is_closed', false);
            }
            const { data: periods } = await periodQuery.limit(1);
            const period = periods?.[0];

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
                Object.assign(period ?? {}, anyPeriod);
            }

            // ── Leer financial_entries por company_id + period_id ────────
            // Columnas: company_id, period_id, account_code, account_name,
            //           debit_amount, credit_amount, balance_amount,
            //           entry_type, category
            const { data: entries, error: entErr } = await eeff
                .from('financial_entries')
                .select('category, entry_type, balance_amount, debit_amount, credit_amount')
                .eq('company_id', company.id)
                .eq('period_id', (period as any)?.id ?? '')
                .limit(5000);

            if (entErr) throw new Error(`EE.FF. entries: ${entErr.message}`);

            // Agrupar por categoría y sumar valores absolutos
            const sums: Record<string, number> = {};
            for (const e of entries ?? []) {
                const cat = String(e.category || e.entry_type || 'otros').toLowerCase();
                const val = Math.abs(Number(e.balance_amount ?? 0));
                sums[cat] = (sums[cat] ?? 0) + val;
            }

            const ingresos  = sums['ingresos']   ?? 0;
            const gastos    = (sums['gastos']    ?? 0) + (sums['egresos'] ?? 0);
            const pasivos   = sums['pasivos']    ?? 0;
            const patrimonio= sums['patrimonio'] ?? 0;
            const activos   = sums['activos']    ?? 0;
            const utilidad  = ingresos - gastos;

            if (queryType === 'variacion') {
                const { data: prevPeriods } = await eeff
                    .from('financial_periods')
                    .select('id, period_name, start_date')
                    .eq('company_id', company.id)
                    .order('start_date', { ascending: false })
                    .limit(2);
                return {
                    empresa:          company.name,
                    moneda:           company.currency,
                    periodo_actual:   prevPeriods?.[0]?.period_name ?? '—',
                    periodo_anterior: prevPeriods?.[1]?.period_name ?? '—',
                    ingresos_total:   ingresos.toFixed(2),
                    gastos_total:     gastos.toFixed(2),
                    utilidad_neta:    utilidad.toFixed(2),
                    timestamp:        ts,
                };
            }

            const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2 });

            return {
                empresa:        company.name,
                moneda:         company.currency,
                periodo:        (period as any)?.period_name ?? '—',
                periodo_estado: (period as any)?.is_closed ? 'Cerrado' : 'Abierto',
                entradas:       `${(entries ?? []).length} registros`,
                activos:        fmt(activos),
                pasivos:        fmt(pasivos),
                patrimonio:     fmt(patrimonio),
                ingresos:       fmt(ingresos),
                gastos:         fmt(gastos),
                utilidad_neta:  fmt(utilidad),
                margen_pct:     ingresos > 0 ? ((utilidad / ingresos) * 100).toFixed(1) + '%' : '0%',
                timestamp:      ts,
            };
        }

        // ── Reporte Gerencial (email formateado) ──────────────────────────
        case 'output:reporte': {
            if (!deps.resendKey) throw new Error('RESEND_API_KEY no configurado');
            const to      = resolveValue(cfg.to ?? '', context);
            const subject = resolveValue(cfg.subject ?? '📊 Reporte Gerencial — HermesAI Flow', context);
            let   body    = resolveValue(cfg.body ?? '', context);
            if (!to) throw new Error('Nodo Reporte Gerencial: campo "to" requerido');

            if (!body?.trim()) {
                body = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff">
  <div style="background:linear-gradient(135deg,#1e1b4b,#4f46e5);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px">📊 Reporte de Gestión</h1>
    <p style="color:#a5b4fc;margin:8px 0 0;font-size:13px">Informe ejecutivo generado automáticamente · ${new Date().toLocaleDateString('es-VE')}</p>
  </div>
  <div style="padding:28px 24px;background:#f8fafc">
    ${buildContextSummary(context)}
    <p style="color:#9ca3af;font-size:11px;margin-top:20px;text-align:center">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`;
            }

            const res = await fetch('https://api.resend.com/emails', {
                method:  'POST',
                headers: { Authorization: `Bearer ${deps.resendKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from:    cfg.from ?? 'HermesAI Flow <onboarding@resend.dev>',
                    to:      [to],
                    subject,
                    html:    body,
                }),
            });
            if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
            const data = await res.json();
            return { sent: true, email_id: data.id, to, subject };
        }

        // ── Nodo no implementado ──────────────────────────────────────────
        default:
            return { skipped: true, reason: `Tipo "${nodeKey}" — implementación pendiente` };
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
                details_json:     details ?? null,   // columna real en schema
                executed_at:      new Date().toISOString(), // columna real en schema
            };
            logBuffer.push({ ...entry, timestamp: entry.executed_at }); // buffer interno conserva 'timestamp' para Monitoring
            const { error: logErr } = await supabase.from('execution_logs').insert(entry);
            if (logErr) console.error('addLog error:', logErr.message);
        };

        // 4. Ordenar nodos topológicamente
        const sorted = topologicalSort(nodes, connections ?? []);

        // 5. Ejecutar nodos en secuencia
        const context: Record<string, any> = {};
        const skippedNodes = new Set<string>(); // nodos en rama no tomada
        let hasError = false;
        let errorMessage = '';

        await addLog(null, 'info', `▶ Flujo "${workflow.name}" iniciado (${sorted.length} nodos)`);

        for (const node of sorted) {
            // Omitir nodos en rama no seleccionada por una Decisión anterior
            if (skippedNodes.has(node.id)) {
                await supabase.from('workflow_nodes').update({ status: 'idle' }).eq('id', node.id);
                await addLog(node.id, 'warning', `↷ Nodo "${node.title}" omitido (rama no activa)`);
                // Propagar skip a descendientes de este nodo también
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

                const result = await executeNode(node, context, {
                    supabase,
                    resendKey: RESEND_API_KEY,
                });

                context[node.id] = result;
                const elapsed    = Date.now() - nodeStart;

                // Si es un nodo de Decisión, marcar rama perdedora como skipped
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
