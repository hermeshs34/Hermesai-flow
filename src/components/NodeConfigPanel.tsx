import React, { useState, useEffect } from 'react';
import {
    X, Mail, Clock, GitBranch, FileText, Timer,
    Shield, TrendingUp, Bell, Package, UserCheck,
    Database, Play, Zap, AlertTriangle, CheckCircle,
    Info,
} from 'lucide-react';
import type { WorkflowNodeData } from '../types/workflow';

interface Props {
    node:    WorkflowNodeData | null;
    isOpen:  boolean;
    onClose: () => void;
    onSave:  (nodeId: string, config: Record<string, any>) => void;
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
    const applyBcvTemplate = () => {
        set('subject', '📊 Tasa BCV del día — {{previous.bcv_rate}} Bs/USD');
        set('body', BCV_TEMPLATE);
    };

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
                    <button
                        type="button"
                        onClick={applyBcvTemplate}
                        className="text-xs px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition-colors font-medium"
                    >
                        📊 Usar plantilla BCV
                    </button>
                </div>
                <Textarea value={cfg.body ?? ''} onChange={v => set('body', v)}
                    placeholder="Hola,&#10;&#10;Tasa BCV hoy: {{previous.bcv_rate}}&#10;&#10;O usa el botón 'Plantilla BCV' arriba para un diseño profesional."
                    rows={6} />
                <p className="text-xs text-gray-400 mt-1">
                    Variables disponibles: <code className="bg-gray-100 px-1 rounded">{'{{previous.bcv_rate}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{previous.timestamp}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{summary}}'}</code>
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
    bcv:     (c, s)    => <BcvForm cfg={c} set={s} />,
    delay:   (c, s)    => <DelayForm cfg={c} set={s} />,
};

// ── Componente principal ──────────────────────────────────────────────────────
const NodeConfigPanel: React.FC<Props> = ({ node, isOpen, onClose, onSave }) => {
    const [cfg, setCfg] = useState<Record<string, any>>({});

    useEffect(() => { if (node) setCfg(node.config ?? {}); }, [node]);

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
                <div className="flex-1 overflow-y-auto px-5 py-4">
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
