import React, { useState, useEffect } from 'react';
import {
    X, Mail, Clock, GitBranch, FileText, Timer,
    Shield, TrendingUp, Bell, Package, UserCheck,
    Database, Play, Zap, AlertTriangle, CheckCircle,
    Info, BrainCircuit, MessageCircle,
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

// ── Selector visual de programación ──────────────────────────────────────────

const DIAS_SEMANA = [
    { id: '1', label: 'L' }, { id: '2', label: 'M' }, { id: '3', label: 'X' },
    { id: '4', label: 'J' }, { id: '5', label: 'V' }, { id: '6', label: 'S' },
    { id: '0', label: 'D' },
];

const HORAS = Array.from({ length: 24 }, (_, i) => ({
    value: String(i),
    label: `${String(i).padStart(2, '0')}:00`,
}));

const DIAS_MES = Array.from({ length: 28 }, (_, i) => ({
    value: String(i + 1),
    label: `Día ${i + 1}`,
}));

type Frecuencia = 'manual' | 'diario' | 'semanal' | 'mensual' | 'avanzado';

// La hora que se elige aquí es la de Venezuela. El motor (cron-runner) compara
// contra America/Caracas desde el 07/08/2026; antes comparaba contra UTC y un
// "9:00" saltaba a las 5 de la mañana.
const ZONA_TEXTO = 'hora de Venezuela';

function cronToUI(cron: string): { frecuencia: Frecuencia; hora: string; dias: string[]; diaMes: string } {
    // Cron vacío es "manual", no "diario". Devolver 'diario' aquí hacía que un
    // nodo puesto en Manual reapareciera como Diario a las 9:00 al reabrirlo.
    if (!cron) return { frecuencia: 'manual', hora: '9', dias: ['1','2','3','4','5'], diaMes: '1' };
    const parts = cron.split(' ');
    if (parts.length !== 5) return { frecuencia: 'avanzado', hora: '9', dias: ['1','2','3','4','5'], diaMes: '1' };
    const [, h, dom, , dow] = parts;
    const hora = h.replace('*', '9');
    if (dom !== '*') return { frecuencia: 'mensual', hora, dias: [], diaMes: dom };
    if (dow === '*') return { frecuencia: 'diario', hora, dias: [], diaMes: '1' };
    const dias = dow.split('-').length === 2
        ? DIAS_SEMANA.slice(
            DIAS_SEMANA.findIndex(d => d.id === dow.split('-')[0]),
            DIAS_SEMANA.findIndex(d => d.id === dow.split('-')[1]) + 1
          ).map(d => d.id)
        : dow.split(',');
    return { frecuencia: 'semanal', hora, dias, diaMes: '1' };
}

function uiToCron(frecuencia: Frecuencia, hora: string, dias: string[], diaMes: string): string {
    const h = hora || '9';
    if (frecuencia === 'manual')   return '';
    if (frecuencia === 'diario')   return `0 ${h} * * *`;
    if (frecuencia === 'mensual')  return `0 ${h} ${diaMes} * *`;
    if (frecuencia === 'semanal') {
        const sorted = [...dias].sort();
        const dow = sorted.length === 5 && sorted.join(',') === '1,2,3,4,5'
            ? '1-5' : sorted.join(',') || '1';
        return `0 ${h} * * ${dow}`;
    }
    return '';
}

function CronForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    const ui = cronToUI(cfg.cron ?? '0 9 * * 1-5');
    const [frecuencia, setFrecuencia] = React.useState<Frecuencia>(ui.frecuencia);
    const [hora,       setHora]       = React.useState(ui.hora);
    const [dias,       setDias]       = React.useState<string[]>(ui.dias);
    const [diaMes,     setDiaMes]     = React.useState(ui.diaMes);
    const [showCron,   setShowCron]   = React.useState(false);

    // Si el cron cambia por fuera —al abrir otro nodo con este panel ya montado,
    // o al terminar de cargar el flujo— hay que volver a leerlo. Sin esto el
    // formulario se quedaba con lo que tenía al montarse y, en cuanto tocabas
    // cualquier campo, `apply` reescribía ESE valor viejo encima del guardado:
    // de ahí que la hora "se cambiara sola" a las 9:00 sin que nadie la tocara.
    React.useEffect(() => {
        const u = cronToUI(cfg.cron ?? '0 9 * * 1-5');
        setFrecuencia(u.frecuencia);
        setHora(u.hora);
        setDias(u.dias);
        setDiaMes(u.diaMes);
    }, [cfg.cron]);

    const apply = (f: Frecuencia, h: string, d: string[], dm: string) => {
        // Manual guarda cron VACÍO. Antes caía en el `|| '0 9 * * 1-5'` y elegir
        // "Manual" dejaba el nodo programado a diario a las 9 de la mañana, que
        // es justo lo contrario de lo que pide el botón.
        set('cron', uiToCron(f, h, d, dm));
    };

    const handleFrecuencia = (f: Frecuencia) => {
        setFrecuencia(f);
        const defaultDias = f === 'semanal' ? ['1','2','3','4','5'] : dias;
        if (f === 'semanal') setDias(defaultDias);
        apply(f, hora, defaultDias, diaMes);
    };

    const handleHora = (h: string) => { setHora(h); apply(frecuencia, h, dias, diaMes); };
    const handleDiaMes = (dm: string) => { setDiaMes(dm); apply(frecuencia, hora, dias, dm); };
    const toggleDia = (id: string) => {
        const next = dias.includes(id) ? dias.filter(d => d !== id) : [...dias, id];
        if (next.length === 0) return;
        setDias(next);
        apply(frecuencia, hora, next, diaMes);
    };

    const resumen = () => {
        if (frecuencia === 'manual')  return 'Solo manualmente (botón Ejecutar)';
        const h = `${HORAS.find(x => x.value === hora)?.label ?? `${hora}:00`} (${ZONA_TEXTO})`;
        if (frecuencia === 'diario')  return `Todos los días a las ${h}`;
        if (frecuencia === 'mensual') return `El día ${diaMes} de cada mes a las ${h}`;
        if (frecuencia === 'semanal') {
            const labels = DIAS_SEMANA.filter(d => dias.includes(d.id)).map(d =>
                ['L','M','X','J','V'].includes(d.label)
                    ? { L:'Lunes', M:'Martes', X:'Miércoles', J:'Jueves', V:'Viernes', S:'Sábado', D:'Domingo' }[d.label]
                    : d.label
            );
            return `${labels.join(', ')} a las ${h}`;
        }
        return cfg.cron;
    };

    const FREQ_OPTIONS: { id: Frecuencia; icon: string; label: string }[] = [
        { id: 'manual',   icon: '▶', label: 'Manual'    },
        { id: 'diario',   icon: '📅', label: 'Diario'   },
        { id: 'semanal',  icon: '📆', label: 'Semanal'  },
        { id: 'mensual',  icon: '🗓', label: 'Mensual'  },
        { id: 'avanzado', icon: '⚙', label: 'Avanzado' },
    ];

    return (
        <div className="space-y-4">
            {/* Frecuencia */}
            <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">¿Con qué frecuencia?</p>
                <div className="grid grid-cols-5 gap-1">
                    {FREQ_OPTIONS.map(f => (
                        <button
                            key={f.id}
                            onClick={() => handleFrecuencia(f.id)}
                            className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs font-medium transition-colors ${
                                frecuencia === f.id
                                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                                    : 'border-gray-200 text-gray-500 hover:border-indigo-300 hover:bg-indigo-50'
                            }`}
                        >
                            <span className="text-base leading-none">{f.icon}</span>
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Hora */}
            {frecuencia !== 'manual' && frecuencia !== 'avanzado' && (
                <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">
                        ¿A qué hora? <span className="font-normal text-gray-400">({ZONA_TEXTO})</span>
                    </p>
                    <select
                        value={hora}
                        onChange={e => handleHora(e.target.value)}
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                        {HORAS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                </div>
            )}

            {/* Días de semana */}
            {frecuencia === 'semanal' && (
                <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">¿Qué días?</p>
                    <div className="flex gap-1.5">
                        {DIAS_SEMANA.map(d => (
                            <button
                                key={d.id}
                                onClick={() => toggleDia(d.id)}
                                className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                                    dias.includes(d.id)
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'border-gray-200 text-gray-500 hover:border-indigo-300'
                                }`}
                            >
                                {d.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Día del mes */}
            {frecuencia === 'mensual' && (
                <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">¿Qué día del mes?</p>
                    <select
                        value={diaMes}
                        onChange={e => handleDiaMes(e.target.value)}
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                        {DIAS_MES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                </div>
            )}

            {/* Avanzado — campo cron directo */}
            {frecuencia === 'avanzado' && (
                <Field label="Expresión Cron" hint={`minuto hora día-mes mes día-semana — en ${ZONA_TEXTO}`}>
                    <Input value={cfg.cron ?? '0 9 * * 1-5'} onChange={v => set('cron', v)} placeholder="0 9 * * 1-5" />
                </Field>
            )}

            {/* Resumen en lenguaje natural */}
            {frecuencia !== 'avanzado' && (
                <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
                    <p className="text-xs text-indigo-700 font-medium">
                        📋 Este flujo se ejecutará: <strong>{resumen()}</strong>
                    </p>
                </div>
            )}

            {/* Toggle para ver/ocultar cron técnico */}
            <button
                onClick={() => setShowCron(s => !s)}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
                {showCron ? 'Ocultar' : 'Ver'} expresión cron técnica
            </button>
            {showCron && (
                <div className="font-mono text-xs bg-gray-100 rounded px-3 py-2 text-gray-600">
                    {cfg.cron || '(sin programación)'}
                </div>
            )}

            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                <Info className="w-3.5 h-3.5 inline mr-1" />
                Para probar el flujo ahora, usa el botón <strong>Ejecutar</strong> en el canvas.
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
            <Field label="Remitente (opcional)" hint="Dejar vacío usa el remitente por defecto del sistema">
                <Input value={cfg.from ?? ''} onChange={v => set('from', v)} placeholder="Mi Empresa <alertas@miempresa.com>" />
            </Field>
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                <Info className="w-3.5 h-3.5 inline mr-1" />
                El canal de envío se configura con secrets en Supabase → Settings → Edge Functions y lo puedes ver en{' '}
                <strong>Configuración → Estado del Sistema</strong>. Si el canal activo es SMTP, el <strong>nombre</strong>{' '}
                del remitente se respeta pero la <strong>dirección</strong> pasa a ser la de la cuenta de envío, y la que
                escribas aquí queda como <em>Reply-To</em>.
            </div>
        </div>
    );
}

function WhatsAppForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    const PLANTILLAS = [
        {
            id: 'alerta',
            label: '⚠️ Alerta',
            apply: () => set('message',
                '⚠️ *Alerta HermesAI Flow*\n\nSe detectó una condición que requiere tu atención:\n{{previous.motivo}}\n\nRevisa el sistema para más detalles.'),
        },
        {
            id: 'aprobacion',
            label: '✋ Aprobación',
            apply: () => set('message',
                '✋ *Aprobación pendiente — HermesAI Flow*\n\nTienes una tarea de aprobación esperando tu decisión.\nIngresa a la Cola de Trabajo para resolverla.'),
        },
        {
            id: 'eeff',
            label: '📊 Cifras EE.FF.',
            apply: () => set('message',
                '📊 *Resumen EE.FF. — {{previous.empresa}}*\nPeríodo: {{previous.periodo}}\n\n• Activos: {{previous.activos}} {{previous.moneda}}\n• Ingresos: {{previous.ingresos}}\n• Utilidad Neta: {{previous.utilidad_neta}}\n• Margen: {{previous.margen_pct}}'),
        },
    ];

    return (
        <div className="space-y-4">
            <Field label="Número destino" hint="Formato internacional con +, ej: +584141234567">
                <Input value={cfg.to ?? ''} onChange={v => set('to', v)} placeholder="+584141234567" />
            </Field>
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-semibold text-gray-700">Mensaje</label>
                    <div className="flex gap-1.5">
                        {PLANTILLAS.map(p => (
                            <button key={p.id} type="button" onClick={p.apply}
                                className="text-xs px-2.5 py-1 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg transition-colors font-medium">
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
                <Textarea value={cfg.message ?? ''} onChange={v => set('message', v)}
                    placeholder="Escribe el mensaje o usa una plantilla. Soporta *negritas* y variables {{previous.campo}}."
                    rows={6} />
                <p className="text-xs text-gray-400 mt-1">
                    Variables: <code className="bg-gray-100 px-1 rounded">{'{{previous.empresa}}'}</code>{' '}
                    <code className="bg-gray-100 px-1 rounded">{'{{previous.utilidad_neta}}'}</code>{' '}
                    <code className="bg-gray-100 px-1 rounded">{'{{previous.en_lista}}'}</code>
                </p>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                <Info className="w-3.5 h-3.5 inline mr-1" />
                Envío vía <strong>Twilio WhatsApp API</strong>. Secrets requeridos en Supabase → Edge Functions:{' '}
                <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_WHATSAPP_FROM</code>.
                En sandbox el destinatario debe unirse primero enviando el código <em>join</em> al número de Twilio.
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
            <div className="grid grid-cols-2 gap-3">
                <Field label="Moneda del reporte" hint="Vacío = moneda original del sistema">
                    <Select value={cfg.moneda_reporte ?? ''} onChange={v => set('moneda_reporte', v)} options={[
                        { value: '',    label: 'Original (del sistema)' },
                        { value: 'VES', label: 'Bolívares (VES)'        },
                        { value: 'USD', label: 'Dólares (USD)'          },
                        { value: 'EUR', label: 'Euros (EUR)'            },
                    ]} />
                </Field>
                <Field label="Tasa de conversión" hint="Solo si cambia de moneda. Ej: 105.5 (VES→USD)">
                    <Input value={String(cfg.tasa_conversion ?? '')} onChange={v => set('tasa_conversion', v)}
                        placeholder="Ej: 105.50" type="number" />
                </Field>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
                <strong>Retorna:</strong> <code>empresa</code>, <code>periodo</code>, <code>ingresos</code>, <code>gastos</code>, <code>utilidad_neta</code>, <code>margen_pct</code>, <code>periodos_disponibles</code>, <code>categorias_db</code>
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

function ReporteSudeasegForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800 flex items-start gap-2">
                <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Genera un reporte regulatorio estructurado con los datos del flujo. El resultado queda disponible para el nodo Email siguiente.</span>
            </div>
            <Field label="Tipo de reporte">
                <Select value={cfg.tipo ?? 'SUDEASEG'} onChange={v => set('tipo', v)} options={[
                    { value: 'SUDEASEG', label: 'SUDEASEG — Supervisión de Seguros' },
                    { value: 'SUDEBAN',  label: 'SUDEBAN — Supervisión Bancaria'    },
                ]} />
            </Field>
            <Field label="Período del reporte" hint="Ej: Mayo 2026, Q1 2026, Anual 2025">
                <Input value={cfg.periodo ?? ''} onChange={v => set('periodo', v)} placeholder="Mayo 2026" />
            </Field>
            <Field label="Empresa / Entidad" hint="Nombre de la aseguradora o institución">
                <Input value={cfg.empresa ?? ''} onChange={v => set('empresa', v)} placeholder="Ej: Seguros HermesAI C.A." />
            </Field>
            <Field label="Referencia del caso" hint="Número de caso, siniestro o expediente (opcional, acepta {{previous.campo}})">
                <Input value={cfg.referencia ?? ''} onChange={v => set('referencia', v)} placeholder="{{previous.nombre_buscado}}" />
            </Field>
            <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-1">
                <strong className="text-gray-700">Retorna para usar en Email/Log:</strong>
                <div className="grid grid-cols-2 gap-1 mt-1">
                    {['{{previous.reporte_texto}}','{{previous.tipo_reporte}}','{{previous.periodo}}','{{previous.referencia_caso}}'].map(f => (
                        <code key={f} className="bg-white border border-gray-200 px-1.5 py-0.5 rounded text-[10px]">{f}</code>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ReporteGerencialForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    return (
        <div className="space-y-4">
            <Field label="Para (destinatario)">
                <Input value={cfg.to ?? ''} onChange={v => set('to', v)} placeholder="gerencia@empresa.com" type="email" />
            </Field>
            <Field label="Asunto">
                <Input value={cfg.subject ?? ''} onChange={v => set('subject', v)} placeholder="📊 Reporte Gerencial — {{previous.empresa}} ({{previous.periodo}})" />
            </Field>
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-semibold text-gray-700">Cuerpo del reporte</label>
                    <button
                        type="button"
                        onClick={() => { set('subject', '📊 Reporte Gerencial — {{previous.empresa}} ({{previous.periodo}})'); set('body', REPORTE_TEMPLATE); }}
                        className="text-xs px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg transition-colors font-medium"
                    >
                        📊 Usar plantilla gerencial
                    </button>
                </div>
                <Textarea value={cfg.body ?? ''} onChange={v => set('body', v)}
                    placeholder="Usa el botón para cargar la plantilla ejecutiva, o escribe el contenido manualmente."
                    rows={5} />
                <p className="text-xs text-gray-400 mt-1">
                    Variables: <code className="bg-gray-100 px-1 rounded">{'{{summary}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{previous.empresa}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{previous.periodo}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{previous.analisis_ia}}'}</code>
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

function AgenteIAForm({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
    const modo = cfg.modo ?? 'analisis';

    const EJEMPLOS_PROMPT: { label: string; value: string }[] = [
        { label: '🔍 Analizar siniestro',    value: 'Analiza este siniestro y determina si es de alto riesgo. Datos: ramo={{previous.ramo}}, monto={{previous.monto_reclamado}}, estado={{previous.estado}}. Responde en JSON con campos: riesgo (alto/medio/bajo), justificacion, accion_recomendada.' },
        { label: '⚖️ Evaluar riesgo OFAC',   value: 'Evalúa el resultado de la verificación OFAC. Persona: {{previous.nombre_buscado}}, en_lista={{previous.en_lista}}, hits={{previous.hit_count}}. Responde en JSON con: decision (aprobar/rechazar/revisar), justificacion.' },
        { label: '📊 Resumen ejecutivo',     value: 'Genera un resumen ejecutivo de los indicadores de gestión. Datos: {{previous.resumen}}. El resumen debe ser en español, máximo 3 párrafos, con los puntos críticos y recomendaciones.' },
        { label: '💡 Sugerir controles',     value: 'Basado en el riesgo detectado (nivel={{previous.nivel}}, categoria={{previous.categoria}}), sugiere 3 controles preventivos concretos. Responde en JSON con array "controles": [{nombre, descripcion, responsable}].' },
    ];

    return (
        <div className="space-y-4">
            <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg text-sm text-violet-800 flex items-start gap-2">
                <BrainCircuit className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Claude analiza los datos del flujo y genera un resultado estructurado que los nodos siguientes pueden usar.</span>
            </div>

            <Field label="Modo" hint="Análisis: genera texto/JSON libre. Decisión: devuelve SI/NO para bifurcar el flujo.">
                <Select
                    value={modo}
                    onChange={v => set('modo', v)}
                    options={[
                        { value: 'analisis',  label: '📊 Análisis — genera texto o JSON' },
                        { value: 'decision',  label: '⚖️ Decisión — devuelve SI / NO' },
                    ]}
                />
            </Field>

            {modo === 'decision' && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                    En modo Decisión el nodo actúa como un nodo SI/NO: conecta dos salidas (rama SI y rama NO) y Claude decide cuál tomar basándose en el prompt.
                </div>
            )}

            <Field label="Modelo" hint="Sonnet para análisis rápidos, Opus para razonamiento complejo">
                <Select
                    value={cfg.modelo ?? 'claude-sonnet-4-6'}
                    onChange={v => set('modelo', v)}
                    options={[
                        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — Rápido y preciso' },
                        { value: 'claude-opus-4-8',   label: 'Claude Opus 4.8 — Máximo razonamiento' },
                    ]}
                />
            </Field>

            <Field label="Prompt" hint="Instrucción para Claude. Usa {{previous.campo}} para datos del flujo.">
                <div className="mb-2 flex flex-wrap gap-1.5">
                    {EJEMPLOS_PROMPT.map(e => (
                        <button
                            key={e.label}
                            type="button"
                            onClick={() => set('prompt', e.value)}
                            className="text-[10px] px-2 py-0.5 bg-violet-100 hover:bg-violet-200 text-violet-700 rounded-full transition-colors"
                        >
                            {e.label}
                        </button>
                    ))}
                </div>
                <Textarea
                    value={cfg.prompt ?? ''}
                    onChange={v => set('prompt', v)}
                    placeholder={'Analiza los datos del paso anterior y responde en JSON con los campos relevantes.\n\nUsa {{previous.campo}} para referenciar datos del flujo.'}
                    rows={6}
                />
            </Field>

            <Field label="Campo resultado" hint="Nombre del campo donde guardar la respuesta (para usar como {{previous.campo}} en nodos siguientes)">
                <Input
                    value={cfg.campo_resultado ?? 'analisis_ia'}
                    onChange={v => set('campo_resultado', v)}
                    placeholder="analisis_ia"
                />
            </Field>

            {modo === 'decision' && (
                <Field label="Condición SI" hint="Texto que Claude debe incluir en su respuesta para tomar la rama SI (no distingue mayúsculas)">
                    <Input
                        value={cfg.condicion_si ?? 'aprobar'}
                        onChange={v => set('condicion_si', v)}
                        placeholder='aprobar'
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Si la respuesta de Claude contiene este texto → rama SI. De lo contrario → rama NO.</p>
                </Field>
            )}

            <Field label="Contexto del sistema" hint="Instrucciones de rol para Claude (opcional)">
                <Textarea
                    value={cfg.system_prompt ?? ''}
                    onChange={v => set('system_prompt', v)}
                    placeholder="Eres un analista experto en seguros y reaseguros venezolanos, con conocimiento de normativa SUDEASEG y SUDEBAN."
                    rows={3}
                />
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
    agente:       BrainCircuit,
    whatsapp:     MessageCircle,
};

const FORM_MAP: Record<string, (cfg: any, set: (k: string, v: any) => void, title: string) => React.ReactNode> = {
    cron:    (c, s)    => <CronForm cfg={c} set={s} />,
    manual:  ()        => <ManualTriggerForm />,
    email:   (c, s)    => <EmailForm cfg={c} set={s} />,
    whatsapp:(c, s)    => <WhatsAppForm cfg={c} set={s} />,
    decision:(c, s)    => <DecisionForm cfg={c} set={s} />,
    log:     (c, s)    => <LogForm cfg={c} set={s} />,
    bcv:          (c, s) => <BcvForm cfg={c} set={s} />,
    delay:        (c, s) => <DelayForm cfg={c} set={s} />,
    aprobacion:   (c, s) => <AprobacionForm cfg={c} set={s} />,
    aml:          (c, s) => <AmlForm cfg={c} set={s} />,
    agente:       (c, s) => <AgenteIAForm cfg={c} set={s} />,
    // category 'indicadores' cubre tanto Leer Indicadores como Alerta KPI Crítico
    indicadores:  (c, s, title) => title.includes('lerta') || title.includes('Alerta')
        ? <IndicadorCriticoForm cfg={c} set={s} />
        : <IndicadoresForm cfg={c} set={s} />,
    semaforo:     (c, s) => <SemaforoForm cfg={c} set={s} />,
    eeff:         (c, s) => <EeffForm cfg={c} set={s} />,
    reporte:      (c, s) => <ReporteGerencialForm cfg={c} set={s} />,
    regulatorio:  (c, s) => <ReporteSudeasegForm cfg={c} set={s} />,
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
