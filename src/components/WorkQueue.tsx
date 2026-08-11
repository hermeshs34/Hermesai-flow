import { useState, useEffect, useCallback } from 'react';
import {
    AlertTriangle, RefreshCw, CheckCircle, XCircle,
    Loader2, Clock, Play, RotateCcw, Inbox,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import { authService } from '../core/auth.service';
import { toast } from 'sonner';
import type { User } from '../core/user.types';

// Roles regulatorios (AML/CFT): sus tareas las resuelve SOLO ese rol, ni el admin.
// ⚠️ Copiada en `Governance.tsx`, `Sidebar.tsx` y en la Edge Function
// `resolve-approval` (que es quien manda de verdad — el navegador solo pinta
// botones). Si cambias una, cambia las cuatro.
const ROLES_REGULATORIOS = ['cumplimiento'];

interface WorkQueueProps { currentUser: User; }

interface TareaAprobacion {
    id: string;
    workflow_id: string;
    execution_run_id: string;
    node_id: string;
    node_title: string;
    rol_aprobador: string;
    descripcion: string;
    monto: number | null;
    categoria: string | null;
    estado: string;
    vence_at: string;
    created_at: string;
    solicitante_id: string | null;
    nivel_escalamiento?: number;
    rol_aprobador_original?: string | null;
    workflows?: { name: string };
}

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
    error_message:   string | null;
    workflows?:      { name: string };
}

function timeAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60)   return `hace ${diff}s`;
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    return `hace ${Math.floor(diff / 86400)}d`;
}

function timeLeft(iso: string): { label: string; urgent: boolean } {
    const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
    if (diff <= 0)        return { label: 'Vencida', urgent: true };
    if (diff < 3600)      return { label: `Vence en ${Math.floor(diff / 60)}m`, urgent: true };
    if (diff < 86400)     return { label: `Vence en ${Math.floor(diff / 3600)}h`, urgent: false };
    return { label: `Vence en ${Math.floor(diff / 86400)}d`, urgent: false };
}

function fmtDuration(ms: number | null): string {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

// ── Sección colapsable ────────────────────────────────────────────────────────
function Section({ color, icon, title, count, children }: {
    color: 'red' | 'yellow' | 'green';
    icon: React.ReactNode;
    title: string;
    count: number;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(true);

    const header: Record<string, string> = {
        red:    'bg-red-50 border-red-200 text-red-800',
        yellow: 'bg-amber-50 border-amber-200 text-amber-800',
        green:  'bg-emerald-50 border-emerald-200 text-emerald-800',
    };
    const badge: Record<string, string> = {
        red:    'bg-red-500 text-white',
        yellow: 'bg-amber-400 text-amber-900',
        green:  'bg-emerald-500 text-white',
    };

    if (count === 0) return null;

    return (
        <div className="rounded-lg border overflow-hidden mb-4">
            <button
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b font-semibold text-sm ${header[color]}`}
            >
                {icon}
                <span className="flex-1 text-left">{title}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badge[color]}`}>{count}</span>
                <RefreshCw className={`w-3.5 h-3.5 ml-1 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <div className="divide-y divide-gray-100 bg-white">{children}</div>}
        </div>
    );
}

export function WorkQueue({ currentUser }: WorkQueueProps) {
    const [pendientes,  setPendientes]  = useState<TareaAprobacion[]>([]);
    const [errores,     setErrores]     = useState<RunRow[]>([]);
    const [enCurso,     setEnCurso]     = useState<RunRow[]>([]);
    const [loading,     setLoading]     = useState(true);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const [retryingId,  setRetryingId]  = useState<string | null>(null);
    const [comentario,  setComentario]  = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [tareasRes, runsRes] = await Promise.all([
                supabase.from('tareas_aprobacion')
                    .select('*, solicitante_id, workflows(name)')
                    .eq('organization_id', currentUser.organizationId)
                    .eq('estado', 'pendiente')
                    .order('vence_at', { ascending: true }),
                supabase.from('execution_runs')
                    .select('id, workflow_id, organization_id, triggered_by, status, started_at, finished_at, duration_ms, error_message, workflows(name)')
                    .in('status', ['error', 'running'])
                    .order('started_at', { ascending: false })
                    .limit(50),
            ]);

            setPendientes((tareasRes.data ?? []) as TareaAprobacion[]);
            const runs = (runsRes.data ?? []).map((r: any) => ({
                ...r,
                workflow_name: r.workflows?.name ?? r.workflow_id,
            })) as RunRow[];
            setErrores(runs.filter(r => r.status === 'error'));
            setEnCurso(runs.filter(r => r.status === 'running'));
        } finally {
            setLoading(false);
        }
    }, [currentUser.organizationId]);

    useEffect(() => { load(); }, [load]);

    // Realtime
    useEffect(() => {
        const ch = supabase.channel('workqueue-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_aprobacion' }, load)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'execution_runs' }, load)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [load]);

    const resolveApproval = async (tarea: TareaAprobacion, decision: 'aprobado' | 'rechazado') => {
        setResolvingId(tarea.id);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const approverId  = session?.user?.id;
            const accessToken = session?.access_token;
            if (!approverId || !accessToken) throw new Error('Sin sesión activa');

            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-approval`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    tareaId: tarea.id,
                    decision,
                    comentario: comentario[tarea.id] ?? '',
                    approverId,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error ?? 'Error al resolver');

            if (decision === 'rechazado') {
                toast.success('Flujo rechazado');
            } else if (result.reanudado) {
                toast.success('Flujo reanudado');
            } else {
                // Reanudar ya NO lo hace el frontend: lo hace resolve-approval por
                // la vía interna. Desde el navegador se llamaba a execute-workflow
                // con el JWT del aprobador, y esa función exige ROLES_QUE_EJECUTAN
                // —un `cumplimiento` aprobaba y se comía un 403 al reanudar.
                toast.warning(`Aprobado pero error al reanudar: ${result.errorResume ?? 'error desconocido'}`);
            }
            await load();
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setResolvingId(null);
        }
    };

    const handleRetry = async (run: RunRow) => {
        setRetryingId(run.id);
        try {
            const { error } = await supabase.functions.invoke('execute-workflow', {
                body: {
                    workflowId:     run.workflow_id,
                    organizationId: run.organization_id,
                    triggeredBy:    'retry',
                },
            });
            if (error) throw error;
            toast.success('Flujo reiniciado');
            setTimeout(load, 1500);
        } catch (e: any) {
            toast.error(`Error al reintentar: ${e.message}`);
        } finally {
            setRetryingId(null);
        }
    };

    const isAdmin = authService.hasPermission(currentUser, 'manage_users');
    const canResolve = (tarea: TareaAprobacion): boolean => {
        // SoD: quien disparó el flujo no puede aprobarlo (misma regla que en resolve-approval Edge Fn)
        if (tarea.solicitante_id && tarea.solicitante_id === currentUser.id) return false;
        if (ROLES_REGULATORIOS.includes(tarea.rol_aprobador)) {
            return currentUser.role === tarea.rol_aprobador;
        }
        return isAdmin || currentUser.role === tarea.rol_aprobador;
    };

    // Mostrar todas las aprobaciones pendientes de la org; canResolve controla los botones de acci�n
    const pendientesVisibles = pendientes;
    const totalItems = pendientesVisibles.length + errores.length + enCurso.length;

    return (
        <div className="flex flex-col h-full bg-[#f0f2f8]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Cola de Trabajo</h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        {loading ? 'Cargando...' : totalItems === 0
                            ? 'Sin elementos pendientes — todo en orden'
                            : `${totalItems} elemento${totalItems !== 1 ? 's' : ''} requieren atención`}
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Actualizar
                </button>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
                {loading ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="skeleton h-20 rounded-lg" />
                        ))}
                    </div>
                ) : totalItems === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                        <Inbox className="w-12 h-12 mb-3 opacity-40" />
                        <p className="text-lg font-medium text-gray-500">Todo en orden</p>
                        <p className="text-sm mt-1">No hay aprobaciones pendientes ni errores activos</p>
                    </div>
                ) : (
                    <>
                        {/* SECCIÓN 1 — Aprobaciones pendientes (solo las que puede resolver este usuario) */}
                        <Section
                            color="red"
                            icon={<AlertTriangle className="w-4 h-4" />}
                            title="Requieren aprobación"
                            count={pendientesVisibles.length}
                        >
                            {pendientesVisibles.map(t => {
                                const vence = timeLeft(t.vence_at);
                                const resolving = resolvingId === t.id;
                                return (
                                    <div key={t.id} className="px-4 py-4">
                                        <div className="flex items-start justify-between gap-4 mb-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-gray-900 text-sm truncate">
                                                    {t.workflows?.name ?? t.workflow_id}
                                                </p>
                                                <p className="text-sm text-gray-600 mt-0.5">{t.node_title}</p>
                                                {(t.nivel_escalamiento ?? 0) > 0 && (
                                                    <span
                                                        className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 mt-1"
                                                        title={t.rol_aprobador_original ? `Escalada desde ${t.rol_aprobador_original} por falta de respuesta` : 'Escalada por falta de respuesta'}
                                                    >
                                                        ⬆ Escalada{t.rol_aprobador_original ? ` desde ${t.rol_aprobador_original}` : ''}
                                                    </span>
                                                )}
                                                {t.descripcion && (
                                                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.descripcion}</p>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                                    vence.urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                    <Clock className="w-3 h-3 inline mr-1" />
                                                    {vence.label}
                                                </span>
                                                <span className="text-xs text-gray-400">{timeAgo(t.created_at)}</span>
                                            </div>
                                        </div>

                                        {t.monto && (
                                            <p className="text-sm font-bold text-gray-800 mb-2">
                                                Monto: {t.monto.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                                {t.categoria && <span className="ml-2 text-xs font-normal text-gray-500">({t.categoria})</span>}
                                            </p>
                                        )}

                                        {canResolve(t) ? (
                                        <div className="flex items-center gap-2 mt-3">
                                            <input
                                                type="text"
                                                placeholder="Comentario opcional..."
                                                value={comentario[t.id] ?? ''}
                                                onChange={e => setComentario(c => ({ ...c, [t.id]: e.target.value }))}
                                                className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                            />
                                            <button
                                                onClick={() => resolveApproval(t, 'aprobado')}
                                                disabled={resolving}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                                            >
                                                {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                                Aprobar
                                            </button>
                                            <button
                                                onClick={() => resolveApproval(t, 'rechazado')}
                                                disabled={resolving}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                                            >
                                                {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                                                Rechazar
                                            </button>
                                        </div>
                                        ) : (
                                        <p className="text-xs text-amber-600 mt-2 italic bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                                            {t.solicitante_id === currentUser.id
                                                ? '⚠️ Segregación de funciones: quien ejecutó el flujo no puede aprobarlo'
                                                : <>Solo el rol <span className="font-semibold">{t.rol_aprobador}</span> puede resolver esta tarea</>
                                            }
                                        </p>
                                        )}
                                    </div>
                                );
                            })}
                        </Section>

                        {/* SECCIÓN 2 — Errores a re-ejecutar */}
                        <Section
                            color="yellow"
                            icon={<AlertTriangle className="w-4 h-4" />}
                            title="Errores a re-ejecutar"
                            count={errores.length}
                        >
                            {errores.map(r => {
                                const retrying = retryingId === r.id;
                                return (
                                    <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-gray-900 text-sm truncate">
                                                {r.workflow_name}
                                            </p>
                                            {r.error_message && (
                                                <p className="text-xs text-red-600 mt-0.5 line-clamp-2">{r.error_message}</p>
                                            )}
                                            <p className="text-xs text-gray-400 mt-1">
                                                {timeAgo(r.started_at)} · duración {fmtDuration(r.duration_ms)}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleRetry(r)}
                                            disabled={retrying}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                                        >
                                            {retrying
                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                : <RotateCcw className="w-3.5 h-3.5" />}
                                            Re-ejecutar
                                        </button>
                                    </div>
                                );
                            })}
                        </Section>

                        {/* SECCIÓN 3 — En ejecución */}
                        <Section
                            color="green"
                            icon={<Play className="w-4 h-4" />}
                            title="En ejecución ahora"
                            count={enCurso.length}
                        >
                            {enCurso.map(r => (
                                <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                                    <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-gray-900 text-sm truncate">{r.workflow_name}</p>
                                        <p className="text-xs text-gray-400">Iniciado {timeAgo(r.started_at)}</p>
                                    </div>
                                    <span className="text-xs bg-emerald-100 text-emerald-700 font-medium px-2 py-0.5 rounded-full">
                                        En curso
                                    </span>
                                </div>
                            ))}
                        </Section>
                    </>
                )}
            </div>
        </div>
    );
}
