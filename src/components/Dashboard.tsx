import { useEffect, useState, useCallback } from 'react';
import {
    Zap, CheckCircle, AlertCircle, RefreshCw,
    TrendingUp, Activity, BarChart2,
    Calendar, Play, RotateCcw, BookOpen, Filter,
    ChevronRight, Inbox, GitBranch, Eye,
    UserCheck, Clock, Workflow as WorkflowIcon,
    ArrowRight, ArrowLeft, X, Pencil, ListChecks,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import type { Workflow, WorkflowNodeData, WorkflowConnection } from '../types/workflow';
import type { User, Role } from '../core/user.types';
import { ROL_META } from '../core/user.types';
import { WorkflowService } from '../services/workflow.service';
import { fechaHoraVE, fechaVE } from '../utils/fecha';
import { toast } from 'sonner';

// ── Clasificación de vista por rol ─────────────────────────────────────────────
type DashView = 'admin' | 'operador' | 'aprobador' | 'auditor';

function getDashView(role: Role | undefined): DashView {
    if (!role) return 'admin';
    if (['admin', 'dueno_proceso', 'editor', 'supervisor'].includes(role)) return 'admin';
    if (['operador', 'operator'].includes(role))                            return 'operador';
    if (['cumplimiento', 'autorizador'].includes(role))                     return 'aprobador';
    if (role === 'auditor')                                                 return 'auditor';
    return 'admin';
}

// ── Hero card personalizada por rol ────────────────────────────────────────────
interface HeroStats { label: string; value: string | number; sub?: string; color: string }

function RoleHeroCard({ user, runs, pendingCount, workflows }: {
    user: User;
    runs: RunRow[];
    pendingCount: number;
    workflows: Workflow[];
}) {
    const view    = getDashView(user.role);
    const rolMeta = ROL_META[user.role] ?? { label: user.role, color: '#6366f1', descripcion: '' };
    const hour    = new Date().getHours();
    const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';

    const total     = runs.length;
    const success   = runs.filter(r => r.status === 'success').length;
    const errors    = runs.filter(r => r.status === 'error').length;
    const running   = runs.filter(r => r.status === 'running').length;
    const rate      = total ? Math.round((success / total) * 100) : 0;
    const health    = rate >= 90 ? 'Óptimo' : rate >= 70 ? 'Normal' : 'Atención requerida';
    // Color del círculo: verde ≥90%, naranja ≥70%, rojo <70%
    const ringColor = rate >= 90 ? '#34d399' : rate >= 70 ? '#fb923c' : '#f87171';

    const myRuns    = runs.filter(r => r.triggered_by === user.email);
    const mySuccess = myRuns.filter(r => r.status === 'success').length;
    const myErrors  = myRuns.filter(r => r.status === 'error').length;
    const myRate    = myRuns.length ? Math.round((mySuccess / myRuns.length) * 100) : 0;
    const myRing    = myRate >= 90 ? '#34d399' : myRate >= 70 ? '#fb923c' : '#f87171';
    const activeWfs = workflows.filter(w => w.isActive).length;

    // Chips siempre en blanco semitransparente — legibles sobre verde, naranja y rojo
    const chip = 'bg-white/20 text-white border border-white/30';

    const statsMap: Record<DashView, HeroStats[]> = {
        admin: [
            { label: 'Flujos activos', value: activeWfs, color: chip },
            { label: 'Exitosas',       value: success,   color: chip },
            { label: 'Con error',      value: errors,    color: errors   > 0 ? 'bg-red-900/40 text-red-100 border border-red-300/40'   : chip },
            { label: 'En curso',       value: running,   color: running  > 0 ? 'bg-blue-900/30 text-blue-100 border border-blue-300/30' : chip },
        ],
        operador: [
            { label: 'Mis ejecuciones', value: myRuns.length, color: chip },
            { label: 'Exitosas',        value: mySuccess,      color: chip },
            { label: 'Con error',       value: myErrors,       color: myErrors > 0 ? 'bg-red-900/40 text-red-100 border border-red-300/40' : chip },
        ],
        aprobador: [
            { label: 'Pendientes', value: pendingCount, sub: 'requieren mi aprobación', color: pendingCount > 0 ? 'bg-amber-900/40 text-amber-100 border border-amber-300/40' : chip },
            { label: 'Flujos activos', value: activeWfs, color: chip },
        ],
        auditor: [
            { label: 'Total ejecuciones', value: total,   color: chip },
            { label: 'Exitosas',          value: success, color: chip },
            { label: 'Errores',           value: errors,  color: errors > 0 ? 'bg-red-900/40 text-red-100 border border-red-300/40' : chip },
        ],
    };

    const stats    = statsMap[view];
    const scoreRate = view === 'operador' ? myRate : rate;
    const scoreRing = view === 'operador' ? myRing : ringColor;
    const scoreLabel = view === 'operador' ? (myRate >= 90 ? 'Óptimo' : myRate >= 70 ? 'Normal' : 'Atención') : health;

    // Gradiente de fondo según salud del sistema (igual que antes, pero mantiene info del usuario)
    const healthGrad = scoreRate >= 90
        ? 'from-emerald-600 to-teal-600'
        : scoreRate >= 70
        ? 'from-amber-500 to-orange-500'
        : 'from-red-600 to-rose-600';

    return (
        <div className={`rounded-2xl p-6 text-white shadow-lg bg-gradient-to-r ${healthGrad}`}>
            <div className="flex items-center justify-between flex-wrap gap-4">
                {/* Identidad */}
                <div>
                    <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-1">{greeting}</p>
                    <h2 className="text-2xl font-bold">{user.name}</h2>
                    <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs font-semibold bg-white/20 px-2.5 py-0.5 rounded-full">{rolMeta.label}</span>
                        <span className="text-white/60 text-xs hidden sm:inline">{rolMeta.descripcion}</span>
                    </div>
                </div>

                {/* Stats + score de salud */}
                <div className="flex items-center gap-4 flex-wrap">
                    {/* Stats chips */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {stats.map(s => (
                            <div key={s.label} className={`rounded-xl px-3 py-2 text-center ${s.color}`}>
                                <p className="text-lg font-bold leading-none">{s.value}</p>
                                <p className="text-[10px] mt-0.5 opacity-80">{s.label}</p>
                                {s.sub && <p className="text-[9px] opacity-60">{s.sub}</p>}
                            </div>
                        ))}
                    </div>

                    {/* Separador */}
                    <div className="w-px h-12 bg-white/20 hidden sm:block" />

                    {/* Score de salud (círculo SVG) */}
                    <div className="flex flex-col items-center gap-1">
                        <div className="relative w-16 h-16">
                            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3.5" />
                                <circle cx="18" cy="18" r="15.9" fill="none" stroke={scoreRing} strokeWidth="3.5"
                                    strokeDasharray={`${scoreRate} ${100 - scoreRate}`} strokeLinecap="round"
                                    style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.6s ease' }}
                                />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">{scoreRate}%</span>
                        </div>
                        <p className="text-white/70 text-[10px] font-semibold text-center">{scoreLabel}</p>
                        {running > 0 && view !== 'operador' && (
                            <div className="flex items-center gap-1 bg-white/15 rounded-full px-2 py-0.5">
                                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                <span className="text-[9px]">{running} corriendo</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Panel de aprobaciones pendientes (para aprobador) ──────────────────────────
interface TareaRow {
    id:          string;
    node_title:  string;
    descripcion: string;
    monto:       number | null;
    vence_at:    string | null;
    workflow_id: string;
    execution_run_id: string;
    rol_aprobador: string;
    estado:      string;
}

function AprobacionesPanel({ user, onNavigate }: { user: User; onNavigate?: (v: 'workqueue') => void }) {
    const [tareas,  setTareas]  = useState<TareaRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase.from('tareas_aprobacion')
            .select('id, node_title, descripcion, monto, vence_at, workflow_id, execution_run_id, rol_aprobador, estado')
            .eq('estado', 'pendiente')
            .eq('rol_aprobador', user.role)
            .order('created_at', { ascending: false })
            .limit(5)
            .then(({ data }) => { setTareas(data ?? []); setLoading(false); });
    }, [user.role]);

    const urgent = tareas.filter(t => t.vence_at && new Date(t.vence_at) < new Date(Date.now() + 24 * 60 * 60 * 1000));

    return (
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-amber-100 flex items-center justify-between bg-amber-50/40">
                <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-amber-600" />
                    <h2 className="font-semibold text-amber-800 text-sm">Mis Aprobaciones Pendientes</h2>
                    {tareas.length > 0 && (
                        <span className="text-[10px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold">{tareas.length}</span>
                    )}
                </div>
                {urgent.length > 0 && (
                    <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">⚡ {urgent.length} urgente{urgent.length > 1 ? 's' : ''}</span>
                )}
            </div>
            <div className="divide-y divide-gray-50">
                {loading ? (
                    <div className="py-6 flex justify-center"><RefreshCw className="w-4 h-4 animate-spin text-gray-300" /></div>
                ) : tareas.length === 0 ? (
                    <div className="py-8 text-center">
                        <CheckCircle className="w-7 h-7 text-emerald-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">Sin aprobaciones pendientes</p>
                    </div>
                ) : tareas.map(t => {
                    const isUrgent = t.vence_at && new Date(t.vence_at) < new Date(Date.now() + 24 * 60 * 60 * 1000);
                    return (
                        <div key={t.id} className="px-5 py-3 hover:bg-amber-50/30 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-semibold text-gray-800 truncate">{t.node_title}</p>
                                        {isUrgent && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold flex-shrink-0">URGENTE</span>}
                                    </div>
                                    <p className="text-xs text-gray-500 truncate mt-0.5">{t.descripcion || 'Sin descripción'}</p>
                                    <div className="flex items-center gap-3 mt-1">
                                        {t.monto && <span className="text-[10px] font-semibold text-indigo-600">${t.monto.toLocaleString()}</span>}
                                        {t.vence_at && (
                                            <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                                <Clock className="w-2.5 h-2.5" />
                                                Vence {fechaVE(t.vence_at)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={() => onNavigate?.('workqueue')}
                                    className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                                >
                                    Revisar <ChevronRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    );
                })}
                {tareas.length > 0 && (
                    <div className="px-5 py-2.5 bg-gray-50/50">
                        <button onClick={() => onNavigate?.('workqueue')} className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
                            Ver todas en Cola de Trabajo <ChevronRight className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Panel de flujos ejecutables (para operador) ────────────────────────────────
function MisFlujos({ workflows, onNavigate, loading }: {
    workflows: Workflow[];
    onNavigate?: (v: 'canvas') => void;
    loading: boolean;
}) {
    const activos = workflows.filter(w => w.isActive).slice(0, 6);
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                <div className="flex items-center gap-2">
                    <WorkflowIcon className="w-4 h-4 text-indigo-500" />
                    <h2 className="font-semibold text-gray-800 text-sm">Flujos Disponibles</h2>
                    <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-medium">{activos.length} activos</span>
                </div>
                <button onClick={() => onNavigate?.('canvas')} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1">
                    Ver todos <ChevronRight className="w-3 h-3" />
                </button>
            </div>
            <div className="divide-y divide-gray-50">
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="px-5 py-3 flex items-center gap-3">
                            <div className="skeleton w-2 h-2 rounded-full" />
                            <div className="skeleton h-3 flex-1 rounded" />
                        </div>
                    ))
                ) : activos.length === 0 ? (
                    <div className="py-8 text-center">
                        <Inbox className="w-7 h-7 text-gray-200 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">Sin flujos activos asignados</p>
                    </div>
                ) : activos.map(wf => (
                    <div key={wf.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate">{wf.name}</p>
                            <p className="text-[10px] text-gray-400">{wf.executionCount} ejecuciones</p>
                        </div>
                        <button
                            onClick={() => { localStorage.setItem('hermesai_open_workflow', wf.id); onNavigate?.('canvas'); }}
                            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                        >
                            <Play className="w-2.5 h-2.5" /> Ejecutar
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Panel de auditoría resumida (para auditor) ─────────────────────────────────
function AuditorPanel({ runs, onNavigate }: { runs: RunRow[]; onNavigate?: (v: 'governance') => void }) {
    const byStatus = runs.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
    }, {});

    const byWf = runs.reduce<Record<string, { name: string; count: number; errors: number }>>((acc, r) => {
        if (!acc[r.workflow_name]) acc[r.workflow_name] = { name: r.workflow_name, count: 0, errors: 0 };
        acc[r.workflow_name].count++;
        if (r.status === 'error') acc[r.workflow_name].errors++;
        return acc;
    }, {});

    const topWfs = Object.values(byWf).sort((a, b) => b.count - a.count).slice(0, 5);

    return (
        <div className="bg-white rounded-2xl border border-purple-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-purple-100 flex items-center justify-between bg-purple-50/40">
                <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-purple-600" />
                    <h2 className="font-semibold text-purple-800 text-sm">Resumen de Trazabilidad</h2>
                    <span className="text-[10px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">Solo lectura</span>
                </div>
                <button onClick={() => onNavigate?.('governance')} className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1">
                    Audit trail completo <ChevronRight className="w-3 h-3" />
                </button>
            </div>
            <div className="p-5 space-y-4">
                {/* Distribución por estado */}
                <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Distribución por estado</p>
                    <div className="grid grid-cols-4 gap-2">
                        {[
                            { key: 'success',   label: 'Exitosas',   color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                            { key: 'error',     label: 'Errores',    color: 'bg-red-50 text-red-700 border-red-200'             },
                            { key: 'running',   label: 'Activas',    color: 'bg-blue-50 text-blue-700 border-blue-200'          },
                            { key: 'cancelled', label: 'Canceladas', color: 'bg-gray-50 text-gray-500 border-gray-200'          },
                        ].map(s => (
                            <div key={s.key} className={`rounded-xl border p-2.5 text-center ${s.color}`}>
                                <p className="text-lg font-bold">{byStatus[s.key] ?? 0}</p>
                                <p className="text-[9px] font-semibold mt-0.5">{s.label}</p>
                            </div>
                        ))}
                    </div>
                </div>
                {/* Top flujos */}
                <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Top flujos por actividad</p>
                    <div className="space-y-1.5">
                        {topWfs.map(wf => (
                            <div key={wf.name} className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <p className="text-xs font-medium text-gray-700 truncate">{wf.name}</p>
                                        <span className="text-[10px] text-gray-400 flex-shrink-0 ml-2">{wf.count}</span>
                                    </div>
                                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                                        <div
                                            className="bg-purple-400 rounded-full h-1.5"
                                            style={{ width: `${Math.round(wf.count / runs.length * 100)}%` }}
                                        />
                                    </div>
                                </div>
                                {wf.errors > 0 && (
                                    <span className="text-[9px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-bold flex-shrink-0">{wf.errors} err</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Wizard de creación de plantilla ──────────────────────────────────────────
type WizardStep = 'nombre' | 'revisar' | 'crear';

const NODE_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    trigger:   { label: 'Trigger',  color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
    processor: { label: 'Proceso',  color: 'text-indigo-700',  bg: 'bg-indigo-50 border-indigo-200'   },
    output:    { label: 'Salida',   color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200'     },
};

interface TemplateWizardProps {
    template:  typeof TEMPLATES[0];
    blueprint: { nodes: { id: string; type: string; title: string; category: string }[]; connections: { id: string; sourceId: string; targetId: string }[] };
    onCreate:  (name: string, description: string) => Promise<void>;
    onCancel:  () => void;
    creating:  boolean;
}

function TemplateWizard({ template, blueprint, onCreate, onCancel, creating }: TemplateWizardProps) {
    const [step,        setStep]        = useState<WizardStep>('nombre');
    const [name,        setName]        = useState(template.name);
    const [description, setDescription] = useState(template.desc);
    const Icon = template.icon;

    const steps: { id: WizardStep; label: string; icon: React.ReactNode }[] = [
        { id: 'nombre',  label: 'Nombre',   icon: <Pencil    className="w-3.5 h-3.5" /> },
        { id: 'revisar', label: 'Revisar',  icon: <ListChecks className="w-3.5 h-3.5" /> },
        { id: 'crear',   label: 'Confirmar',icon: <CheckCircle className="w-3.5 h-3.5" /> },
    ];
    const stepIdx = steps.findIndex(s => s.id === step);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">

                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5 text-white">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl ${template.bg} flex items-center justify-center flex-shrink-0`}>
                                <Icon className={`w-5 h-5 ${template.color}`} />
                            </div>
                            <div>
                                <p className="text-white/70 text-xs font-semibold uppercase tracking-wider">Nueva plantilla</p>
                                <p className="font-bold text-base leading-tight">{template.name}</p>
                            </div>
                        </div>
                        <button onClick={onCancel} className="text-white/70 hover:text-white transition-colors flex-shrink-0 mt-0.5">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center gap-0 mt-5">
                        {steps.map((s, i) => (
                            <div key={s.id} className="flex items-center flex-1 last:flex-none">
                                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${
                                    i === stepIdx   ? 'bg-white text-indigo-700'         :
                                    i < stepIdx     ? 'bg-white/30 text-white'            :
                                                      'bg-white/10 text-white/50'
                                }`}>
                                    {i < stepIdx ? <CheckCircle className="w-3 h-3" /> : s.icon}
                                    {s.label}
                                </div>
                                {i < steps.length - 1 && (
                                    <div className={`flex-1 h-px mx-1 ${i < stepIdx ? 'bg-white/50' : 'bg-white/20'}`} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Paso 1 — Nombre */}
                {step === 'nombre' && (
                    <div className="px-6 py-5 space-y-4">
                        <div>
                            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Nombre del flujo *</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                autoFocus
                                className="w-full text-sm px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                placeholder="Ej: Reporte BCV — Equipo Financiero"
                            />
                            <p className="text-[10px] text-gray-400 mt-1">Personaliza el nombre para identificarlo fácilmente en el panel</p>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Descripción (opcional)</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                rows={2}
                                className="w-full text-sm px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                                placeholder="Para qué sirve este flujo..."
                            />
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                            <div className="flex gap-1 flex-wrap flex-1">
                                {template.tags.map(tag => (
                                    <span key={tag} className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded font-medium">{tag}</span>
                                ))}
                            </div>
                            <span className="text-[10px] text-indigo-500 flex-shrink-0">{blueprint.nodes.length} nodos</span>
                        </div>
                    </div>
                )}

                {/* Paso 2 — Revisar nodos */}
                {step === 'revisar' && (
                    <div className="px-6 py-5">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                            Nodos que se crearán — {blueprint.nodes.length} en total
                        </p>
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {blueprint.nodes.map((node, i) => {
                                const meta = NODE_TYPE_LABELS[node.type] ?? NODE_TYPE_LABELS.processor;
                                // Buscar el siguiente nodo conectado
                                const nextConn = blueprint.connections.find(c => c.sourceId === node.id);
                                const nextNode = nextConn ? blueprint.nodes.find(n => n.id === nextConn.targetId) : null;
                                return (
                                    <div key={node.id} className="relative">
                                        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${meta.bg}`}>
                                            <div className="w-6 h-6 rounded-full bg-white/70 flex items-center justify-center flex-shrink-0">
                                                <span className="text-[10px] font-bold text-gray-500">{i + 1}</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-semibold ${meta.color} truncate`}>{node.title}</p>
                                                <p className="text-[10px] text-gray-400 capitalize">{node.category}</p>
                                            </div>
                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${meta.bg} ${meta.color}`}>
                                                {meta.label}
                                            </span>
                                        </div>
                                        {nextNode && (
                                            <div className="flex justify-center my-0.5">
                                                <ArrowRight className="w-3 h-3 text-gray-300 rotate-90" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-3 text-center">
                            Podrás configurar cada nodo en detalle desde el Constructor de Flujos
                        </p>
                    </div>
                )}

                {/* Paso 3 — Confirmar */}
                {step === 'crear' && (
                    <div className="px-6 py-5 space-y-3">
                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                            <p className="text-sm font-bold text-emerald-800 mb-2">Resumen del flujo a crear</p>
                            <div className="space-y-1.5 text-xs text-emerald-700">
                                <div className="flex justify-between">
                                    <span className="font-medium">Nombre</span>
                                    <span className="truncate max-w-48 text-right">{name || template.name}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium">Nodos</span>
                                    <span>{blueprint.nodes.length} configurados</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium">Conexiones</span>
                                    <span>{blueprint.connections.length}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium">Plantilla base</span>
                                    <span>{template.name}</span>
                                </div>
                            </div>
                        </div>
                        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
                            <strong>Próximo paso:</strong> Se abrirá el Constructor donde deberás configurar los destinatarios de email, aprobadores y demás campos antes de ejecutar.
                        </div>
                    </div>
                )}

                {/* Navegación */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/60 flex items-center gap-2">
                    {stepIdx > 0 && (
                        <button
                            onClick={() => setStep(steps[stepIdx - 1].id)}
                            disabled={creating}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" /> Atrás
                        </button>
                    )}
                    <button onClick={onCancel} disabled={creating}
                        className={`${stepIdx === 0 ? '' : 'hidden'} flex-1 px-4 py-2 text-sm font-semibold border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors`}>
                        Cancelar
                    </button>
                    <div className="flex-1" />
                    {step !== 'crear' ? (
                        <button
                            onClick={() => setStep(steps[stepIdx + 1].id)}
                            disabled={!name.trim()}
                            className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                        >
                            Siguiente <ArrowRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            onClick={() => onCreate(name || template.name, description)}
                            disabled={creating || !name.trim()}
                            className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                        >
                            {creating
                                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creando...</>
                                : <><Zap className="w-4 h-4" /> Crear y abrir en Constructor</>
                            }
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Plantillas pre-armadas (nodos + conexiones) ───────────────────────────────
interface TemplateBlueprint {
    nodes:       Omit<WorkflowNodeData, 'connections'>[];
    connections: WorkflowConnection[];
}

function makeId() { return crypto.randomUUID(); }

function buildTemplate(id: string): TemplateBlueprint {
    const n1 = makeId(), n2 = makeId(), n3 = makeId(), n4 = makeId(), n5 = makeId();
    const c1 = makeId(), c2 = makeId(), c3 = makeId(), c4 = makeId();

    const blueprints: Record<string, TemplateBlueprint> = {
        t1: { // Reporte BCV Diario
            nodes: [
                { id: n1, type: 'trigger',   category: 'cron',      title: 'Programado (Cron)',    position: { x: 80,  y: 100 }, config: { cron: '0 9 * * 1-5' }, status: 'idle' },
                { id: n2, type: 'processor', category: 'bcv',       title: 'Tasa BCV',             position: { x: 380, y: 100 }, config: {}, status: 'idle' },
                { id: n3, type: 'output',    category: 'email',     title: 'Enviar Email',         position: { x: 680, y: 100 }, config: { to: '', subject: '📈 Tasa BCV del día — {{previous.bcv_rate}} Bs/USD', body: '' }, status: 'idle' },
            ],
            connections: [
                { id: c1, sourceId: n1, targetId: n2 },
                { id: c2, sourceId: n2, targetId: n3 },
            ],
        },
        t2: { // Monitor Indicadores
            nodes: [
                { id: n1, type: 'trigger',   category: 'cron',        title: 'Programado (Cron)',    position: { x: 80,  y: 100 }, config: { cron: '0 8 * * 1' }, status: 'idle' },
                { id: n2, type: 'processor', category: 'indicadores', title: 'Leer Indicadores',     position: { x: 380, y: 100 }, config: { status: 'critical,at_risk', limit: '50' }, status: 'idle' },
                { id: n3, type: 'processor', category: 'semaforo',    title: 'Semáforo de Gestión',  position: { x: 680, y: 100 }, config: { value: '{{previous.critical_count}}', umbral_rojo: '1', umbral_amarillo: '0' }, status: 'idle' },
                { id: n4, type: 'processor', category: 'decision',    title: 'Decisión (Si/No)',     position: { x: 980, y: 100 }, config: { left: '{{previous.color}}', operator: '==', right: 'rojo' }, status: 'idle' },
                { id: n5, type: 'output',    category: 'reporte',     title: 'Reporte Gerencial',    position: { x: 1280, y: 60 }, config: { to: '', subject: '🔴 Alerta KPIs — {{previous.label}}', body: '' }, status: 'idle' },
            ],
            connections: [
                { id: c1, sourceId: n1, targetId: n2 },
                { id: c2, sourceId: n2, targetId: n3 },
                { id: c3, sourceId: n3, targetId: n4 },
                { id: c4, sourceId: n4, targetId: n5, branch: 'true' },
            ],
        },
        t3: { // Alerta Siniestro
            nodes: [
                { id: n1, type: 'trigger',   category: 'riskguard',   title: 'Alerta Siniestro',     position: { x: 80,  y: 100 }, config: { estado: 'pendiente' }, status: 'idle' },
                { id: n2, type: 'processor', category: 'fraude',      title: 'Score Fraude',          position: { x: 380, y: 100 }, config: {}, status: 'idle' },
                { id: n3, type: 'processor', category: 'decision',    title: 'Decisión (Si/No)',      position: { x: 680, y: 100 }, config: { left: '{{previous.nivel}}', operator: '==', right: 'alto' }, status: 'idle' },
                { id: n4, type: 'output',    category: 'notificacion',title: 'Notificar Ajustador',   position: { x: 980, y: 60  }, config: { to: '' }, status: 'idle' },
                { id: n5, type: 'output',    category: 'log',         title: 'Registrar Log',         position: { x: 980, y: 240 }, config: { message: 'Siniestro con score normal — {{previous.nivel}}' }, status: 'idle' },
            ],
            connections: [
                { id: c1, sourceId: n1, targetId: n2 },
                { id: c2, sourceId: n2, targetId: n3 },
                { id: c3, sourceId: n3, targetId: n4, branch: 'true'  },
                { id: c4, sourceId: n3, targetId: n5, branch: 'false' },
            ],
        },
        t4: { // Resumen Financiero Mensual
            nodes: [
                { id: n1, type: 'trigger',   category: 'cron',   title: 'Programado (Cron)',   position: { x: 80,  y: 100 }, config: { cron: '0 8 1 * *' }, status: 'idle' },
                { id: n2, type: 'processor', category: 'eeff',   title: 'Datos EE.FF.',        position: { x: 380, y: 100 }, config: { query_type: 'summary', company: '' }, status: 'idle' },
                { id: n3, type: 'output',    category: 'reporte',title: 'Reporte Gerencial',   position: { x: 680, y: 100 }, config: { to: '', subject: '📊 Resumen Financiero Mensual — {{previous.periodo}}', body: '' }, status: 'idle' },
            ],
            connections: [
                { id: c1, sourceId: n1, targetId: n2 },
                { id: c2, sourceId: n2, targetId: n3 },
            ],
        },
        t5: { // Score AML Automático
            nodes: [
                { id: n1, type: 'trigger',   category: 'webhook', title: 'Webhook Entrante',    position: { x: 80,  y: 100 }, config: {}, status: 'idle' },
                { id: n2, type: 'processor', category: 'aml',     title: 'Score AML',           position: { x: 380, y: 100 }, config: {}, status: 'idle' },
                { id: n3, type: 'processor', category: 'aml',     title: 'Verificar OFAC/ONU',  position: { x: 680, y: 100 }, config: {}, status: 'idle' },
                { id: n4, type: 'processor', category: 'decision',title: 'Decisión (Si/No)',    position: { x: 980, y: 100 }, config: { left: '{{previous.nivel}}', operator: '==', right: 'alto' }, status: 'idle' },
                { id: n5, type: 'processor', category: 'operacion',title: 'Congelar Operación', position: { x: 1280, y: 60 }, config: {}, status: 'idle' },
            ],
            connections: [
                { id: c1, sourceId: n1, targetId: n2 },
                { id: c2, sourceId: n2, targetId: n3 },
                { id: c3, sourceId: n3, targetId: n4 },
                { id: c4, sourceId: n4, targetId: n5, branch: 'true' },
            ],
        },
        t6: { // Orden de Compra
            nodes: [
                { id: n1, type: 'trigger',   category: 'inventario',  title: 'Alerta de Stock',      position: { x: 80,  y: 100 }, config: {}, status: 'idle' },
                { id: n2, type: 'processor', category: 'aprobacion',  title: 'Solicitar Aprobación', position: { x: 380, y: 100 }, config: { approver: '', reason: 'Reposición de inventario bajo mínimo' }, status: 'idle' },
                { id: n3, type: 'output',    category: 'compras',     title: 'Orden de Compra',      position: { x: 680, y: 100 }, config: {}, status: 'idle' },
                { id: n4, type: 'output',    category: 'notificacion',title: 'Notificar Producción', position: { x: 980, y: 100 }, config: {}, status: 'idle' },
            ],
            connections: [
                { id: c1, sourceId: n1, targetId: n2 },
                { id: c2, sourceId: n2, targetId: n3 },
                { id: c3, sourceId: n3, targetId: n4 },
            ],
        },
    };

    return blueprints[id] ?? { nodes: [], connections: [] };
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
type Period = '24h' | '7d' | '30d' | 'all';

interface RunRow {
    id:            string;
    workflow_name: string;
    workflow_id:   string;
    organization_id: string;
    status:        string;
    started_at:    string;
    duration_ms:   number | null;
    logs_count:    number;
    triggered_by:  string;
    error_message: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(ms: number | null): string {
    if (!ms) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string): string {
    return fechaHoraVE(iso, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min  = Math.floor(diff / 60000);
    if (min < 1)  return 'Ahora mismo';
    if (min < 60) return `hace ${min}m`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `hace ${hrs}h`;
    return `hace ${Math.floor(hrs / 24)}d`;
}

function periodLabel(p: Period): string {
    return { '24h': 'Últimas 24h', '7d': 'Últimos 7 días', '30d': 'Últimos 30 días', all: 'Todo el historial' }[p];
}

function periodCutoff(p: Period): string | null {
    if (p === 'all') return null;
    const ms = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 }[p];
    return new Date(Date.now() - ms).toISOString();
}

// ── Plantillas pre-configuradas ───────────────────────────────────────────────
const TEMPLATES = [
    { id: 't1', name: 'Reporte BCV Diario',          desc: 'Cron → Tasa BCV → Email ejecutivo',                         icon: TrendingUp,  color: 'text-amber-600',  bg: 'bg-amber-50',  tags: ['BCV', 'Email'] },
    { id: 't2', name: 'Monitor de Indicadores',       desc: 'Cron → KPIs → Semáforo → Alerta si crítico',               icon: BarChart2,   color: 'text-indigo-600', bg: 'bg-indigo-50', tags: ['Indicadores', 'Gestión'] },
    { id: 't3', name: 'Alerta de Siniestro',          desc: 'Trigger RiskGuard → Score Fraude → Decisión → Notificación', icon: AlertCircle, color: 'text-red-600',    bg: 'bg-red-50',    tags: ['Seguros', 'Fraude'] },
    { id: 't4', name: 'Resumen Financiero Mensual',   desc: 'Cron → EE.FF. → Reporte Gerencial → Email Dirección',      icon: GitBranch,   color: 'text-emerald-600',bg: 'bg-emerald-50',tags: ['EE.FF.', 'Reportes'] },
    { id: 't5', name: 'Score AML Automático',         desc: 'Webhook → Score AML → Verificar OFAC → Congelar si alto', icon: Zap,          color: 'text-violet-600', bg: 'bg-violet-50', tags: ['Banca', 'AML'] },
    { id: 't6', name: 'Orden de Compra Automática',   desc: 'Alerta Stock → Aprobación → Generar OC → Notificar',       icon: CheckCircle, color: 'text-teal-600',   bg: 'bg-teal-50',   tags: ['Manufactura', 'Inventario'] },
];

// ── Colores por estado ────────────────────────────────────────────────────────
const SC: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
    success:  { label: 'Exitoso',   color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-400' },
    error:    { label: 'Error',     color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200',     dot: 'bg-red-500'     },
    running:  { label: 'Corriendo', color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200',    dot: 'bg-blue-400'    },
    cancelled:{ label: 'Cancelado', color: 'text-gray-500',    bg: 'bg-gray-50',    border: 'border-gray-200',    dot: 'bg-gray-300'    },
};

const TRIGGER: Record<string, string> = { manual: '▶ Manual', cron: '⏰ Cron', webhook: '⚡ Webhook' };

// ── Bandeja Operativa — componente propio con estado ─────────────────────────
interface BandejaProps {
    runs:         RunRow[];
    retrying:     string | null;
    handleRetry:  (run: RunRow) => void;
    onNavigate?:  (view: 'canvas' | 'monitoring' | 'settings' | 'dashboard') => void;
}

function BandejaOperativa({ runs, retrying, handleRetry, onNavigate }: BandejaProps) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    const errByWf = runs
        .filter(r => r.status === 'error')
        .reduce<Record<string, { count: number; wf: RunRow }>>((acc, r) => {
            if (!acc[r.workflow_name]) acc[r.workflow_name] = { count: 0, wf: r };
            acc[r.workflow_name].count++;
            return acc;
        }, {});

    const criticos = Object.values(errByWf)
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);

    const pendientes = runs.filter(r =>
        r.status === 'running' &&
        Date.now() - new Date(r.started_at).getTime() > 2 * 60 * 1000
    );

    if (criticos.length === 0 && pendientes.length === 0) return null;

    return (
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-amber-100 flex items-center justify-between bg-amber-50/40">
                <div className="flex items-center gap-2">
                    <Inbox className="w-4 h-4 text-amber-600" />
                    <h2 className="font-semibold text-amber-800 text-sm">Bandeja Operativa</h2>
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                        {criticos.length + pendientes.length} items
                    </span>
                </div>
                <button onClick={() => setDismissed(true)} className="text-amber-400 hover:text-amber-600 text-xs transition-colors">
                    Cerrar
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-amber-50">

                {/* Criticidad */}
                <div className="p-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">🔴 Mayor criticidad</p>
                    {criticos.length === 0
                        ? <p className="text-xs text-gray-400">Sin errores recurrentes</p>
                        : criticos.map(({ count, wf }) => (
                            <div key={wf.workflow_name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0 group">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs text-gray-800 font-medium truncate">{wf.workflow_name}</p>
                                    <p className="text-[10px] text-gray-400">{fmtDate(wf.started_at)}</p>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                                        {count} error{count > 1 ? 'es' : ''}
                                    </span>
                                    <button
                                        onClick={() => handleRetry(wf)}
                                        disabled={retrying === wf.id}
                                        className="opacity-0 group-hover:opacity-100 text-[10px] px-2 py-0.5 bg-indigo-600 text-white rounded transition-all"
                                    >
                                        {retrying === wf.id ? '...' : 'Reintentar'}
                                    </button>
                                </div>
                            </div>
                        ))
                    }
                </div>

                {/* Aprobaciones / bloqueados */}
                <div className="p-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">⏳ Requieren revisión humana</p>
                    {pendientes.length === 0
                        ? <p className="text-xs text-gray-400">Sin flujos bloqueados</p>
                        : pendientes.map(r => {
                            const minutos = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60000);
                            return (
                                <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-gray-800 font-medium truncate">{r.workflow_name}</p>
                                        <p className="text-[10px] text-amber-600">En ejecución hace {minutos}m</p>
                                    </div>
                                    <button
                                        onClick={() => onNavigate?.('monitoring')}
                                        className="text-[10px] px-2 py-1 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 flex-shrink-0 ml-2 transition-colors"
                                    >
                                        Ver logs
                                    </button>
                                </div>
                            );
                        })
                    }
                </div>
            </div>
        </div>
    );
}

// ── Componente principal ──────────────────────────────────────────────────────
interface DashboardProps {
    onNavigate?:  (view: 'canvas' | 'monitoring' | 'settings' | 'dashboard' | 'workqueue' | 'governance') => void;
    currentUser?: User;
}

export function Dashboard({ onNavigate, currentUser }: DashboardProps) {
    const [runs,       setRuns]       = useState<RunRow[]>([]);
    const [workflows,  setWorkflows]  = useState<Workflow[]>([]);
    const [cronFlows,  setCronFlows]  = useState<{name:string;cron:string;wfId:string}[]>([]);
    const [loading,    setLoading]    = useState(true);
    const [period,     setPeriod]     = useState<Period>('7d');
    const [retrying,      setRetrying]      = useState<string | null>(null);
    const [resolving,     setResolving]     = useState<string | null>(null);
    const [creating,      setCreating]      = useState<string | null>(null);
    const [pendingAppr,   setPendingAppr]   = useState(0);
    const [wizardTemplate, setWizardTemplate] = useState<typeof TEMPLATES[0] | null>(null);
    const [kpiParams, setKpiParams] = useState({ sla_ms: 30000, min_por_tarea: 15, costo_hora_usd: 25 });

    const orgId = currentUser?.organizationId ?? '';

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const cutoff = periodCutoff(period);
            let q = supabase
                .from('execution_runs')
                .select('id, workflow_id, organization_id, status, started_at, duration_ms, logs_count, triggered_by, error_message, workflows(name)')
                .order('started_at', { ascending: false })
                .limit(200);
            if (cutoff) q = q.gte('started_at', cutoff);

            const [runsRes, wfsRes, cronRes] = await Promise.all([
                q,
                supabase.from('workflows').select('id, name, status, is_active, execution_count, last_run_at, created_at, profiles:created_by(name)').order('execution_count', { ascending: false }).limit(50),
                // Punto 2: flujos cron dinámicos desde la DB
                supabase.from('workflow_nodes')
                    .select('workflow_id, config_json, workflows(name, is_active)')
                    .eq('type', 'trigger')
                    .eq('category', 'cron')
                    .limit(20),
            ]);

            setRuns((runsRes.data ?? []).map((r: any) => ({
                id: r.id, workflow_name: r.workflows?.name ?? '—', workflow_id: r.workflow_id,
                organization_id: r.organization_id, status: r.status, started_at: r.started_at,
                duration_ms: r.duration_ms, logs_count: r.logs_count,
                triggered_by: r.triggered_by ?? 'manual', error_message: r.error_message,
            })));

            setWorkflows((wfsRes.data ?? []).map((w: any) => ({
                id: w.id, name: w.name, description: '', nodes: [], connections: [],
                isActive: w.is_active, createdAt: w.created_at, lastRun: w.last_run_at,
                executionCount: w.execution_count ?? 0, status: w.status ?? 'paused',
                responsible: w.profiles?.name ?? 'Sin responsable',
            })));

            setCronFlows((cronRes.data ?? [])
                .filter((n: any) => n.config_json?.cron && (n.workflows as any)?.is_active)
                .map((n: any) => ({
                    name: (n.workflows as any)?.name ?? 'Flujo programado',
                    cron: n.config_json.cron as string,
                    wfId: n.workflow_id as string,
                }))
            );
        } catch {
            toast.error('Error cargando dashboard');
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const ch = supabase.channel('dash_runs')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'execution_runs' }, load)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [load]);

    // Conteo real de aprobaciones pendientes filtradas por rol del usuario
    useEffect(() => {
        if (!currentUser?.organizationId || !currentUser?.role) return;
        const fetchPending = async () => {
            const { data } = await supabase
                .from('tareas_aprobacion')
                .select('rol_aprobador, solicitante_id')
                .eq('organization_id', currentUser.organizationId)
                .eq('estado', 'pendiente');
            const ROLES_REG = ['cumplimiento'];
            const count = (data ?? []).filter(t => {
                if (t.solicitante_id === currentUser.id) return false; // SoD: no puede aprobar su propio flujo
                if (ROLES_REG.includes(t.rol_aprobador)) return currentUser.role === t.rol_aprobador;
                const isAdmin = ['admin', 'supervisor', 'autorizador'].includes(currentUser.role);
                return isAdmin || currentUser.role === t.rol_aprobador;
            }).length;
            setPendingAppr(count);
        };
        fetchPending();
        const ch = supabase.channel('dash_appr')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_aprobacion' }, fetchPending)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [currentUser?.organizationId, currentUser?.role]);

    // Cargar parámetros KPI configurables de la organización
    useEffect(() => {
        if (!orgId) return;
        supabase.from('organizations')
            .select('kpi_sla_ms, kpi_min_por_tarea, kpi_costo_hora_usd')
            .eq('id', orgId)
            .single()
            .then(({ data }) => {
                if (data) setKpiParams({
                    sla_ms:          data.kpi_sla_ms         ?? 30000,
                    min_por_tarea:   data.kpi_min_por_tarea  ?? 15,
                    costo_hora_usd:  data.kpi_costo_hora_usd ?? 25,
                });
            });
    }, [orgId]);

    const handleRetry = async (run: RunRow) => {
        setRetrying(run.id);
        try {
            const { error } = await supabase.functions.invoke('execute-workflow', {
                body: { workflowId: run.workflow_id, organizationId: run.organization_id, triggeredBy: currentUser?.email ?? 'manual' },
            });
            if (error) throw error;
            toast.success(`Flujo "${run.workflow_name}" re-ejecutado`);
            setTimeout(load, 1000);
        } catch {
            toast.error('No se pudo re-ejecutar el flujo');
        } finally {
            setRetrying(null);
        }
    };

    // Marcar ejecución con error como resuelta — la saca de todos los paneles de error
    const handleResolve = async (run: RunRow) => {
        setResolving(run.id);
        try {
            const { error } = await supabase
                .from('execution_runs')
                .update({ status: 'cancelled' })
                .eq('id', run.id);
            if (error) throw error;
            setRuns(prev => prev.filter(r => r.id !== run.id));
            toast.success(`"${run.workflow_name}" marcado como resuelto`);
        } catch {
            toast.error('No se pudo marcar como resuelto');
        } finally {
            setResolving(null);
        }
    };

    // BUG FIX: usar orgId real, no wf.id como organizationId
    const toggleActive = async (wf: Workflow) => {
        if (!orgId) { toast.error('Sin organización activa'); return; }
        try {
            await WorkflowService.updateWorkflow(wf.id, orgId, { isActive: !wf.isActive });
            setWorkflows(prev => prev.map(w => w.id === wf.id ? { ...w, isActive: !w.isActive } : w));
            toast.success(wf.isActive ? `"${wf.name}" pausado` : `"${wf.name}" activado`);
        } catch { toast.error('No se pudo actualizar el flujo'); }
    };

    // Abrir wizard de plantilla
    const openWizard = (t: typeof TEMPLATES[0]) => {
        if (!orgId) { onNavigate?.('canvas'); return; }
        setWizardTemplate(t);
    };

    // Crear flujo desde wizard con nombre/descripción personalizados
    const createFromTemplate = async (name: string, description: string) => {
        if (!wizardTemplate || !orgId) return;
        const t = wizardTemplate;
        setCreating(t.id);
        try {
            const userId    = currentUser?.id ?? '';
            const wf        = await WorkflowService.createWorkflow(orgId, userId, { name, description });
            const blueprint = buildTemplate(t.id);
            if (blueprint.nodes.length > 0) {
                const nodes: WorkflowNodeData[] = blueprint.nodes.map(n => ({ ...n, connections: [] }));
                // El flujo acaba de crearse aquí mismo y está vacío: escribir la
                // plantilla sobre él es legítimo, así que se declara como cargado.
                await WorkflowService.saveNodes(wf.id, orgId, nodes, wf.id);
                await WorkflowService.saveConnections(wf.id, blueprint.connections, wf.id);
            }
            localStorage.setItem('hermesai_open_workflow', wf.id);
            toast.success(`✅ Flujo "${name}" creado con ${blueprint.nodes.length} nodos — abriendo en el Constructor`);
            setWizardTemplate(null);
            onNavigate?.('canvas');
        } catch {
            toast.error('No se pudo crear el flujo — intenta de nuevo');
        } finally {
            setCreating(null);
        }
    };

    // ── KPIs calculados ─────────────────────────────────────────────────────
    const total    = runs.length;
    const success  = runs.filter(r => r.status === 'success').length;
    const errors   = runs.filter(r => r.status === 'error').length;
    const withDur  = runs.filter(r => r.duration_ms);
    const avgDur   = withDur.length ? Math.round(withDur.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / withDur.length) : 0;
    const errRuns  = runs.filter(r => r.status === 'error').slice(0, 5);
    const recent   = runs.slice(0, 12);

    // ── KPIs ejecutivos ─────────────────────────────────────────────────────
    const slaOk        = withDur.filter(r => (r.duration_ms ?? 0) <= kpiParams.sla_ms).length;
    const slaPct       = withDur.length ? Math.round((slaOk / withDur.length) * 100) : 100;
    const ahorroUsd    = Math.round(success * kpiParams.min_por_tarea / 60 * kpiParams.costo_hora_usd);
    const stuckRuns    = runs.filter(r => r.status === 'running' &&
        Date.now() - new Date(r.started_at).getTime() > 5 * 60 * 1000).length;

    // ── Vista por rol ──────────────────────────────────────────────────────
    const dashView = getDashView(currentUser?.role);
    const myRuns   = runs.filter(r => r.triggered_by === currentUser?.email);

    // ── Salud del cron ────────────────────────────────────────────────────
    // El indicador de la tarjeta "Flujos Programados" era un punto verde fijo y
    // el texto "pg_cron activo" escrito a mano: no consultaba absolutamente
    // nada. Siguió en verde los ocho días que el cron estuvo parado tras el
    // incidente del 30/07, que es justo por lo que nadie lo vio. Ahora sale de
    // las ejecuciones reales.
    //
    // Cuidado con lo que se puede afirmar: que no haya ejecuciones automáticas
    // NO demuestra que pg_cron esté caído —pasa igual si a ningún flujo le
    // tocaba—, así que la tarjeta informa de lo único que sabe con certeza:
    // cuándo fue la última vez que algo se ejecutó solo.
    const runsCron     = runs.filter(r => r.triggered_by === 'cron');
    const ultimoCron   = runsCron[0] ?? null;   // `runs` llega ordenado por started_at desc
    const horasSinCron = ultimoCron
        ? (Date.now() - new Date(ultimoCron.started_at).getTime()) / 3_600_000
        : Infinity;
    // Con flujos programados activos, un día entero sin una sola ejecución
    // automática es anómalo: lo más espaciado que ofrece el Constructor es
    // mensual, pero cualquier cartera con varios flujos toca a diario.
    const cronSano = cronFlows.length === 0 || horasSinCron < 24;

    return (
        <>
        <div className="h-full overflow-y-auto bg-[#f0f2f5]">
            <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

                {/* ── Barra superior ──────────────────────────────────────── */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">
                            {dashView === 'operador'  ? 'Mi Panel Operativo'   :
                             dashView === 'aprobador' ? 'Panel de Aprobaciones' :
                             dashView === 'auditor'   ? 'Panel de Auditoría'   :
                             'Centro de Comando'}
                        </h1>
                        <p className="text-xs text-gray-500 mt-0.5">HermesAI Flow · Hub de Automatización de Procesos</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Selector de período */}
                        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
                            <Filter className="w-3.5 h-3.5 text-gray-400 ml-1.5" />
                            {(['24h','7d','30d','all'] as Period[]).map(p => (
                                <button
                                    key={p}
                                    onClick={() => setPeriod(p)}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                        period === p ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    {p === 'all' ? 'Todo' : p}
                                </button>
                            ))}
                        </div>
                        <button onClick={load} disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-sm rounded-xl hover:bg-gray-50 shadow-sm disabled:opacity-40 transition-colors">
                            <RefreshCw className={`w-3.5 h-3.5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                            <span className="text-xs text-gray-600">Actualizar</span>
                        </button>
                    </div>
                </div>

                {/* ── Hero personalizado por rol + score de salud ──────────── */}
                <RoleHeroCard
                    user={currentUser ?? { id: '', email: '', name: 'Sistema', role: 'admin', organizationId: '', isActive: true }}
                    runs={runs}
                    pendingCount={pendingAppr}
                    workflows={workflows}
                />

                {/* ── Secciones específicas por rol ────────────────────────── */}
                {dashView === 'aprobador' && currentUser && (
                    <AprobacionesPanel user={currentUser} onNavigate={v => onNavigate?.(v)} />
                )}

                {dashView === 'operador' && currentUser && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <MisFlujos
                            workflows={workflows}
                            onNavigate={v => onNavigate?.(v)}
                            loading={loading}
                        />
                        {/* Mis últimas ejecuciones */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/60">
                                <Activity className="w-4 h-4 text-indigo-500" />
                                <h2 className="font-semibold text-gray-800 text-sm">Mis Últimas Ejecuciones</h2>
                                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{myRuns.length}</span>
                            </div>
                            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                                {myRuns.length === 0 ? (
                                    <div className="py-8 text-center">
                                        <Inbox className="w-7 h-7 text-gray-200 mx-auto mb-2" />
                                        <p className="text-sm text-gray-400">Sin ejecuciones aún</p>
                                    </div>
                                ) : myRuns.slice(0, 10).map(r => {
                                    const s = SC[r.status] ?? SC.cancelled;
                                    return (
                                        <div key={r.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 group">
                                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-semibold text-gray-800 truncate">{r.workflow_name}</p>
                                                <p className="text-[10px] text-gray-400">{fmtRelative(r.started_at)}</p>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.bg} ${s.color} ${s.border}`}>{s.label}</span>
                                                {r.status === 'error' && (
                                                    <button onClick={() => handleRetry(r)} disabled={retrying === r.id}
                                                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all">
                                                        <RotateCcw className={`w-3 h-3 ${retrying === r.id ? 'animate-spin' : ''}`} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {dashView === 'auditor' && (
                    <AuditorPanel runs={runs} onNavigate={v => onNavigate?.(v)} />
                )}

                {/* ── KPI Cards operacionales ──────────────────────────────── */}
                {/* Auditor ve KPIs pero sin acciones; operador ve solo los suyos */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    {[
                        { label: 'Ejecuciones',    value: total,                                     icon: Zap,         bl: 'border-l-indigo-500',  ic: 'text-indigo-500',  bg: 'bg-indigo-50'  },
                        { label: 'Exitosas',        value: success,                                   icon: CheckCircle, bl: 'border-l-emerald-500', ic: 'text-emerald-500', bg: 'bg-emerald-50' },
                        { label: 'Con Error',       value: errors,                                    icon: AlertCircle, bl: 'border-l-red-500',     ic: 'text-red-500',     bg: 'bg-red-50'     },
                        { label: 'Flujos Activos',  value: workflows.filter(w => w.isActive).length, icon: Activity,    bl: 'border-l-blue-500',    ic: 'text-blue-500',    bg: 'bg-blue-50'    },
                        { label: 'T. Promedio',     value: fmt(avgDur),                               icon: TrendingUp,  bl: 'border-l-violet-500',  ic: 'text-violet-500',  bg: 'bg-violet-50'  },
                    ].map(({ label, value, icon: Icon, bl, ic, bg }) => (
                        <div key={label} className={`bg-white rounded-xl border border-gray-100 border-l-4 ${bl} p-4 shadow-sm hover:shadow-md transition-shadow`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
                                <div className={`p-1.5 rounded-lg ${bg}`}><Icon className={`w-3.5 h-3.5 ${ic}`} /></div>
                            </div>
                            <p className="text-2xl font-bold text-gray-900">{value}</p>
                        </div>
                    ))}
                </div>

                {/* ── KPIs ejecutivos de negocio ────────────────────────────── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* SLA */}
                    <div className={`bg-white rounded-xl border border-l-4 p-4 shadow-sm ${slaPct >= 95 ? 'border-l-emerald-500' : slaPct >= 80 ? 'border-l-amber-500' : 'border-l-red-500'}`}>
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">SLA (&lt;30s)</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${slaPct >= 95 ? 'bg-emerald-50 text-emerald-700' : slaPct >= 80 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                                {slaPct >= 95 ? '✅ OK' : slaPct >= 80 ? '⚠️ Riesgo' : '🔴 Crítico'}
                            </span>
                        </div>
                        <p className="text-2xl font-bold text-gray-900">{slaPct}%</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{slaOk} de {withDur.length} en tiempo</p>
                    </div>

                    {/* Ahorro estimado */}
                    <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-teal-500 p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ahorro Estimado</span>
                            <span className="text-[10px] text-teal-600 font-semibold">@15min/ejecución</span>
                        </div>
                        <p className="text-2xl font-bold text-gray-900">${ahorroUsd.toLocaleString()}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">USD en {periodLabel(period)}</p>
                    </div>

                    {/* Flujos bloqueados */}
                    <div className={`bg-white rounded-xl border border-l-4 p-4 shadow-sm ${stuckRuns > 0 ? 'border-l-red-500' : 'border-l-gray-200'}`}>
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Bloqueados</span>
                            <span className="text-[10px] text-gray-400">+5 min sin completar</span>
                        </div>
                        <p className={`text-2xl font-bold ${stuckRuns > 0 ? 'text-red-600' : 'text-gray-900'}`}>{stuckRuns}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{stuckRuns > 0 ? 'Requieren atención' : 'Sin flujos bloqueados'}</p>
                    </div>

                    {/* Tasa de automatización */}
                    <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-indigo-500 p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Automatización</span>
                            <span className="text-[10px] text-indigo-500 font-semibold">cron vs manual</span>
                        </div>
                        <p className="text-2xl font-bold text-gray-900">
                            {total ? Math.round(runs.filter(r => r.triggered_by === 'cron').length / total * 100) : 0}%
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                            {runs.filter(r => r.triggered_by === 'cron').length} automáticas de {total}
                        </p>
                    </div>
                </div>

                {/* ── Bandeja Operativa ────────────────────────────────────── */}
                <BandejaOperativa runs={runs} retrying={retrying} handleRetry={handleRetry} onNavigate={onNavigate} />

                {/* ── Fila central ─────────────────────────────────────────── */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                    {/* Últimas ejecuciones */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                            <div className="flex items-center gap-2">
                                <Activity className="w-4 h-4 text-indigo-500" />
                                <h2 className="font-semibold text-gray-800 text-sm">Últimas Ejecuciones</h2>
                            </div>
                            <span className="text-xs text-gray-400">{total} en {periodLabel(period)}</span>
                        </div>
                        <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                            {loading ? (
                                <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-gray-300" /></div>
                            ) : recent.length === 0 ? (
                                <div className="py-10 text-center">
                                    <Inbox className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                    <p className="text-sm text-gray-400">Sin ejecuciones en este período</p>
                                </div>
                            ) : recent.map(r => {
                                const s = SC[r.status] ?? SC.cancelled;
                                return (
                                    <div key={r.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/80 transition-colors group">
                                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot} ${r.status === 'running' ? 'animate-pulse' : ''}`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 truncate">{r.workflow_name}</p>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-gray-400">{fmtRelative(r.started_at)}</span>
                                                <span className="text-[10px] text-indigo-500 font-medium">{TRIGGER[r.triggered_by] ?? r.triggered_by}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.bg} ${s.color} ${s.border}`}>{s.label}</span>
                                            <span className="text-[10px] text-gray-400">{fmt(r.duration_ms)}</span>
                                            {r.status === 'error' && (
                                                <>
                                                    <button onClick={() => handleRetry(r)} disabled={retrying === r.id}
                                                        title="Reintentar"
                                                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all">
                                                        <RotateCcw className={`w-3 h-3 ${retrying === r.id ? 'animate-spin' : ''}`} />
                                                    </button>
                                                    <button onClick={() => handleResolve(r)} disabled={resolving === r.id}
                                                        title="Marcar como resuelto"
                                                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all">
                                                        <CheckCircle className={`w-3 h-3 ${resolving === r.id ? 'animate-spin' : ''}`} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Panel derecho */}
                    <div className="space-y-4">

                        {/* Bandeja de acciones / errores */}
                        {errRuns.length > 0 ? (
                            <div className="bg-white rounded-2xl border border-red-100 shadow-sm overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-red-100 flex items-center justify-between bg-red-50/40">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4 text-red-500" />
                                        <h2 className="font-semibold text-red-800 text-sm">Errores Pendientes</h2>
                                    </div>
                                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">{errRuns.length}</span>
                                </div>
                                <div className="divide-y divide-red-50">
                                    {errRuns.map(r => (
                                        <div key={r.id} className="px-4 py-3 group">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-semibold text-gray-800 truncate">{r.workflow_name}</p>
                                                    <p className="text-[10px] text-red-500 truncate mt-0.5">{r.error_message ?? 'Error desconocido'}</p>
                                                    <p className="text-[10px] text-gray-400">{fmtDate(r.started_at)}</p>
                                                </div>
                                                <div className="flex flex-col gap-1 flex-shrink-0">
                                                    <button
                                                        onClick={() => handleRetry(r)}
                                                        disabled={retrying === r.id || resolving === r.id}
                                                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                                    >
                                                        <RotateCcw className={`w-3 h-3 ${retrying === r.id ? 'animate-spin' : ''}`} />
                                                        Reintentar
                                                    </button>
                                                    <button
                                                        onClick={() => handleResolve(r)}
                                                        disabled={resolving === r.id || retrying === r.id}
                                                        title="Marcar como resuelto — lo elimina de los paneles de error"
                                                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                                                    >
                                                        <CheckCircle className={`w-3 h-3 ${resolving === r.id ? 'animate-spin' : ''}`} />
                                                        Resuelto
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
                                <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                                <p className="text-sm font-semibold text-gray-700">Sin errores pendientes</p>
                                <p className="text-xs text-gray-400 mt-0.5">Todos los flujos operan correctamente</p>
                            </div>
                        )}

                        {/* Mis flujos */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                                <div className="flex items-center gap-2">
                                    <BarChart2 className="w-4 h-4 text-indigo-500" />
                                    <h2 className="font-semibold text-gray-800 text-sm">Mis Flujos</h2>
                                </div>
                                <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                                    {workflows.filter(w => w.isActive).length} activos
                                </span>
                            </div>
                            <div className="divide-y divide-gray-50 max-h-48 overflow-y-auto">
                                {workflows.length === 0 ? (
                                    <p className="text-sm text-gray-400 text-center py-6">Sin flujos aún</p>
                                ) : workflows.map(wf => (
                                    <div key={wf.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 transition-colors group">
                                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${wf.isActive ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-gray-800 truncate">{wf.name}</p>
                                            <p className="text-[10px] text-gray-400 truncate">
                                                {wf.executionCount} ejecuciones · 👤 {wf.responsible ?? 'Sin responsable'}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => toggleActive(wf)}
                                            className={`opacity-0 group-hover:opacity-100 text-[10px] px-2 py-0.5 rounded font-medium border transition-all ${
                                                wf.isActive
                                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                            }`}
                                        >
                                            {wf.isActive ? 'Pausar' : 'Activar'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Plantillas ───────────────────────────────────────────── */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                        <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-indigo-500" />
                            <h2 className="font-semibold text-gray-800 text-sm">Plantillas de Procesos</h2>
                            <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">Listas para usar</span>
                        </div>
                        <span className="text-xs text-gray-400">Ábrelas en el Constructor y ejecuta</span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-0 divide-x divide-y divide-gray-100">
                        {TEMPLATES.map(t => {
                            const Icon = t.icon;
                            const isCreating = creating === t.id;
                            return (
                                <div key={t.id} onClick={() => !isCreating && openWizard(t)} className={`p-4 hover:bg-gray-50 transition-colors group cursor-pointer ${isCreating ? 'opacity-60 pointer-events-none' : ''}`}>
                                    <div className={`w-9 h-9 rounded-xl ${t.bg} flex items-center justify-center mb-3`}>
                                        <Icon className={`w-4.5 h-4.5 ${t.color}`} style={{ width: '18px', height: '18px' }} />
                                    </div>
                                    <p className="text-xs font-bold text-gray-800 leading-tight mb-1">{t.name}</p>
                                    <p className="text-[10px] text-gray-400 leading-tight mb-2">{t.desc}</p>
                                    <div className="flex flex-wrap gap-1">
                                        {t.tags.map(tag => (
                                            <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-medium">{tag}</span>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-1 mt-2 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {isCreating
                                            ? <RefreshCw className="w-3 h-3 animate-spin" />
                                            : <Play className="w-3 h-3" />}
                                        <span className="text-[10px] font-semibold">
                                            {isCreating ? 'Creando...' : 'Usar plantilla'}
                                        </span>
                                        {!isCreating && <ChevronRight className="w-3 h-3" />}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── Flujos programados ───────────────────────────────────── */}
                <div className="bg-gradient-to-r from-[#0f1729] to-[#1a2744] rounded-2xl p-5 text-white shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-indigo-300" />
                            <h2 className="font-semibold text-sm">Flujos Programados (Cron Activo)</h2>
                        </div>
                        <div className={`flex items-center gap-1.5 ${cronSano ? 'text-emerald-400' : 'text-amber-300'}`}>
                            <div className={`w-2 h-2 rounded-full ${cronSano ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                            <span className="text-[10px] font-semibold">
                                {cronFlows.length === 0
                                    ? 'sin flujos programados'
                                    : ultimoCron
                                        ? `última automática ${fmtRelative(ultimoCron.started_at)}`
                                        : `sin ejecuciones automáticas · ${periodLabel(period).toLowerCase()}`}
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {cronFlows.length === 0 && !loading && (
                            <p className="text-xs text-white/30 col-span-3 py-2">
                                Sin flujos programados activos — crea uno con el nodo "Programado (Cron)" en el Constructor.
                            </p>
                        )}
                        {cronFlows.map(f => {
                            const ultima = runsCron.find(r => r.workflow_id === f.wfId);
                            return (
                            <div key={f.wfId} className="flex items-center justify-between bg-white/8 hover:bg-white/12 rounded-xl px-4 py-3 transition-colors">
                                <div>
                                    <p className="text-sm font-semibold">{f.name}</p>
                                    <p className="text-[10px] text-indigo-300 font-mono mt-0.5">{f.cron}</p>
                                    <p className="text-[10px] text-white/40 mt-0.5">
                                        {ultima ? `Última automática ${fmtRelative(ultima.started_at)}` : 'Sin ejecuciones automáticas'}
                                    </p>
                                </div>
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ultima ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            </div>
                            );
                        })}
                        <button
                            onClick={() => {
                                toast.info('En el Constructor: arrastra un nodo "Programado (Cron)" y configura la expresión horaria.');
                                onNavigate?.('canvas');
                            }}
                            className="flex items-center justify-center bg-white/5 rounded-xl px-4 py-3 border-2 border-dashed border-white/10 hover:border-indigo-500/40 hover:bg-white/8 transition-colors w-full text-left"
                        >
                            <div className="text-center">
                                <p className="text-xs text-white/40 font-medium">+ Agregar flujo programado</p>
                                <p className="text-[10px] text-white/20 mt-0.5">Ir al Constructor →</p>
                            </div>
                        </button>
                    </div>
                </div>

            </div>
        </div>

        {/* Wizard de plantilla */}
        {wizardTemplate && (
            <TemplateWizard
                template={wizardTemplate}
                blueprint={buildTemplate(wizardTemplate.id)}
                creating={creating === wizardTemplate.id}
                onCreate={createFromTemplate}
                onCancel={() => setWizardTemplate(null)}
            />
        )}
        </>
    );
}
