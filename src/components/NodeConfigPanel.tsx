import React, { useState, useEffect } from 'react';
import {
    X, Mail, Clock, GitBranch, FileText, Timer,
    Shield, TrendingUp, Bell, Package, UserCheck,
    Database, Play, Zap, AlertTriangle, CheckCircle,
    Info,
} from 'lucide-react';
import type { WorkflowNodeData } from '../types/workflow';

interface Props {
    node:     WorkflowNodeData | null;
    prevNode: WorkflowNodeData | null;
    isOpen:   boolean;
    onClose:  () => void;
    onSave:   (nodeId: string, config: Record<string, any>) => void;
}

// ── Campo genérico ────────────────────────────────────────────────────────────
function Field({
    label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
            {children}
            {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
        </div>
    );
}

function Input({ value, onChange, placeholder, type = 'text' }: {
    value: string; onChange: (v: string) => void;
    placeholder?: string; type?: string;
}) {
    return (
        <input
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
    );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: {
    value: string; onChange: (v: string) => void;
    placeholder?: string; rows?: number;
}) {
    return (
        <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
    );
}

function Select({ value, onChange, options }: {
    value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

// ── Formularios por tipo de nodo ──────────────────────────────────────────────

function CronForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    const presets = [
        { label: 'Cada día a las 9am',           value: '0 9 * * *'     },
        { label: 'Lunes a Viernes 9am',          value: '0 9 * * 1-5'   },
        { label: 'Cada hora',                    value: '0 * * * *'     },
        { label: 'Cada 30 minutos',              value: '*/30 * * * *'  },
        { label: 'Primer día del mes 8am',       value: '0 8 1 * *'     },
        { label: 'Lunes 7am (inicio semana)',    value: '0 7 * * 1'     },
    ];
    return (
        <div className="space-y-4">
            <Field label="Expresión Cron" hint="Formato: minuto hora día-mes mes día-semana">
                <Input value={cfg.cron ?? '0 9 * * 1-5'} onChange={v => set('cron', v)} placeholder="0 9 * * 1-5" />
            </Field>
            <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Atajos rápidos:</p>
                <div className="grid grid-cols-2 gap-1.5">
                    {presets.map(p => (
                        <button
                            key={p.value}
                            onClick={() => set('cron', p.value)}
                            className={`text-left text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                                cfg.cron === p.value
                                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-semibold'
                                    : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600'
                            }`}
                        >
                            {p.label}
                            <span className="block font-mono opacity-60">{p.value}</span>
                        </button>
                    ))}
                </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                <Info className="w-3.5 h-3.5 inline mr-1" />
                El cron se ejecuta automáticamente según el horario. Para probarlo ahora, usa el botón <strong>Ejecutar</strong> del canvas.
            </div>
        </div>
    );
}

function ManualTriggerForm() {
    return (
        <div className="p-4 bg-green-50 border border-green-100 rounded-lg text-sm text-green-800">
            <CheckCircle className="w-4 h-4 inline mr-1.5" />
            Este nodo no requiere configuración. El flujo se inicia cuando haces clic en <strong>Ejecutar</strong> en el canvas.
        </div>
    );
}

const BCV_TEMPLATE = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700">📊 Informe Diario — Tasa BCV</h1>
    <p style="color:#93c5fd;margin:8px 0 0;font-size:14px">Generado automáticamente por HermesAI Flow</p>
  </div>
  <div style="padding:28px 24px;background:#f8fafc">
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden">
      <tr style="background:#eff6ff">
        <td style="padding:14px 18px;font-size:13px;color:#64748b;font-weight:600;width:50%">Tasa BCV Oficial (USD)</td>
        <td style="padding:14px 18px;font-size:20px;font-weight:700;color:#1e40af">Bs. {{previous.bcv_rate}}</td>
      </tr>
      <tr>
        <td style="padding:14px 18px;font-size:13px;color:#64748b;font-weight:600">Fuente</td>
        <td style="padding:14px 18px;font-size:13px;color:#374151">{{previous.source}}</td>
      </tr>
      <tr style="background:#eff6ff">
        <td style="padding:14px 18px;font-size:13px;color:#64748b;font-weight:600">Fecha y hora</td>
        <td style="padding:14px 18px;font-size:13px;color:#374151">{{previous.timestamp}}</td>
      </tr>
    </table>
    <div style="margin-top:20px;padding:14px 18px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0">
      <p style="margin:0;font-size:13px;color:#92400e">
        <strong>Nota:</strong> Esta tasa es referencial. Verificar siempre con la fuente oficial del BCV antes de operaciones cambiarias.
      </p>
    </div>
  </div>
  <div style="padding:16px 24px;background:#1e3a5f;border-radius:0 0 12px 12px;text-align:center">
    <p style="margin:0;font-size:11px;color:#93c5fd">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`;

function EmailForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    const PLANTILLAS = [
        {
            id: 'bcv',
            label: '📊 Tasa BCV',
            apply: () => {
                set('subject', '📊 Tasa BCV del día — {{previous.bcv_rate}} Bs/USD');
                set('body', BCV_TEMPLATE);
            },
        },
        {
            id: 'ofac',
            label: '⚠️ Alerta OFAC',
            apply: () => {
                set('subject', '⚠️ Alerta Listas Restrictivas — {{previous.nombre_buscado}}');
                set('body', OFAC_EMAIL_TEMPLATE);
            },
        },
        {
            id: 'sin_coincidencia',
            label: '✅ Sin Coincidencia',
            apply: () => {
                set('subject', '✅ Verificación sin observaciones — {{previous.nombre_buscado}}');
                set('body', NO_COINCIDENCIA_TEMPLATE);
            },
        },
    ];

    return (
        <div className="space-y-4">
            <Field label="Para (destinatario)" hint="Email de quien recibirá el mensaje">
                <Input value={cfg.to ?? ''} onChange={v => set('to', v)} placeholder="nombre@empresa.com" type="email" />
            </Field>
            <Field label="Asunto">
                <Input value={cfg.subject ?? ''} onChange={v => set('subject', v)} placeholder="Alerta desde HermesAI Flow" />
            </Field>
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-semibold text-gray-700">Cuerpo del mensaje</label>
                    <div className="flex gap-1.5">
                        {PLANTILLAS.map(p => (
                            <button key={p.id} type="button" onClick={p.apply}
                                className="text-xs px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition-colors font-medium">
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
                <Textarea value={cfg.body ?? ''} onChange={v => set('body', v)}
                    placeholder="Selecciona una plantilla arriba o escribe el mensaje."
                    rows={6} />
                <p className="text-xs text-gray-400 mt-1">
                    Variables: <code className="bg-gray-100 px-1 rounded">{'{{previous.bcv_rate}}'}</code>{' '}
                    <code className="bg-gray-100 px-1 rounded">{'{{previous.en_lista}}'}</code>{' '}
                    <code className="bg-gray-100 px-1 rounded">{'{{previous.nombre_buscado}}'}</code>
                </p>
            </div>
            <Field label="Remitente (opcional)" hint="Dejar vacío usa: HermesAI Flow <onboarding@resend.dev>">
                <Input value={cfg.from ?? ''} onChange={v => set('from', v)} placeholder="Mi Empresa <alertas@miempresa.com>" />
            </Field>
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                <Info className="w-3.5 h-3.5 inline mr-1" />
                El envío usa <strong>Resend API</strong>. Secret <code>RESEND_API_KEY</code> debe estar en Supabase → Settings → Edge Functions.
            </div>
        </div>
    );
}

function DecisionForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs text-purple-700">
                Este nodo evalúa una condición y bifurca el flujo. Los nodos conectados después tomarán el resultado.
            </div>
            <Field label="Valor izquierdo" hint="Usa {{id_nodo.campo}} para referenciar datos anteriores">
                <Input value={cfg.left ?? ''} onChange={v => set('left', v)} placeholder="{{bcv.bcv_rate}}" />
            </Field>
            <Field label="Operador">
                <Select value={cfg.operator ?? '>'} onChange={v => set('operator', v)} options={[
                    { value: '>',        label: 'Mayor que (>)'          },
                    { value: '<',        label: 'Menor que (<)'          },
                    { value: '>=',       label: 'Mayor o igual (>=)'     },
                    { value: '<=',       label: 'Menor o igual (<=)'     },
                    { value: '==',       label: 'Igual a (==)'           },
                    { value: '!=',       label: 'Diferente de (!=)'      },
                    { value: 'contains', label: 'Contiene (texto)'       },
                ]} />
            </Field>
            <Field label="Valor derecho (referencia)">
                <Input value={cfg.right ?? ''} onChange={v => set('right', v)} placeholder="50" />
            </Field>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 font-mono">
                Resultado: <strong>{cfg.left || '?'}</strong> {cfg.operator || '>'} <strong>{cfg.right || '?'}</strong>
                <span className="ml-2 text-gray-400">→ true / false</span>
            </div>
        </div>
    );
}

function LogForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <Field label="Mensaje a registrar" hint="Puedes incluir variables: {{id_nodo.campo}}">
                <Textarea value={cfg.message ?? ''} onChange={v => set('message', v)}
                    placeholder="Flujo ejecutado correctamente. BCV: {{bcv.bcv_rate}}" rows={3} />
            </Field>
            <Field label="Nivel">
                <Select value={cfg.level ?? 'info'} onChange={v => set('level', v)} options={[
                    { value: 'info',    label: 'Info (normal)'    },
                    { value: 'success', label: 'Éxito'            },
                    { value: 'warning', label: 'Advertencia'      },
                    { value: 'error',   label: 'Error'            },
                ]} />
            </Field>
        </div>
    );
}

function BcvForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-800">
                <CheckCircle className="w-4 h-4 inline mr-1.5" />
                Este nodo consulta la tasa oficial BCV automáticamente. No requiere credenciales.
            </div>
            <Field label="Umbral de alerta (opcional)" hint="Si la tasa supera este valor, el log se marca como warning">
                <Input value={cfg.threshold ?? ''} onChange={v => set('threshold', v)} placeholder="40.00" type="number" />
            </Field>
            <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
                <strong>Retorna:</strong> <code>bcv_rate</code>, <code>source</code>, <code>timestamp</code>
                <br />
                <strong>Usar en Email:</strong> <code>{'{{id_nodo.bcv_rate}}'}</code>
            </div>
        </div>
    );
}

function DelayForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <Field label="Esperar" hint="Máximo 25 segundos en Edge Functions">
                <div className="flex gap-2">
                    <Input value={String(cfg.seconds ?? '5')} onChange={v => set('seconds', v)} type="number" />
                    <span className="flex items-center text-sm text-gray-500 px-2">segundos</span>
                </div>
            </Field>
        </div>
    );
}

function IndicadoresForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-sm text-indigo-800">
                <Info className="w-4 h-4 inline mr-1.5" />
                Consulta el Sistema de Indicadores de Gestión y retorna los KPIs según el filtro.
            </div>
            <Field label="Filtrar por estado" hint="Qué indicadores traer">
                <Select value={cfg.status ?? 'all'} onChange={v => set('status', v)} options={[
                    { value: 'all',         label: 'Todos los indicadores'       },
                    { value: 'critical',    label: 'Solo críticos 🔴'            },
                    { value: 'at_risk',     label: 'Solo en riesgo 🟡'           },
                    { value: 'critical,at_risk', label: 'Críticos + En riesgo'  },
                    { value: 'achieved',    label: 'Solo logrados ✅'            },
                ]} />
            </Field>
            <Field label="Filtrar por área (opcional)" hint="Dejar vacío = todas las áreas">
                <Input value={cfg.area ?? ''} onChange={v => set('area', v)} placeholder="Finanzas, Operaciones, Ventas..." />
            </Field>
            <Field label="Límite de resultados">
                <Input value={String(cfg.limit ?? '20')} onChange={v => set('limit', v)} type="number" placeholder="20" />
            </Field>
            <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
                <strong>Retorna:</strong> <code>indicators[]</code>, <code>count</code>, <code>critical_count</code>, <code>at_risk_count</code>
            </div>
        </div>
    );
}

function IndicadorCriticoForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-800">
                <Info className="w-4 h-4 inline mr-1.5" />
                Este trigger activa el flujo si encuentra indicadores en estado crítico o en riesgo.
            </div>
            <Field label="Activar cuando haya" hint="Condición para disparar el flujo">
                <Select value={cfg.trigger_on ?? 'critical'} onChange={v => set('trigger_on', v)} options={[
                    { value: 'critical',         label: 'Al menos 1 crítico 🔴'        },
                    { value: 'at_risk',          label: 'Al menos 1 en riesgo 🟡'      },
                    { value: 'critical,at_risk', label: 'Crítico O en riesgo'           },
                    { value: 'any',              label: 'Siempre (cualquier estado)'    },
                ]} />
            </Field>
            <Field label="Área a monitorear (opcional)">
                <Input value={cfg.area ?? ''} onChange={v => set('area', v)} placeholder="Finanzas (vacío = todas)" />
            </Field>
        </div>
    );
}

function SemaforoForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-yellow-800">
                <Info className="w-4 h-4 inline mr-1.5" />
                Evalúa un valor numérico contra umbrales y devuelve color (verde/amarillo/rojo) y etiqueta.
            </div>
            <Field label="Valor a evaluar" hint="Usa {{previous.campo}} para referenciar nodo anterior">
                <Input value={cfg.value ?? ''} onChange={v => set('value', v)} placeholder="{{previous.critical_count}}" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Umbral rojo (≥)" hint="Valor que activa alerta crítica">
                    <Input value={String(cfg.umbral_rojo ?? '3')} onChange={v => set('umbral_rojo', v)} type="number" />
                </Field>
                <Field label="Umbral amarillo (≥)" hint="Valor que activa advertencia">
                    <Input value={String(cfg.umbral_amarillo ?? '1')} onChange={v => set('umbral_amarillo', v)} type="number" />
                </Field>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-1">
                <div>🔴 <strong>Rojo</strong>: valor ≥ umbral_rojo</div>
                <div>🟡 <strong>Amarillo</strong>: valor ≥ umbral_amarillo</div>
                <div>🟢 <strong>Verde</strong>: valor por debajo de ambos umbrales</div>
                <div className="pt-1"><strong>Retorna:</strong> <code>color</code>, <code>label</code>, <code>value</code></div>
            </div>
        </div>
    );
}

function EeffForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-800">
                <Info className="w-4 h-4 inline mr-1.5" />
                Conecta con el sistema de Estados Financieros (3 empresas con períodos cargados).
            </div>
            <Field label="Empresa" hint="Nombre exacto o parcial. Vacío = primera empresa encontrada">
                <Input value={cfg.company ?? ''} onChange={v => set('company', v)}
                    placeholder="Ej: Seguros, Inversiones... (o vacío para la primera)" />
            </Field>
            <Field label="Tipo de consulta">
                <Select value={cfg.query_type ?? 'summary'} onChange={v => set('query_type', v)} options={[
                    { value: 'summary',   label: 'Resumen del último período'        },
                    { value: 'variacion', label: 'Comparar períodos (actual vs ant.)' },
                    { value: 'all',       label: 'Todas las empresas y períodos'     },
                ]} />
            </Field>
            <Field label="Nombre del período (opcional)" hint="Ej: Enero 2025. Vacío = último período no cerrado">
                <Input value={cfg.periodo ?? ''} onChange={v => set('periodo', v)} placeholder="Enero 2025" />
            </Field>
            <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
                <strong>Retorna:</strong> <code>empresa</code>, <code>periodo</code>, <code>ingresos_total</code>, <code>egresos_total</code>, <code>utilidad_neta</code>, <code>margen_pct</code>
            </div>
        </div>
    );
}

const REPORTE_TEMPLATE = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff">
  <div style="background:linear-gradient(135deg,#1e1b4b,#4f46e5);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">📊 Reporte de Gestión</h1>
    <p style="color:#a5b4fc;margin:8px 0 0;font-size:14px">Informe ejecutivo generado automáticamente</p>
  </div>
  <div style="padding:28px 24px;background:#f8fafc">
    <h2 style="color:#1e1b4b;font-size:16px;margin:0 0 16px">Estado de Indicadores</h2>
    {{summary}}
    <p style="color:#9ca3af;font-size:11px;margin-top:24px;text-align:center">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`;

function ReporteGerencialForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <Field label="Para (destinatario)">
                <Input value={cfg.to ?? ''} onChange={v => set('to', v)} placeholder="gerencia@empresa.com" type="email" />
            </Field>
            <Field label="Asunto">
                <Input value={cfg.subject ?? ''} onChange={v => set('subject', v)} placeholder="📊 Reporte Semanal de Gestión — {{previous.label}}" />
            </Field>
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-semibold text-gray-700">Cuerpo del reporte</label>
                    <button
                        type="button"
                        onClick={() => { set('subject', '📊 Reporte Gerencial — {{previous.label}}'); set('body', REPORTE_TEMPLATE); }}
                        className="text-xs px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg transition-colors font-medium"
                    >
                        📊 Usar plantilla gerencial
                    </button>
                </div>
                <Textarea value={cfg.body ?? ''} onChange={v => set('body', v)}
                    placeholder="Usa el botón para cargar la plantilla ejecutiva, o escribe el contenido manualmente."
                    rows={5} />
                <p className="text-xs text-gray-400 mt-1">
                    Variables: <code className="bg-gray-100 px-1 rounded">{'{{summary}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{previous.critical_count}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{previous.label}}'}</code>
                </p>
            </div>
        </div>
    );
}

function AprobacionForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    const ROLES = [
        { value: 'admin',            label: 'Administrador' },
        { value: 'supervisor',       label: 'Supervisor' },
        { value: 'autorizador',      label: 'Autorizador' },
        { value: 'gerente_riesgos',  label: 'Gerente de Riesgos' },
        { value: 'cumplimiento',     label: 'Cumplimiento' },
        { value: 'actuario',         label: 'Actuario' },
    ];

    const MOTIVOS_RAPIDOS = [
        { label: '🔍 OFAC/PEP', value: 'Persona {{previous.nombre_buscado}} encontrada en lista {{previous.hits.0.tipo_lista}}. Motivo: {{previous.hits.0.motivo}}. Revisar antes de continuar.' },
        { label: '💰 Monto alto', value: 'Transacción de alto monto requiere autorización. Monto: {{previous.monto}}. Revisar políticas internas.' },
        { label: '🚨 Siniestro', value: 'Siniestro {{previous.id}} requiere revisión manual. Monto reclamado: {{previous.monto_reclamado}}.' },
        { label: '📋 General',   value: 'Este paso requiere revisión y aprobación antes de continuar el proceso.' },
    ];

    return (
        <div className="space-y-4">
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                <UserCheck className="w-4 h-4 inline mr-1.5" />
                El flujo pausará aquí y esperará aprobación manual antes de continuar.
            </div>

            <Field label="Rol aprobador" hint="Quién debe aprobar este paso">
                <Select value={cfg.approver ?? 'admin'} onChange={v => set('approver', v)} options={ROLES} />
            </Field>

            <Field label="Horas para aprobar" hint="Si nadie aprueba en este tiempo, el flujo se cancela automáticamente">
                <div className="flex gap-2 items-center">
                    <Input value={String(cfg.horasVence ?? '48')} onChange={v => set('horasVence', v)} type="number" placeholder="48" />
                    <span className="text-sm text-gray-500 whitespace-nowrap">horas</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                    {cfg.horasVence
                        ? `Vence en ${cfg.horasVence}h — ${cfg.horasVence <= 24 ? '⚠ Urgente' : cfg.horasVence <= 72 ? 'Normal' : '📅 Plazo largo'}`
                        : 'Por defecto: 48 horas'}
                </p>
            </Field>

            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Instrucción al aprobador</label>
                <p className="text-xs text-gray-400 mb-2">Atajos rápidos — haz clic para insertar:</p>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                    {MOTIVOS_RAPIDOS.map(m => (
                        <button key={m.label} type="button" onClick={() => set('reason', m.value)}
                            className="text-left text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 transition-colors">
                            {m.label}
                        </button>
                    ))}
                </div>
                <Textarea value={cfg.reason ?? ''} onChange={v => set('reason', v)}
                    placeholder="Selecciona un atajo arriba o escribe la instrucción al aprobador." rows={3} />
                <p className="text-xs text-gray-400 mt-1">
                    Variables: <code className="bg-gray-100 px-1 rounded">{'{{previous.nombre_buscado}}'}</code>{' '}
                    <code className="bg-gray-100 px-1 rounded">{'{{previous.hits.0.tipo_lista}}'}</code>
                </p>
            </div>
        </div>
    );
}

const NO_COINCIDENCIA_TEMPLATE = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">
  <div style="background:linear-gradient(135deg,#14532d,#16a34a);padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">✅ Verificación Sin Observaciones</h1>
    <p style="color:#bbf7d0;margin:8px 0 0;font-size:13px">Verificación OFAC/PEP/ONU — HermesAI Flow</p>
  </div>
  <div style="padding:24px;background:#f8fafc">
    <p style="color:#374151;font-size:14px">La persona verificada <strong>no aparece</strong> en las listas restrictivas consultadas.</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;border:1px solid #e5e7eb;margin:16px 0">
      <tr style="background:#f0fdf4"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Nombre verificado</td><td style="padding:12px 16px;font-size:13px;font-weight:700;color:#15803d">{{previous.nombre_buscado}}</td></tr>
      <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Documento</td><td style="padding:12px 16px;font-size:13px;color:#374151">{{previous.documento_buscado}}</td></tr>
      <tr style="background:#f0fdf4"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Resultado</td><td style="padding:12px 16px;font-size:13px;font-weight:700;color:#15803d">Sin coincidencias</td></tr>
      <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Fecha verificación</td><td style="padding:12px 16px;font-size:13px;color:#374151">{{previous.timestamp}}</td></tr>
    </table>
    <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px">
      <p style="margin:0;font-size:13px;color:#14532d">El proceso puede continuar sin restricciones.</p>
    </div>
    <p style="color:#9ca3af;font-size:11px;text-align:center">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`;

const OFAC_EMAIL_TEMPLATE = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">
  <div style="background:linear-gradient(135deg,#7f1d1d,#dc2626);padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">⚠️ Alerta Listas Restrictivas</h1>
    <p style="color:#fca5a5;margin:8px 0 0;font-size:13px">Verificación OFAC/PEP/ONU — HermesAI Flow</p>
  </div>
  <div style="padding:24px;background:#f8fafc">
    <p style="color:#374151;font-size:14px">Se detectó una coincidencia en las listas restrictivas:</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;border:1px solid #e5e7eb;margin:16px 0">
      <tr style="background:#fef2f2"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Nombre buscado</td><td style="padding:12px 16px;font-size:13px;font-weight:700;color:#dc2626">{{previous.nombre_buscado}}</td></tr>
      <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Lista</td><td style="padding:12px 16px;font-size:13px;color:#374151">{{previous.hits.0.tipo_lista}}</td></tr>
      <tr style="background:#fef2f2"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Nombre en lista</td><td style="padding:12px 16px;font-size:13px;color:#374151">{{previous.hits.0.nombre}}</td></tr>
      <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">País</td><td style="padding:12px 16px;font-size:13px;color:#374151">{{previous.hits.0.pais}}</td></tr>
      <tr style="background:#fef2f2"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Motivo</td><td style="padding:12px 16px;font-size:13px;color:#374151">{{previous.hits.0.motivo}}</td></tr>
    </table>
    <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px">
      <p style="margin:0;font-size:13px;color:#92400e"><strong>Acción requerida:</strong> Este proceso requiere revisión y aprobación antes de continuar.</p>
    </div>
    <p style="color:#9ca3af;font-size:11px;text-align:center">HermesAI Flow · Automatización Inteligente de Procesos</p>
  </div>
</div>`;

function AmlForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    const LISTAS_DISPONIBLES = ['OFAC', 'PEP', 'ONU', 'UE', 'LOCAL', 'INTERPOL'];
    const listasSeleccionadas: string[] = cfg.listas ?? ['OFAC', 'PEP', 'ONU', 'UE'];

    const toggleLista = (lista: string) => {
        const nuevas = listasSeleccionadas.includes(lista)
            ? listasSeleccionadas.filter(l => l !== lista)
            : [...listasSeleccionadas, lista];
        set('listas', nuevas.length > 0 ? nuevas : ['OFAC']);
    };

    return (
        <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-800">
                <Shield className="w-4 h-4 inline mr-1.5" />
                Consulta las listas OFAC, PEP, ONU y UE en RiskGuard. Devuelve si la persona está o no en lista.
            </div>

            <Field label="Nombre de la persona a verificar" hint="Nombre completo tal como aparece en los documentos">
                <Input value={cfg.nombre ?? ''} onChange={v => set('nombre', v)}
                    placeholder="Ej: Juan Carlos Pérez García" />
            </Field>

            <Field label="Cédula / RIF / Pasaporte (opcional)" hint="Búsqueda exacta por documento — más precisa que por nombre">
                <Input value={cfg.documento ?? ''} onChange={v => set('documento', v)}
                    placeholder="Ej: V-12345678 ó J-123456789" />
            </Field>

            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Listas a consultar</label>
                <p className="text-xs text-gray-400 mb-2">Selecciona las listas que deseas verificar:</p>
                <div className="flex flex-wrap gap-2">
                    {LISTAS_DISPONIBLES.map(lista => (
                        <button key={lista} type="button" onClick={() => toggleLista(lista)}
                            className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${
                                listasSeleccionadas.includes(lista)
                                    ? 'bg-red-600 text-white border-red-600'
                                    : 'bg-white text-gray-500 border-gray-200 hover:border-red-300'
                            }`}>
                            {lista}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-1">
                <p className="font-semibold text-gray-600">El nodo devuelve estos datos para usar en Decisión y Email:</p>
                <div className="grid grid-cols-2 gap-1 mt-1">
                    {[
                        ['en_lista', 'true / false'],
                        ['hit_count', 'número de coincidencias'],
                        ['nombre_buscado', 'nombre consultado'],
                        ['hits.0.tipo_lista', 'OFAC / PEP / ONU...'],
                        ['hits.0.nombre', 'nombre en la lista'],
                        ['hits.0.motivo', 'razón de inclusión'],
                    ].map(([k, v]) => (
                        <div key={k}>
                            <code className="bg-gray-200 px-1 rounded text-indigo-700">{`{{previous.${k}}}`}</code>
                            <span className="text-gray-400 ml-1">{v}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function GenericForm({ cfg, set, nodeTitle }: { cfg: any; set: (k: string, v: any) => void; nodeTitle: string }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
                <Info className="w-4 h-4 inline mr-1.5" />
                El nodo <strong>{nodeTitle}</strong> se conectará a RiskGuard/LegalTech en Sprint S2.
                Por ahora puedes darle un nombre descriptivo.
            </div>
            <Field label="Etiqueta del nodo (opcional)">
                <Input value={cfg.label ?? ''} onChange={v => set('label', v)} placeholder="Ej: Verificar póliza cliente..." />
            </Field>
            <Field label="Notas" hint="Descripción de qué hace este nodo en el proceso">
                <Textarea value={cfg.notes ?? ''} onChange={v => set('notes', v)} placeholder="Este nodo verifica..." rows={3} />
            </Field>
        </div>
    );
}

// ── Mapa de ícono por categoría ───────────────────────────────────────────────
const ICON_MAP: Record<string, React.ComponentType<any>> = {
    cron:         Clock,
    manual:       Play,
    webhook:      Zap,
    email:        Mail,
    decision:     GitBranch,
    log:          FileText,
    delay:        Timer,
    bcv:          TrendingUp,
    riskguard:    AlertTriangle,
    aml:          Shield,
    notificacion: Bell,
    inventario:   Package,
    aprobacion:   UserCheck,
    erp:          Database,
};

const FORM_MAP: Record<string, (cfg: any, set: (k: string, v: any) => void, title: string) => React.ReactNode> = {
    cron:    (c, s)    => <CronForm cfg={c} set={s} />,
    manual:  ()        => <ManualTriggerForm />,
    email:   (c, s)    => <EmailForm cfg={c} set={s} />,
    decision:(c, s)    => <DecisionForm cfg={c} set={s} />,
    log:     (c, s)    => <LogForm cfg={c} set={s} />,
    bcv:          (c, s) => <BcvForm cfg={c} set={s} />,
    delay:        (c, s) => <DelayForm cfg={c} set={s} />,
    aprobacion:   (c, s) => <AprobacionForm cfg={c} set={s} />,
    aml:          (c, s) => <AmlForm cfg={c} set={s} />,
    // category 'indicadores' cubre tanto Leer Indicadores como Alerta KPI Crítico
    indicadores:  (c, s, title) => title.includes('lerta') || title.includes('Alerta')
        ? <IndicadorCriticoForm cfg={c} set={s} />
        : <IndicadoresForm cfg={c} set={s} />,
    semaforo:     (c, s) => <SemaforoForm cfg={c} set={s} />,
    eeff:         (c, s) => <EeffForm cfg={c} set={s} />,
    reporte:      (c, s) => <ReporteGerencialForm cfg={c} set={s} />,
};

// ── Auto-completado por contexto del nodo anterior ───────────────────────────
function getAutoDefaults(node: WorkflowNodeData, prevNode: WorkflowNodeData | null): Record<string, any> {
    if (!prevNode) return {};
    const defaults: Record<string, any> = {};

    // Aprobación después de OFAC → pre-llenar rol y motivo
    if (node.category === 'aprobacion' && prevNode.category === 'aml') {
        if (!node.config?.approver) defaults.approver = 'admin';
        if (!node.config?.horasVence) defaults.horasVence = '48';
        if (!node.config?.reason)
            defaults.reason = 'Persona {{previous.nombre_buscado}} encontrada en lista {{previous.hits.0.tipo_lista}}. Motivo: {{previous.hits.0.motivo}}. Revisar antes de continuar.';
    }

    // Decisión después de OFAC → pre-llenar condición
    if (node.category === 'decision' && prevNode.category === 'aml') {
        if (!node.config?.left)     defaults.left     = '{{previous.en_lista}}';
        if (!node.config?.operator) defaults.operator = '==';
        if (!node.config?.right)    defaults.right    = 'true';
    }

    // Email después de OFAC → pre-llenar asunto y plantilla completa
    if (node.category === 'email' && prevNode.category === 'aml') {
        if (!node.config?.subject)
            defaults.subject = '⚠️ Alerta Listas Restrictivas — {{previous.nombre_buscado}}';
        if (!node.config?.body)
            defaults.body = OFAC_EMAIL_TEMPLATE;
    }

    // Email después de aprobación → pre-llenar asunto y plantilla OFAC (datos del nodo AML siguen en contexto)
    if (node.category === 'email' && prevNode.category === 'aprobacion') {
        if (!node.config?.subject)
            defaults.subject = '✅ Alerta OFAC aprobada — {{previous.nombre_buscado}}';
        if (!node.config?.body)
            defaults.body = OFAC_EMAIL_TEMPLATE;
    }

    return defaults;
}

// ── Componente principal ──────────────────────────────────────────────────────
const NodeConfigPanel: React.FC<Props> = ({ node, prevNode, isOpen, onClose, onSave }) => {
    const [cfg, setCfg] = useState<Record<string, any>>({});

    useEffect(() => {
        if (node) {
            const autoDefaults = getAutoDefaults(node, prevNode);
            setCfg({ ...autoDefaults, ...(node.config ?? {}) });
        }
    }, [node, prevNode]);

    if (!isOpen || !node) return null;

    const set = (k: string, v: any) => setCfg(prev => ({ ...prev, [k]: v }));

    const handleSave = () => { onSave(node.id, cfg); onClose(); };

    const Icon      = ICON_MAP[node.category] ?? FileText;
    const formFn    = FORM_MAP[node.category];
    const formNode  = formFn ? formFn(cfg, set, node.title) : <GenericForm cfg={cfg} set={set} nodeTitle={node.title} />;

    const TYPE_COLOR: Record<string, string> = {
        trigger:   'bg-green-100 text-green-700',
        processor: 'bg-blue-100  text-blue-700',
        output:    'bg-purple-100 text-purple-700',
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
                            <Icon className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-900 text-sm leading-tight">{node.title}</h2>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLOR[node.type]}`}>
                                {node.type === 'trigger' ? 'Trigger' : node.type === 'processor' ? 'Proceso' : 'Salida'}
                            </span>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {/* Banner de auto-completado */}
                    {prevNode && Object.keys(getAutoDefaults(node, prevNode)).length > 0 && (
                        <div className="flex items-start gap-2 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
                            <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-indigo-500" />
                            <span>
                                <strong>Auto-completado</strong> — detecté que el nodo anterior es <strong>{prevNode.title}</strong>.
                                Los campos han sido pre-llenados con las variables correctas. Puedes editarlos si necesitas cambiarlos.
                            </span>
                        </div>
                    )}
                    {formNode}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                    >
                        Guardar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NodeConfigPanel;
