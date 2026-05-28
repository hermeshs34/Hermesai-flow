import { useEffect, useState, useCallback } from 'react';
import {
    Zap, CheckCircle, AlertCircle, Clock,
    Play, Pause, RefreshCw, TrendingUp, Activity,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import type { Workflow } from '../types/workflow';
import { WorkflowService } from '../services/workflow.service';
import { toast } from 'sonner';

interface Stats {
    totalRuns:    number;
    successRuns:  number;
    errorRuns:    number;
    activeFlows:  number;
    avgDurationMs: number;
}

interface RecentRun {
    id:            string;
    workflow_name: string;
    status:        string;
    started_at:    string;
    duration_ms:   number | null;
    logs_count:    number;
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
                    .select(`
                        id, status, started_at, duration_ms, logs_count,
                        workflows(name)
                    `)
                    .order('started_at', { ascending: false })
                    .limit(200),
                supabase
                    .from('workflows')
                    .select('id, name, status, is_active, execution_count, last_run_at, created_at')
                    .order('created_at', { ascending: false })
                    .limit(50),
            ]);

            const runs: any[] = runsRes.data ?? [];
            const wfs:  any[] = wfsRes.data  ?? [];

            const successCount  = runs.filter(r => r.status === 'success').length;
            const errorCount    = runs.filter(r => r.status === 'error').length;
            const withDuration  = runs.filter(r => r.duration_ms);
            const avgDur        = withDuration.length
                ? Math.round(withDuration.reduce((s, r) => s + r.duration_ms, 0) / withDuration.length)
                : 0;

            setStats({
                totalRuns:     runs.length,
                successRuns:   successCount,
                errorRuns:     errorCount,
                activeFlows:   wfs.filter(w => w.is_active).length,
                avgDurationMs: avgDur,
            });

            setRecent(
                runs.slice(0, 8).map(r => ({
                    id:            r.id,
                    workflow_name: r.workflows?.name ?? '—',
                    status:        r.status,
                    started_at:    r.started_at,
                    duration_ms:   r.duration_ms,
                    logs_count:    r.logs_count,
                }))
            );

            setWorkflows(wfs.map(w => ({
                id:             w.id,
                name:           w.name,
                description:    '',
                nodes:          [],
                connections:    [],
                isActive:       w.is_active,
                createdAt:      w.created_at,
                lastRun:        w.last_run_at,
                executionCount: w.execution_count ?? 0,
                status:         w.status ?? 'paused',
            })));
        } catch (err: any) {
            toast.error('Error cargando dashboard');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Realtime — refrescar cuando haya nuevas ejecuciones
    useEffect(() => {
        const ch = supabase
            .channel('dashboard_runs')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'execution_runs' }, load)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [load]);

    const toggleActive = async (wf: Workflow) => {
        try {
            await WorkflowService.updateWorkflow(wf.id, wf.id, { isActive: !wf.isActive });
            setWorkflows(prev => prev.map(w => w.id === wf.id ? { ...w, isActive: !w.isActive } : w));
        } catch {
            toast.error('No se pudo actualizar el flujo');
        }
    };

    const STATUS_ICON: Record<string, React.ReactNode> = {
        success:  <CheckCircle className="w-4 h-4 text-green-500" />,
        error:    <AlertCircle className="w-4 h-4 text-red-500"   />,
        running:  <RefreshCw   className="w-4 h-4 text-blue-500 animate-spin" />,
        default:  <Clock       className="w-4 h-4 text-gray-400"  />,
    };

    const successRate = stats && stats.totalRuns
        ? Math.round((stats.successRuns / stats.totalRuns) * 100)
        : 0;

    const STAT_CARDS = stats ? [
        { label: 'Total Ejecuciones',   value: stats.totalRuns,    icon: Zap,          color: 'indigo', sub: 'histórico' },
        { label: 'Exitosas',            value: stats.successRuns,  icon: CheckCircle,  color: 'green',  sub: `${successRate}% tasa éxito` },
        { label: 'Con Error',           value: stats.errorRuns,    icon: AlertCircle,  color: 'red',    sub: 'requieren revisión' },
        { label: 'Tiempo Promedio',     value: fmt(stats.avgDurationMs), icon: TrendingUp, color: 'blue', sub: 'por ejecución' },
    ] : [];

    return (
        <div className="p-6 space-y-6 overflow-y-auto h-full bg-gray-50">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                    <p className="text-sm text-gray-500 mt-0.5">Vista general de flujos y ejecuciones</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Actualizar
                </button>
            </header>

            {/* KPI Cards */}
            {loading ? (
                <div className="grid grid-cols-4 gap-4">
                    {[0,1,2,3].map(i => (
                        <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse h-24" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {STAT_CARDS.map(({ label, value, icon: Icon, color, sub }) => (
                        <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-sm text-gray-500">{label}</span>
                                <div className={`p-2 rounded-lg bg-${color}-50`}>
                                    <Icon className={`w-4 h-4 text-${color}-500`} />
                                </div>
                            </div>
                            <p className="text-2xl font-bold text-gray-900">{value}</p>
                            <p className="text-xs text-gray-400 mt-1">{sub}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Ejecuciones recientes */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                        <h2 className="font-semibold text-gray-900 text-sm">Últimas Ejecuciones</h2>
                        <Activity className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="divide-y divide-gray-50">
                        {recent.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-8">
                                Sin ejecuciones — ejecuta tu primer flujo desde el Constructor
                            </p>
                        ) : (
                            recent.map(r => (
                                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                                    {STATUS_ICON[r.status] ?? STATUS_ICON.default}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">{r.workflow_name}</p>
                                        <p className="text-xs text-gray-400">{fmtDate(r.started_at)}</p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <p className="text-xs text-gray-500">{fmt(r.duration_ms)}</p>
                                        <p className="text-xs text-gray-400">{r.logs_count} pasos</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Mis flujos */}
                <div className="bg-white rounded-xl border border-gray-200">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                        <h2 className="font-semibold text-gray-900 text-sm">Mis Flujos</h2>
                        <span className="text-xs text-gray-400">{workflows.length} total</span>
                    </div>
                    <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                        {workflows.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-8">
                                Sin flujos — crea el primero en el Constructor
                            </p>
                        ) : (
                            workflows.map(wf => (
                                <div key={wf.id} className="flex items-center gap-3 px-4 py-3">
                                    <button
                                        onClick={() => toggleActive(wf)}
                                        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                            wf.isActive
                                                ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                        }`}
                                        title={wf.isActive ? 'Pausar' : 'Activar'}
                                    >
                                        {wf.isActive ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">{wf.name}</p>
                                        <p className="text-xs text-gray-400">
                                            {wf.executionCount} ejecuciones
                                            {wf.lastRun && ` · ${fmtDate(wf.lastRun)}`}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
