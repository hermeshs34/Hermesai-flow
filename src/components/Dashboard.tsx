import { useEffect, useState, useCallback } from 'react';
import {
    Zap, CheckCircle, AlertCircle, Clock, Play,
    RefreshCw, TrendingUp, Activity, ArrowRight,
    BarChart2, Calendar, Circle,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import type { Workflow } from '../types/workflow';
import { WorkflowService } from '../services/workflow.service';
import { toast } from 'sonner';

interface Stats {
    totalRuns:     number;
    successRuns:   number;
    errorRuns:     number;
    runningRuns:   number;
    activeFlows:   number;
    avgDurationMs: number;
}

interface RecentRun {
    id:            string;
    workflow_name: string;
    status:        string;
    started_at:    string;
    duration_ms:   number | null;
    logs_count:    number;
    triggered_by:  string;
}

function fmt(ms: number | null): string {
    if (!ms) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

function fmtRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min  = Math.floor(diff / 60000);
    if (min < 1)   return 'Ahora mismo';
    if (min < 60)  return `hace ${min}m`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24)  return `hace ${hrs}h`;
    return `hace ${Math.floor(hrs / 24)}d`;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
    success:  { label: 'Exitoso',    color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200',  icon: CheckCircle },
    error:    { label: 'Error',      color: 'text-red-700',     bg: 'bg-red-50 border-red-200',          icon: AlertCircle },
    running:  { label: 'Corriendo',  color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',        icon: RefreshCw   },
    cancelled:{ label: 'Cancelado',  color: 'text-gray-500',    bg: 'bg-gray-50 border-gray-200',        icon: Circle      },
};

const TRIGGER_LABEL: Record<string, string> = {
    manual: '▶ Manual',
    cron:   '⏰ Programado',
    webhook:'⚡ Webhook',
};

export function Dashboard() {
    const [stats,     setStats]     = useState<Stats | null>(null);
    const [recent,    setRecent]    = useState<RecentRun[]>([]);
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading,   setLoading]   = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [runsRes, wfsRes] = await Promise.all([
                supabase
                    .from('execution_runs')
                    .select('id, status, started_at, duration_ms, logs_count, triggered_by, workflows(name)')
                    .order('started_at', { ascending: false })
                    .limit(200),
                supabase
                    .from('workflows')
                    .select('id, name, status, is_active, execution_count, last_run_at, created_at')
                    .order('execution_count', { ascending: false })
                    .limit(50),
            ]);

            const runs: any[] = runsRes.data ?? [];
            const wfs:  any[] = wfsRes.data  ?? [];

            const successCount = runs.filter(r => r.status === 'success').length;
            const errorCount   = runs.filter(r => r.status === 'error').length;
            const runningCount = runs.filter(r => r.status === 'running').length;
            const withDur      = runs.filter(r => r.duration_ms);
            const avgDur       = withDur.length
                ? Math.round(withDur.reduce((s, r) => s + r.duration_ms, 0) / withDur.length)
                : 0;

            setStats({ totalRuns: runs.length, successRuns: successCount, errorRuns: errorCount, runningRuns: runningCount, activeFlows: wfs.filter(w => w.is_active).length, avgDurationMs: avgDur });
            setRecent(runs.slice(0, 10).map(r => ({ id: r.id, workflow_name: r.workflows?.name ?? '—', status: r.status, started_at: r.started_at, duration_ms: r.duration_ms, logs_count: r.logs_count, triggered_by: r.triggered_by ?? 'manual' })));
            setWorkflows(wfs.map(w => ({ id: w.id, name: w.name, description: '', nodes: [], connections: [], isActive: w.is_active, createdAt: w.created_at, lastRun: w.last_run_at, executionCount: w.execution_count ?? 0, status: w.status ?? 'paused' })));
        } catch {
            toast.error('Error cargando dashboard');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const ch = supabase.channel('dash_runs')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'execution_runs' }, load)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [load]);

    const toggleActive = async (wf: Workflow) => {
        try {
            await WorkflowService.updateWorkflow(wf.id, wf.id, { isActive: !wf.isActive });
            setWorkflows(prev => prev.map(w => w.id === wf.id ? { ...w, isActive: !w.isActive } : w));
            toast.success(wf.isActive ? `"${wf.name}" pausado` : `"${wf.name}" activado`);
        } catch {
            toast.error('No se pudo actualizar el flujo');
        }
    };

    const successRate = stats?.totalRuns ? Math.round((stats.successRuns / stats.totalRuns) * 100) : 0;

    // Salud del sistema
    const health = successRate >= 90 ? 'Óptimo' : successRate >= 70 ? 'Normal' : 'Atención';
    const healthColor = successRate >= 90 ? 'text-emerald-600' : successRate >= 70 ? 'text-amber-600' : 'text-red-600';
    const healthBg    = successRate >= 90 ? 'from-emerald-500 to-teal-600' : successRate >= 70 ? 'from-amber-500 to-orange-500' : 'from-red-500 to-rose-600';

    return (
        <div className="h-full overflow-y-auto bg-gray-50">
            <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

                {/* ── Header con gradiente ─────────────────────────────── */}
                <div className={`bg-gradient-to-r ${healthBg} rounded-2xl p-6 text-white shadow-lg`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-white/70 text-sm font-medium mb-1">Estado del Hub</p>
                            <h1 className="text-3xl font-bold">{health}</h1>
                            <p className="text-white/80 text-sm mt-1">
                                {stats?.totalRuns ?? 0} ejecuciones · {successRate}% éxito · {fmt(stats?.avgDurationMs ?? null)} promedio
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="w-20 h-20 relative flex items-center justify-center">
                                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
                                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="white" strokeWidth="3"
                                        strokeDasharray={`${successRate} ${100 - successRate}`}
                                        strokeLinecap="round" />
                                </svg>
                                <span className="absolute text-lg font-bold">{successRate}%</span>
                            </div>
                            <p className="text-white/70 text-xs mt-1">Tasa de éxito</p>
                        </div>
                    </div>
                    {stats?.runningRuns ? (
                        <div className="mt-3 flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1.5 w-fit">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span className="text-sm font-medium">{stats.runningRuns} flujo(s) ejecutándose ahora</span>
                        </div>
                    ) : null}
                </div>

                {/* ── KPI Cards ───────────────────────────────────────── */}
                {loading ? (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[0,1,2,3].map(i => <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse h-24" />)}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                            { label: 'Total Ejecuciones', value: stats?.totalRuns ?? 0,     icon: Zap,          bg: 'bg-indigo-50',  ic: 'text-indigo-600', border: 'border-l-indigo-500'  },
                            { label: 'Exitosas',          value: stats?.successRuns ?? 0,   icon: CheckCircle,  bg: 'bg-emerald-50', ic: 'text-emerald-600',border: 'border-l-emerald-500' },
                            { label: 'Con Error',         value: stats?.errorRuns ?? 0,     icon: AlertCircle,  bg: 'bg-red-50',     ic: 'text-red-500',    border: 'border-l-red-500'     },
                            { label: 'Tiempo Promedio',   value: fmt(stats?.avgDurationMs ?? null), icon: TrendingUp, bg: 'bg-blue-50', ic: 'text-blue-600', border: 'border-l-blue-500'  },
                        ].map(({ label, value, icon: Icon, bg, ic, border }) => (
                            <div key={label} className={`bg-white rounded-xl border border-gray-100 border-l-4 ${border} p-5 shadow-sm`}>
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
                                    <div className={`p-2 rounded-lg ${bg}`}>
                                        <Icon className={`w-4 h-4 ${ic}`} />
                                    </div>
                                </div>
                                <p className="text-2xl font-bold text-gray-900">{value}</p>
                            </div>
                        ))}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* ── Ejecuciones recientes ─────────────────────── */}
                    <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <div className="flex items-center gap-2">
                                <Activity className="w-4 h-4 text-indigo-500" />
                                <h2 className="font-semibold text-gray-800 text-sm">Últimas Ejecuciones</h2>
                            </div>
                            <button onClick={load} disabled={loading} className="text-xs text-gray-400 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Actualizar
                            </button>
                        </div>
                        <div className="divide-y divide-gray-50">
                            {recent.length === 0 ? (
                                <div className="py-12 text-center">
                                    <Zap className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                                    <p className="text-sm text-gray-400">Sin ejecuciones aún</p>
                                    <p className="text-xs text-gray-300 mt-1">Ejecuta tu primer flujo desde el Constructor</p>
                                </div>
                            ) : (
                                recent.map(r => {
                                    const sc = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.cancelled;
                                    const Icon = sc.icon;
                                    return (
                                        <div key={r.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/80 transition-colors">
                                            <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${sc.bg}`}>
                                                <Icon className={`w-3.5 h-3.5 ${sc.color} ${r.status === 'running' ? 'animate-spin' : ''}`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-gray-900 truncate">{r.workflow_name}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] text-gray-400">{fmtRelative(r.started_at)}</span>
                                                    <span className="text-[10px] text-gray-300">·</span>
                                                    <span className="text-[10px] text-indigo-500 font-medium">{TRIGGER_LABEL[r.triggered_by] ?? r.triggered_by}</span>
                                                </div>
                                            </div>
                                            <div className="text-right flex-shrink-0 space-y-0.5">
                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>{sc.label}</span>
                                                <p className="text-[10px] text-gray-400">{fmt(r.duration_ms)} · {r.logs_count} pasos</p>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* ── Panel derecho ─────────────────────────────── */}
                    <div className="space-y-4">

                        {/* Mis flujos */}
                        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <BarChart2 className="w-4 h-4 text-indigo-500" />
                                    <h2 className="font-semibold text-gray-800 text-sm">Mis Flujos</h2>
                                </div>
                                <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                                    {workflows.filter(w => w.isActive).length} activos
                                </span>
                            </div>
                            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                                {workflows.length === 0 ? (
                                    <p className="text-sm text-gray-400 text-center py-8">Sin flujos aún</p>
                                ) : (
                                    workflows.map(wf => (
                                        <div key={wf.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors group">
                                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${wf.isActive ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-900 truncate">{wf.name}</p>
                                                <p className="text-[10px] text-gray-400">
                                                    {wf.executionCount} runs
                                                    {wf.lastRun && ` · ${fmtDate(wf.lastRun)}`}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => toggleActive(wf)}
                                                className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-md border font-medium transition-all opacity-0 group-hover:opacity-100 ${
                                                    wf.isActive
                                                        ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                }`}
                                            >
                                                {wf.isActive ? 'Pausar' : 'Activar'}
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Guía rápida */}
                        <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-xl p-5 text-white shadow-lg">
                            <div className="flex items-center gap-2 mb-3">
                                <Calendar className="w-4 h-4 text-indigo-200" />
                                <p className="text-sm font-semibold">Flujos Programados</p>
                            </div>
                            <div className="space-y-2">
                                {[
                                    { name: 'Tasa BCV Diaria',      cron: 'Lun–Vie 9am'  },
                                    { name: 'Monitor Indicadores',  cron: 'Lunes 8am'    },
                                ].map(f => (
                                    <div key={f.name} className="flex items-center justify-between bg-white/10 rounded-lg px-3 py-2">
                                        <div>
                                            <p className="text-xs font-semibold">{f.name}</p>
                                            <p className="text-[10px] text-indigo-200">{f.cron}</p>
                                        </div>
                                        <ArrowRight className="w-3.5 h-3.5 text-indigo-300" />
                                    </div>
                                ))}
                            </div>
                            <p className="text-[10px] text-indigo-300 mt-3">
                                Cron activo — se ejecutan automáticamente vía pg_cron
                            </p>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
