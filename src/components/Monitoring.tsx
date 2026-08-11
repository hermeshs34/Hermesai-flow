import { useState, useEffect, useCallback } from 'react';
import {
    Activity, AlertCircle, CheckCircle, Clock,
    RefreshCw, Filter, Loader2, ChevronDown, ChevronRight, RotateCcw,
    Play, Zap, Mail, Database, GitBranch, Bot, BarChart2, FileText,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import { fechaHoraVE, horaVE } from '../utils/fecha';
import { toast } from 'sonner';

interface RunRow {
    id:              string;
    workflow_id:     string;
    workflow_name?:  string;
    organization_id: string;
    triggered_by:    string;
    status:          'running' | 'success' | 'error' | 'cancelled';
    started_at:      string;
    finished_at:     string | null;
    duration_ms:     number | null;
    logs_count:      number;
    error_message:   string | null;
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
    return fechaHoraVE(iso, {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// ── Icono por tipo de nodo ────────────────────────────────────────────────────
const NODE_TYPE_ICON: Record<string, React.ReactNode> = {
    trigger:   <Play       className="w-3.5 h-3.5" />,
    email:     <Mail       className="w-3.5 h-3.5" />,
    agente:    <Bot        className="w-3.5 h-3.5" />,
    decision:  <GitBranch  className="w-3.5 h-3.5" />,
    datos:     <Database   className="w-3.5 h-3.5" />,
    reporte:   <FileText   className="w-3.5 h-3.5" />,
    bcv:       <BarChart2  className="w-3.5 h-3.5" />,
    eeff:      <BarChart2  className="w-3.5 h-3.5" />,
    default:   <Zap        className="w-3.5 h-3.5" />,
};

function nodeIcon(nodeId: string | null, message: string): React.ReactNode {
    const s = (nodeId ?? message ?? '').toLowerCase();
    for (const [k, icon] of Object.entries(NODE_TYPE_ICON)) {
        if (s.includes(k)) return icon;
    }
    return NODE_TYPE_ICON.default;
}

function parseDetails(raw: string | null): Record<string, unknown> | null {
    if (!raw) return null;
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    try { return JSON.parse(raw); } catch { return null; }
}

function fmtMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

// ── Paso del timeline ─────────────────────────────────────────────────────────
interface StepGroup {
    nodeId:    string | null;
    label:     string;
    status:    string;
    startedAt: string;
    endedAt:   string;
    durationMs: number | null;
    logs:      LogRow[];
}

// Extrae el nombre legible del nodo desde el texto del mensaje
// Ej: '✓ Nodo "Tasa BCV" completado (42ms)' → 'Tasa BCV'
// Ej: '▶ Flujo "Monitor" iniciado (4 nodos)'  → 'Monitor (inicio)'
function extractNodeName(message: string, nodeId: string | null): string {
    const quoted = message.match(/[""]([^""]+)[""]/);
    if (quoted) {
        if (/inici[ao]/i.test(message))   return `${quoted[1]} (inicio)`;
        if (/finaliz|complet|termin/i.test(message)) return `${quoted[1]} (fin)`;
        return quoted[1];
    }
    if (/inici[ao]/i.test(message))  return 'Inicio del flujo';
    if (/finaliz|complet/i.test(message)) return 'Fin del flujo';
    // Evitar mostrar UUIDs — usar fragmento descriptivo del mensaje
    if (nodeId && /^[0-9a-f-]{36}$/i.test(nodeId)) {
        return message.replace(/^[✓✗▶⚠\s]+/, '').split('(')[0].trim().slice(0, 40) || 'Paso';
    }
    return nodeId ?? 'Sistema';
}

function groupLogsIntoSteps(logs: LogRow[]): StepGroup[] {
    const byNode = new Map<string, LogRow[]>();
    const order: string[] = [];

    for (const log of logs) {
        const key = log.node_id ?? `__system_${log.id}`;
        if (!byNode.has(key)) { byNode.set(key, []); order.push(key); }
        byNode.get(key)!.push(log);
    }

    return order.map(key => {
        const group = byNode.get(key)!;
        const first = group[0];
        const last  = group[group.length - 1];
        const hasError   = group.some(l => l.status === 'error');
        const hasWaiting = group.some(l => l.status === 'esperando_aprobacion');
        const status = hasError ? 'error' : hasWaiting ? 'esperando_aprobacion' : last.status;
        const startMs = new Date(first.timestamp).getTime();
        const endMs   = new Date(last.timestamp).getTime();
        return {
            nodeId:     first.node_id,
            label:      extractNodeName(first.message, first.node_id),
            status,
            startedAt:  first.timestamp,
            endedAt:    last.timestamp,
            durationMs: endMs > startMs ? endMs - startMs : null,
            logs:       group,
        };
    });
}

// ── Componente de un paso del timeline ───────────────────────────────────────
function TimelineStep({ step, isLast }: { step: StepGroup; isLast: boolean }) {
    const [open, setOpen] = useState(step.status === 'error');

    const dotColor =
        step.status === 'success'              ? 'bg-emerald-500 ring-emerald-100' :
        step.status === 'error'                ? 'bg-red-500 ring-red-100' :
        step.status === 'running'              ? 'bg-blue-500 ring-blue-100' :
        step.status === 'esperando_aprobacion' ? 'bg-amber-400 ring-amber-100' :
        'bg-gray-300 ring-gray-100';

    const labelColor =
        step.status === 'error'                ? 'text-red-700' :
        step.status === 'esperando_aprobacion' ? 'text-amber-700' :
        'text-gray-800';

    const statusLabel: Record<string, string> = {
        success:              'Completado',
        error:                'Error',
        running:              'En curso',
        info:                 'Info',
        warning:              'Aviso',
        esperando_aprobacion: 'Esperando aprobación',
        rechazado:            'Rechazado',
    };

    const lastLog = step.logs[step.logs.length - 1];
    const errorMsg = step.logs.find(l => l.status === 'error')?.message;

    return (
        <div className="flex gap-3">
            {/* Línea y punto */}
            <div className="flex flex-col items-center flex-shrink-0">
                <div className={`w-7 h-7 rounded-full ring-4 flex items-center justify-center text-white flex-shrink-0 ${dotColor}`}>
                    {step.status === 'running'
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : nodeIcon(step.nodeId, step.label)}
                </div>
                {!isLast && <div className="w-0.5 flex-1 bg-gray-200 mt-1 mb-1 min-h-[16px]" />}
            </div>

            {/* Contenido del paso */}
            <div className={`flex-1 pb-4 ${isLast ? '' : ''}`}>
                <button
                    className="w-full text-left cursor-pointer"
                    onClick={() => setOpen(o => !o)}
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className={`font-semibold text-sm ${labelColor}`}>{step.label}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {step.durationMs && (
                                <span className="text-xs text-gray-400">{fmtMs(step.durationMs)}</span>
                            )}
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                step.status === 'success'              ? 'bg-emerald-100 text-emerald-700' :
                                step.status === 'error'                ? 'bg-red-100 text-red-700' :
                                step.status === 'running'              ? 'bg-blue-100 text-blue-700' :
                                step.status === 'esperando_aprobacion' ? 'bg-amber-100 text-amber-700' :
                                'bg-gray-100 text-gray-500'
                            }`}>
                                {statusLabel[step.status] ?? step.status}
                            </span>
                            {open
                                ? <ChevronDown  className="w-3.5 h-3.5 text-gray-400" />
                                : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                            }
                        </div>
                    </div>

                    {/* Mensaje principal (último log) */}
                    <p className={`text-xs mt-0.5 ${step.status === 'error' ? 'text-red-600' : 'text-gray-500'}`}>
                        {errorMsg ?? lastLog.message}
                    </p>

                    <p className="text-xs text-gray-400 mt-0.5">
                        {horaVE(step.startedAt)}
                    </p>
                </button>

                {/* Detalle expandible — siempre muestra todos los logs del paso */}
                {open && (
                    <div className="mt-2 space-y-1 pl-1">
                        {step.logs.map(log => {
                            const det = parseDetails(log.details);
                            const SKIP = ['skipped','triggered','branch','evaluated','indicadores','alertas_activas','siniestros'];
                            const entries = det
                                ? Object.entries(det).filter(([k]) => !SKIP.includes(k))
                                : [];
                            return (
                                <div key={log.id} className={`text-xs rounded-lg px-3 py-2 border ${
                                    log.status === 'error'   ? 'bg-red-50 border-red-100' :
                                    log.status === 'success' ? 'bg-emerald-50 border-emerald-100' :
                                    log.status === 'warning' ? 'bg-amber-50 border-amber-100' :
                                    'bg-gray-50 border-gray-100'
                                }`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-gray-400">{horaVE(log.timestamp)}</span>
                                        <span className="flex-1 text-gray-700">{log.message}</span>
                                    </div>
                                    {entries.length > 0 && (
                                        <table className="w-full mt-1">
                                            <tbody>
                                                {entries.map(([k, v]) => (
                                                    <tr key={k} className="border-t border-gray-100 first:border-0">
                                                        <td className="py-0.5 pr-3 text-gray-400 w-36 font-medium">
                                                            {k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                                        </td>
                                                        <td className="py-0.5 text-gray-700 font-semibold break-all">
                                                            {Array.isArray(v) ? `${(v as unknown[]).length} registros`
                                                             : typeof v === 'object' ? JSON.stringify(v)
                                                             : String(v ?? '—')}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Timeline completo ─────────────────────────────────────────────────────────
function ExecutionTimeline({ logs, loading }: { logs: LogRow[]; loading: boolean }) {
    if (loading) {
        return (
            <div className="p-4 space-y-4">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex gap-3">
                        <div className="skeleton w-7 h-7 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-2 pt-1">
                            <div className="skeleton h-4 w-1/3 rounded" />
                            <div className="skeleton h-3 w-2/3 rounded" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (logs.length === 0) {
        return <p className="text-gray-400 text-sm text-center py-12">Sin pasos registrados</p>;
    }

    const steps = groupLogsIntoSteps(logs);

    return (
        <div className="p-4">
            {steps.map((step, i) => (
                <TimelineStep key={`${step.nodeId}-${i}`} step={step} isLast={i === steps.length - 1} />
            ))}
        </div>
    );
}

export function Monitoring() {
    const [runs,          setRuns]          = useState<RunRow[]>([]);
    const [logs,          setLogs]          = useState<LogRow[]>([]);
    const [selectedRun,   setSelectedRun]   = useState<RunRow | null>(null);
    const [approverEmail, setApproverEmail] = useState<string | null>(null);
    const [filterStatus,  setFilterStatus]  = useState('all');
    const [loading,       setLoading]       = useState(true);
    const [logsLoading,   setLogsLoading]   = useState(false);
    const [retrying,      setRetrying]      = useState(false);

    const loadRuns = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('execution_runs')
                .select(`
                    id, workflow_id, organization_id, triggered_by, status,
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

    const handleRetry = useCallback(async (run: RunRow) => {
        setRetrying(true);
        try {
            const { error } = await supabase.functions.invoke('execute-workflow', {
                body: {
                    workflowId:     run.workflow_id,
                    organizationId: run.organization_id,
                    triggeredBy:    'retry',
                },
            });
            if (error) throw error;
            toast.success('Flujo reiniciado correctamente');
            setTimeout(() => loadRuns(), 1500);
        } catch (e: any) {
            toast.error(`Error al reintentar: ${e.message}`);
        } finally {
            setRetrying(false);
        }
    }, [loadRuns]);

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
        setApproverEmail(null);
        setLogsLoading(true);
        try {
            const [logsRes, tareaRes] = await Promise.all([
                supabase
                    .from('execution_logs')
                    .select('id, workflow_id, node_id, status, message, executed_at, details_json')
                    .eq('execution_run_id', run.id)
                    .order('executed_at', { ascending: true }),
                supabase
                    .from('tareas_aprobacion')
                    .select('aprobador_id, profiles:aprobador_id(email)')
                    .eq('execution_run_id', run.id)
                    .eq('estado', 'aprobado')
                    .limit(1)
                    .maybeSingle(),
            ]);

            const normalized = (logsRes.data ?? []).map((r: any) => ({
                ...r,
                timestamp: r.executed_at,
                details:   r.details_json,
            }));
            setLogs(normalized);

            const profile = (tareaRes.data as any)?.profiles;
            setApproverEmail(profile?.email ?? null);
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
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                        <span className="text-xs text-gray-500">
                                            {fmtDate(selectedRun.started_at)}
                                            {selectedRun.finished_at && ` → ${fmtDate(selectedRun.finished_at)}`}
                                            {' · '}{fmt(selectedRun.duration_ms)}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            👤 <span className="font-medium text-gray-700">{selectedRun.triggered_by}</span>
                                        </span>
                                        {approverEmail && (
                                            <span className="text-xs text-emerald-600">
                                                ✅ Aprobado por <span className="font-medium">{approverEmail}</span>
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedRun.status === 'error' && (
                                        <button
                                            onClick={() => handleRetry(selectedRun)}
                                            disabled={retrying}
                                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            {retrying
                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                : <RotateCcw className="w-3.5 h-3.5" />}
                                            Reintentar
                                        </button>
                                    )}
                                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${STATUS_BADGE[selectedRun.status]}`}>
                                        {selectedRun.status.toUpperCase()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Timeline visual de pasos */}
                        <div className="flex-1 overflow-y-auto">
                            <ExecutionTimeline logs={logs} loading={logsLoading} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
