import { useEffect, useState, useCallback } from 'react';
import {
    Zap, CheckCircle, AlertCircle, RefreshCw,
    TrendingUp, Activity, BarChart2,
    Calendar, Play, RotateCcw, BookOpen, Filter,
    ChevronRight, Inbox, GitBranch,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import type { Workflow } from '../types/workflow';
import type { User } from '../core/user.types';
import { WorkflowService } from '../services/workflow.service';
import { toast } from 'sonner';

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
    return new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

// ── Componente principal ──────────────────────────────────────────────────────
interface DashboardProps {
    onNavigate?:  (view: 'canvas' | 'monitoring' | 'settings' | 'dashboard') => void;
    currentUser?: User;
}

export function Dashboard({ onNavigate, currentUser }: DashboardProps) {
    const [runs,       setRuns]       = useState<RunRow[]>([]);
    const [workflows,  setWorkflows]  = useState<Workflow[]>([]);
    const [cronFlows,  setCronFlows]  = useState<{name:string;cron:string;wfId:string}[]>([]);
    const [loading,    setLoading]    = useState(true);
    const [period,     setPeriod]     = useState<Period>('7d');
    const [retrying,   setRetrying]   = useState<string | null>(null);
    const [creating,   setCreating]   = useState<string | null>(null);

    const orgId = currentUser?.organizationId ?? '';

    const goToCanvas = (templateName?: string) => {
        if (templateName) toast.info(`Abre el Constructor y crea el flujo "${templateName}" desde cero con los nodos de la paleta.`);
        onNavigate?.('canvas');
    };

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
                supabase.from('workflows').select('id, name, status, is_active, execution_count, last_run_at, created_at').order('execution_count', { ascending: false }).limit(50),
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

    const handleRetry = async (run: RunRow) => {
        setRetrying(run.id);
        try {
            const { error } = await supabase.functions.invoke('execute-workflow', {
                body: { workflowId: run.workflow_id, organizationId: run.organization_id, triggeredBy: 'manual' },
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

    // BUG FIX: usar orgId real, no wf.id como organizationId
    const toggleActive = async (wf: Workflow) => {
        if (!orgId) { toast.error('Sin organización activa'); return; }
        try {
            await WorkflowService.updateWorkflow(wf.id, orgId, { isActive: !wf.isActive });
            setWorkflows(prev => prev.map(w => w.id === wf.id ? { ...w, isActive: !w.isActive } : w));
            toast.success(wf.isActive ? `"${wf.name}" pausado` : `"${wf.name}" activado`);
        } catch { toast.error('No se pudo actualizar el flujo'); }
    };

    // Plantilla: crear flujo pre-configurado y abrir en canvas
    const createFromTemplate = async (t: typeof TEMPLATES[0]) => {
        if (!orgId) { goToCanvas(t.name); return; }
        setCreating(t.id);
        try {
            const userId = currentUser?.id ?? '';
            const wf = await WorkflowService.createWorkflow(orgId, userId, {
                name: t.name,
                description: t.desc,
            });
            // Guardar en localStorage para que el canvas lo abra automáticamente
            localStorage.setItem('hermesai_open_workflow', wf.id);
            toast.success(`Flujo "${t.name}" creado — ábrelo en el Constructor`);
            onNavigate?.('canvas');
        } catch {
            toast.info(`Navega al Constructor y crea "${t.name}" manualmente`);
            onNavigate?.('canvas');
        } finally {
            setCreating(null);
        }
    };

    // ── KPIs calculados ─────────────────────────────────────────────────────
    const total    = runs.length;
    const success  = runs.filter(r => r.status === 'success').length;
    const errors   = runs.filter(r => r.status === 'error').length;
    const running  = runs.filter(r => r.status === 'running').length;
    const withDur  = runs.filter(r => r.duration_ms);
    const avgDur   = withDur.length ? Math.round(withDur.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / withDur.length) : 0;
    const rate     = total ? Math.round((success / total) * 100) : 0;
    const errRuns  = runs.filter(r => r.status === 'error').slice(0, 5);
    const recent   = runs.slice(0, 12);

    const health      = rate >= 90 ? 'Óptimo' : rate >= 70 ? 'Normal' : 'Atención requerida';
    const healthGrad  = rate >= 90 ? 'from-emerald-600 to-teal-600' : rate >= 70 ? 'from-amber-500 to-orange-500' : 'from-red-600 to-rose-600';

    return (
        <div className="h-full overflow-y-auto bg-[#f0f2f5]">
            <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

                {/* ── Barra superior ──────────────────────────────────────── */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Centro de Comando</h1>
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

                {/* ── Header de salud ─────────────────────────────────────── */}
                <div className={`bg-gradient-to-r ${healthGrad} rounded-2xl p-6 text-white shadow-lg`}>
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div>
                            <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-1">Estado del Sistema</p>
                            <h2 className="text-3xl font-bold">{health}</h2>
                            <p className="text-white/80 text-sm mt-1">{periodLabel(period)}</p>
                        </div>
                        <div className="flex items-center gap-6">
                            {running > 0 && (
                                <div className="flex items-center gap-2 bg-white/20 rounded-xl px-4 py-2">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span className="text-sm font-semibold">{running} ejecutándose</span>
                                </div>
                            )}
                            <div className="text-center">
                                <div className="relative w-20 h-20">
                                    <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3.2" />
                                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="white" strokeWidth="3.2"
                                            strokeDasharray={`${rate} ${100 - rate}`} strokeLinecap="round" />
                                    </svg>
                                    <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">{rate}%</span>
                                </div>
                                <p className="text-white/70 text-[10px] mt-1">Tasa de éxito</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── KPI Cards ────────────────────────────────────────────── */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    {[
                        { label: 'Ejecuciones',     value: total,             icon: Zap,          bl: 'border-l-indigo-500',  ic: 'text-indigo-500', bg: 'bg-indigo-50' },
                        { label: 'Exitosas',         value: success,           icon: CheckCircle,  bl: 'border-l-emerald-500', ic: 'text-emerald-500',bg: 'bg-emerald-50' },
                        { label: 'Con Error',        value: errors,            icon: AlertCircle,  bl: 'border-l-red-500',     ic: 'text-red-500',    bg: 'bg-red-50' },
                        { label: 'Flujos Activos',   value: workflows.filter(w => w.isActive).length, icon: Activity, bl: 'border-l-blue-500', ic: 'text-blue-500', bg: 'bg-blue-50' },
                        { label: 'Tiempo Promedio',  value: fmt(avgDur),       icon: TrendingUp,   bl: 'border-l-violet-500',  ic: 'text-violet-500', bg: 'bg-violet-50' },
                    ].map(({ label, value, icon: Icon, bl, ic, bg }) => (
                        <div key={label} className={`bg-white rounded-xl border border-gray-100 border-l-4 ${bl} p-4 shadow-sm hover:shadow-md transition-shadow`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
                                <div className={`p-1.5 rounded-lg ${bg}`}>
                                    <Icon className={`w-3.5 h-3.5 ${ic}`} />
                                </div>
                            </div>
                            <p className="text-2xl font-bold text-gray-900">{value}</p>
                        </div>
                    ))}
                </div>

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
                                                <button
                                                    onClick={() => handleRetry(r)}
                                                    disabled={retrying === r.id}
                                                    title="Reintentar"
                                                    className="opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all"
                                                >
                                                    <RotateCcw className={`w-3 h-3 ${retrying === r.id ? 'animate-spin' : ''}`} />
                                                </button>
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
                                                <button
                                                    onClick={() => handleRetry(r)}
                                                    disabled={retrying === r.id}
                                                    className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                                >
                                                    <RotateCcw className={`w-3 h-3 ${retrying === r.id ? 'animate-spin' : ''}`} />
                                                    Reintentar
                                                </button>
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
                                            <p className="text-[10px] text-gray-400">{wf.executionCount} ejecuciones</p>
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
                                <div key={t.id} onClick={() => !isCreating && createFromTemplate(t)} className={`p-4 hover:bg-gray-50 transition-colors group cursor-pointer ${isCreating ? 'opacity-60 pointer-events-none' : ''}`}>
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
                                            {isCreating ? 'Creando...' : 'Crear flujo'}
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
                        <div className="flex items-center gap-1.5 text-emerald-400">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[10px] font-semibold">pg_cron activo</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {cronFlows.length === 0 && !loading && (
                            <p className="text-xs text-white/30 col-span-3 py-2">
                                Sin flujos programados activos — crea uno con el nodo "Programado (Cron)" en el Constructor.
                            </p>
                        )}
                        {cronFlows.map(f => (
                            <div key={f.wfId} className="flex items-center justify-between bg-white/8 hover:bg-white/12 rounded-xl px-4 py-3 transition-colors">
                                <div>
                                    <p className="text-sm font-semibold">{f.name}</p>
                                    <p className="text-[10px] text-indigo-300 font-mono mt-0.5">{f.cron}</p>
                                    <p className="text-[10px] text-white/40 mt-0.5">Activo · pg_cron</p>
                                </div>
                                <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                            </div>
                        ))}
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
    );
}
