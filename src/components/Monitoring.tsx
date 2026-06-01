import { useState, useEffect, useCallback } from 'react';
import {
    Activity, AlertCircle, CheckCircle, Clock,
    RefreshCw, Filter, Loader2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { supabase } from '../core/supabase';

interface RunRow {
    id:           string;
    workflow_id:  string;
    workflow_name?: string;
    triggered_by: string;
    status:       'running' | 'success' | 'error' | 'cancelled';
    started_at:   string;
    finished_at:  string | null;
    duration_ms:  number | null;
    logs_count:   number;
    error_message:string | null;
}

interface LogRow {
    id:           string;
    workflow_id:  string;
    node_id:      string | null;
    status:       string;
    message:      string;
    timestamp:    string;
    details:      string | null;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
    success:               <CheckCircle  className="w-4 h-4 text-green-500" />,
    error:                 <AlertCircle  className="w-4 h-4 text-red-500"   />,
    running:               <RefreshCw    className="w-4 h-4 text-blue-500 animate-spin" />,
    cancelled:             <Clock        className="w-4 h-4 text-gray-400"  />,
    info:                  <Activity     className="w-4 h-4 text-blue-400"  />,
    warning:               <Clock        className="w-4 h-4 text-yellow-500"/>,
    esperando_aprobacion:  <Clock        className="w-4 h-4 text-amber-500" />,
    rechazado:             <AlertCircle  className="w-4 h-4 text-red-400"   />,
};

const STATUS_BADGE: Record<string, string> = {
    success:              'bg-green-100 text-green-700',
    error:                'bg-red-100 text-red-700',
    running:              'bg-blue-100 text-blue-700',
    cancelled:            'bg-gray-100 text-gray-500',
    esperando_aprobacion: 'bg-amber-100 text-amber-700',
    rechazado:            'bg-red-100 text-red-600',
};

function fmt(ms: number | null): string {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// ── Entrada de log expandible ─────────────────────────────────────────────────
function LogEntry({ log }: { log: LogRow }) {
    const [open, setOpen] = useState(false);

    const details = log.details
        ? (typeof log.details === 'string' ? (() => { try { return JSON.parse(log.details); } catch { return null; } })() : log.details)
        : null;

    const hasDetails = details && typeof details === 'object' && Object.keys(details).length > 0;

    const colorClass =
        log.status === 'error'   ? 'bg-red-50 border-red-100 text-red-800' :
        log.status === 'success' ? 'bg-green-50 border-green-100 text-green-800' :
        log.status === 'warning' ? 'bg-yellow-50 border-yellow-100 text-yellow-800' :
        'bg-gray-50 border-gray-100 text-gray-700';

    return (
        <div className={`rounded-lg border ${colorClass}`}>
            <div
                className={`flex gap-3 p-2.5 ${hasDetails ? 'cursor-pointer select-none' : ''}`}
                onClick={() => hasDetails && setOpen(o => !o)}
            >
                <span className="flex-shrink-0 text-gray-400 text-[10px] mt-0.5 w-16 text-right">
                    {new Date(log.timestamp).toLocaleTimeString('es-VE')}
                </span>
                <span className="flex-shrink-0">{STATUS_ICON[log.status] ?? STATUS_ICON.info}</span>
                <span className="flex-1 break-all">{log.message}</span>
                {hasDetails && (
                    open
                        ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-50" />
                        : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-50" />
                )}
            </div>

            {open && hasDetails && (
                <div className="px-3 pb-3 pt-0 border-t border-current border-opacity-10">
                    <table className="w-full text-[11px] mt-2">
                        <tbody>
                            {Object.entries(details).map(([k, v]) => {
                                if (['skipped','triggered','branch','evaluated','indicadores','alertas_activas','siniestros'].includes(k)) return null;
                                const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                                const val   = Array.isArray(v) ? `${(v as any[]).length} registros`
                                            : typeof v === 'object' ? JSON.stringify(v)
                                            : String(v ?? '—');
                                return (
                                    <tr key={k} className="border-b border-current border-opacity-10 last:border-0">
                                        <td className="py-1 pr-3 opacity-60 w-40 font-medium">{label}</td>
                                        <td className="py-1 font-semibold break-all">{val}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export function Monitoring() {
    const [runs,         setRuns]         = useState<RunRow[]>([]);
    const [logs,         setLogs]         = useState<LogRow[]>([]);
    const [selectedRun,  setSelectedRun]  = useState<RunRow | null>(null);
    const [filterStatus, setFilterStatus] = useState('all');
    const [loading,      setLoading]      = useState(true);
    const [logsLoading,  setLogsLoading]  = useState(false);

    const loadRuns = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('execution_runs')
                .select(`
                    id, workflow_id, triggered_by, status,
                    started_at, finished_at, duration_ms, logs_count, error_message,
                    workflows(name)
                `)
                .order('started_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            const mapped: RunRow[] = (data ?? []).map((r: any) => ({
                ...r,
                workflow_name: r.workflows?.name ?? r.workflow_id,
            }));
            setRuns(mapped);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadRuns(); }, [loadRuns]);

    // Supabase Realtime — escuchar nuevas ejecuciones
    useEffect(() => {
        const channel = supabase
            .channel('execution_runs_changes')
            .on('postgres_changes', {
                event:  '*',
                schema: 'public',
                table:  'execution_runs',
            }, () => { loadRuns(); })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [loadRuns]);

    const loadLogs = async (run: RunRow) => {
        setSelectedRun(run);
        setLogsLoading(true);
        try {
            const { data } = await supabase
                .from('execution_logs')
                .select('id, workflow_id, node_id, status, message, executed_at, details_json')
                .eq('execution_run_id', run.id)
                .order('executed_at', { ascending: true });

            // Normalizar nombres de columna para el componente
            const normalized = (data ?? []).map((r: any) => ({
                ...r,
                timestamp: r.executed_at,
                details:   r.details_json,
            }));
            setLogs(normalized);
        } finally {
            setLogsLoading(false);
        }
    };

    const filtered = filterStatus === 'all'
        ? runs
        : runs.filter(r => r.status === filterStatus);

    const counts = {
        all:       runs.length,
        success:   runs.filter(r => r.status === 'success').length,
        error:     runs.filter(r => r.status === 'error').length,
        running:   runs.filter(r => r.status === 'running').length,
    };

    const successRate = runs.length
        ? Math.round((counts.success / runs.length) * 100)
        : 0;

    const avgDuration = runs.filter(r => r.duration_ms).length
        ? Math.round(runs.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / runs.filter(r => r.duration_ms).length)
        : 0;

    return (
        <div className="h-full flex overflow-hidden bg-gray-50">

            {/* Panel izquierdo — lista de runs */}
            <div className="w-96 flex flex-col border-r border-gray-200 bg-white flex-shrink-0">

                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                        <h1 className="font-bold text-gray-900">Monitoreo</h1>
                        <button
                            onClick={loadRuns}
                            disabled={loading}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-40"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    {/* Stats mini */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-center p-2 bg-gray-50 rounded-lg">
                            <div className="text-lg font-bold text-gray-900">{counts.all}</div>
                            <div className="text-[10px] text-gray-500">Total</div>
                        </div>
                        <div className="text-center p-2 bg-green-50 rounded-lg">
                            <div className="text-lg font-bold text-green-600">{successRate}%</div>
                            <div className="text-[10px] text-gray-500">Éxito</div>
                        </div>
                        <div className="text-center p-2 bg-blue-50 rounded-lg">
                            <div className="text-lg font-bold text-blue-600">{fmt(avgDuration)}</div>
                            <div className="text-[10px] text-gray-500">Prom.</div>
                        </div>
                    </div>

                    {/* Filtro */}
                    <div className="flex gap-1.5">
                        {(['all', 'success', 'error', 'running'] as const).map(s => (
                            <button
                                key={s}
                                onClick={() => setFilterStatus(s)}
                                className={`flex-1 text-xs py-1 rounded-lg font-medium transition-colors ${
                                    filterStatus === s
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                {s === 'all' ? 'Todos' : s.charAt(0).toUpperCase() + s.slice(1)}
                                {s !== 'all' && <span className="ml-1 opacity-70">({counts[s]})</span>}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Lista de runs */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-32">
                            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
                            <p className="text-sm">Sin ejecuciones aún</p>
                            <p className="text-xs mt-1">Ejecuta un flujo desde el Constructor</p>
                        </div>
                    ) : (
                        filtered.map(run => (
                            <button
                                key={run.id}
                                onClick={() => loadLogs(run)}
                                className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                                    selectedRun?.id === run.id ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : ''
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        {STATUS_ICON[run.status] ?? STATUS_ICON.info}
                                        <span className="text-sm font-medium text-gray-900 truncate max-w-[140px]">
                                            {run.workflow_name}
                                        </span>
                                    </div>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[run.status] ?? 'bg-gray-100 text-gray-500'}`}>
                                        {run.status}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-xs text-gray-400">
                                    <span>{fmtDate(run.started_at)}</span>
                                    <span>{fmt(run.duration_ms)} · {run.logs_count} pasos</span>
                                </div>
                                {run.error_message && (
                                    <p className="text-xs text-red-500 mt-1 truncate">{run.error_message}</p>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Panel derecho — detalle de logs */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {!selectedRun ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                            <Filter className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Selecciona una ejecución para ver el detalle</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Header del run seleccionado */}
                        <div className="p-4 bg-white border-b border-gray-200">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="font-bold text-gray-900">{selectedRun.workflow_name}</h2>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {fmtDate(selectedRun.started_at)}
                                        {selectedRun.finished_at && ` → ${fmtDate(selectedRun.finished_at)}`}
                                        {' · '}{fmt(selectedRun.duration_ms)}
                                        {' · Disparado por: '}{selectedRun.triggered_by}
                                    </p>
                                </div>
                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${STATUS_BADGE[selectedRun.status]}`}>
                                    {selectedRun.status.toUpperCase()}
                                </span>
                            </div>
                        </div>

                        {/* Logs */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 font-mono text-xs">
                            {logsLoading ? (
                                <div className="flex items-center justify-center h-20">
                                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                                </div>
                            ) : logs.length === 0 ? (
                                <p className="text-gray-400 text-center py-8">Sin logs registrados</p>
                            ) : (
                                logs.map(log => <LogEntry key={log.id} log={log} />)
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
