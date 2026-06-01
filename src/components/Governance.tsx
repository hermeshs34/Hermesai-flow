import { useEffect, useState, useCallback } from 'react';
import {
    Users, ShieldCheck, ScrollText, Loader2, Search,
    CheckCircle, XCircle, Lock, AlertTriangle, UserPlus, X, Copy, ClipboardCheck,
} from 'lucide-react';
import { GovernanceService, type ManagedUser, type AuditEntry } from '../services/governance.service';
import { ROL_META, ROLES_ASIGNABLES, type Role, type User } from '../core/user.types';
import { authService } from '../core/auth.service';
import { supabase } from '../core/supabase';
import { toast } from 'sonner';

interface GovernanceProps {
    currentUser: User;
}

type Tab = 'usuarios' | 'auditoria' | 'matriz' | 'aprobaciones';

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
    workflows?: { name: string };
}

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ACCION_META: Record<string, { label: string; color: string }> = {
    crear:      { label: 'Creó',       color: 'text-emerald-600' },
    modificar:  { label: 'Modificó',   color: 'text-blue-600'    },
    eliminar:   { label: 'Eliminó',    color: 'text-red-600'     },
    ejecutar:   { label: 'Ejecutó',    color: 'text-indigo-600'  },
    aprobar:    { label: 'Aprobó',     color: 'text-emerald-600' },
    rechazar:   { label: 'Rechazó',    color: 'text-red-600'     },
    login:      { label: 'Ingresó',    color: 'text-gray-500'    },
    cambio_rol: { label: 'Cambió rol', color: 'text-amber-600'   },
};

export function Governance({ currentUser }: GovernanceProps) {
    const [tab,          setTab]         = useState<Tab>('usuarios');
    const [users,        setUsers]        = useState<ManagedUser[]>([]);
    const [audit,        setAudit]        = useState<AuditEntry[]>([]);
    const [matriz,       setMatriz]       = useState<Record<string, unknown>[]>([]);
    const [aprobaciones, setAprobaciones] = useState<TareaAprobacion[]>([]);
    const [loading,      setLoading]      = useState(true);
    const [search,       setSearch]       = useState('');
    const [resolvingId,  setResolvingId]  = useState<string | null>(null);
    const [comentario,   setComentario]   = useState<Record<string, string>>({});
    const [savingId, setSavingId] = useState<string | null>(null);

    // Crear usuario
    const [showCreate, setShowCreate] = useState(false);
    const [creating,   setCreating]   = useState(false);
    const [form, setForm] = useState<{ name: string; email: string; role: Role }>({ name: '', email: '', role: 'operador' });
    const [tempPass, setTempPass] = useState<string | null>(null);

    const isAdmin = authService.hasPermission(currentUser, 'manage_users');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [u, a, m] = await Promise.all([
                GovernanceService.getUsers(currentUser.organizationId),
                GovernanceService.getAuditTrail(currentUser.organizationId, 150),
                GovernanceService.getMatriz(currentUser.organizationId),
            ]);
            setUsers(u); setAudit(a); setMatriz(m as Record<string, unknown>[]);

            const { data: tareas } = await supabase
                .from('tareas_aprobacion')
                .select('*, workflows(name)')
                .eq('organization_id', currentUser.organizationId)
                .eq('estado', 'pendiente')
                .order('created_at', { ascending: false });
            setAprobaciones((tareas ?? []) as TareaAprobacion[]);
        } catch {
            toast.error('Error cargando datos de gobierno');
        } finally {
            setLoading(false);
        }
    }, [currentUser.organizationId]);

    const resolveApproval = async (tarea: TareaAprobacion, decision: 'aprobado' | 'rechazado') => {
        setResolvingId(tarea.id);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const approverId = session?.user?.id;
            if (!approverId) throw new Error('Sin sesión activa');

            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-approval`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                },
                body: JSON.stringify({
                    tareaId:    tarea.id,
                    decision,
                    comentario: comentario[tarea.id] ?? '',
                    approverId,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error ?? 'Error al resolver');

            if (decision === 'rechazado') {
                toast.success('❌ Flujo rechazado');
            } else {
                // Aprobado: reanudar el flujo directamente desde el frontend
                toast.info('✅ Aprobado — reanudando flujo...');
                const resumeRes = await fetch(
                    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/execute-workflow`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                        },
                        body: JSON.stringify({
                            workflowId:     result.workflowId,
                            organizationId: result.organizationId,
                            triggeredBy:    'approval',
                            action:         'resume',
                            runId:          result.runId,
                            approverId,
                        }),
                    }
                );
                const resumeData = await resumeRes.json();
                if (!resumeRes.ok || resumeData?.error) {
                    toast.warning(`⚠ Aprobado pero error al reanudar: ${resumeData?.error ?? 'error desconocido'}`);
                } else {
                    toast.success('✅ Flujo aprobado y reanudado correctamente');
                }
            }
            setAprobaciones(prev => prev.filter(t => t.id !== tarea.id));
            setComentario(prev => { const n = { ...prev }; delete n[tarea.id]; return n; });
        } catch (e) {
            toast.error((e as Error).message ?? 'Error al resolver aprobación');
        } finally {
            setResolvingId(null);
        }
    };

    useEffect(() => { load(); }, [load]);

    const changeRole = async (u: ManagedUser, newRole: Role) => {
        if (newRole === u.role) return;
        // Salvaguarda último admin: no permitir dejar la org sin administrador
        if (u.role === 'admin' && newRole !== 'admin') {
            const admins = await GovernanceService.countActiveAdmins(currentUser.organizationId);
            if (admins <= 1) {
                toast.error('No puedes quitar el último administrador activo. Asigna otro admin primero.');
                return;
            }
        }
        setSavingId(u.id);
        try {
            await GovernanceService.updateUserRole(currentUser, u.id, newRole, u.role);
            setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x));
            toast.success(`${u.name}: rol → ${ROL_META[newRole].label}`);
        } catch {
            toast.error('No se pudo cambiar el rol');
        } finally { setSavingId(null); }
    };

    const handleCreate = async () => {
        const name = form.name.trim(), email = form.email.trim();
        if (!name || !email) { toast.error('Nombre y email son obligatorios'); return; }
        setCreating(true);
        try {
            const { tempPassword } = await GovernanceService.createUser({ name, email, role: form.role });
            toast.success(`Usuario "${name}" creado`);
            setTempPass(tempPassword ?? null);
            setForm({ name: '', email: '', role: 'operador' });
            if (!tempPassword) setShowCreate(false);
            load();
        } catch (e) {
            toast.error((e as Error)?.message ?? 'No se pudo crear el usuario');
        } finally { setCreating(false); }
    };

    const toggleActive = async (u: ManagedUser) => {
        if (u.id === currentUser.id) { toast.error('No puedes desactivarte a ti mismo'); return; }
        setSavingId(u.id);
        try {
            await GovernanceService.setUserActive(currentUser, u.id, !u.isActive);
            setUsers(prev => prev.map(x => x.id === u.id ? { ...x, isActive: !x.isActive } : x));
            toast.success(u.isActive ? `${u.name} desactivado` : `${u.name} activado`);
        } catch {
            toast.error('No se pudo actualizar');
        } finally { setSavingId(null); }
    };

    // Acceso denegado para no-admin
    if (!isAdmin) {
        return (
            <div className="h-full flex items-center justify-center bg-gray-50">
                <div className="text-center max-w-sm">
                    <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Lock className="w-6 h-6 text-red-400" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-800">Acceso restringido</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        El módulo de Gobierno solo está disponible para el rol <strong>Administrador</strong>.
                        Tu rol actual es <strong>{ROL_META[currentUser.role]?.label ?? currentUser.role}</strong>.
                    </p>
                </div>
            </div>
        );
    }

    const filteredUsers = users.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
    );

    const TABS: { id: Tab; label: string; icon: typeof Users; badge?: number }[] = [
        { id: 'usuarios',      label: 'Usuarios y Roles',      icon: Users },
        { id: 'aprobaciones',  label: 'Bandeja de Aprobación', icon: ClipboardCheck, badge: aprobaciones.length },
        { id: 'matriz',        label: 'Matriz de Aprobación',  icon: ShieldCheck },
        { id: 'auditoria',     label: 'Auditoría',             icon: ScrollText },
    ];

    return (
        <div className="h-full overflow-y-auto bg-[#f0f2f5]">
            <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-5">

                {/* Header */}
                <div>
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-indigo-600" />
                        <h1 className="text-xl font-bold text-gray-900">Gobierno y Control</h1>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Administración de usuarios, autorizaciones y trazabilidad — F1</p>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm w-fit">
                    {TABS.map(({ id, label, icon: Icon, badge }) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                                tab === id ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            <Icon className="w-4 h-4" /> {label}
                            {badge != null && badge > 0 && (
                                <span className="ml-1 bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 leading-none">
                                    {badge}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
                ) : (
                    <>
                        {/* ── USUARIOS ──────────────────────────────────── */}
                        {tab === 'usuarios' && (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                                    <h2 className="font-semibold text-gray-800 text-sm">{users.length} usuarios</h2>
                                    <div className="flex items-center gap-2">
                                        <div className="relative">
                                            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                            <input
                                                value={search} onChange={e => setSearch(e.target.value)}
                                                placeholder="Buscar usuario..."
                                                className="text-xs pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 w-52"
                                            />
                                        </div>
                                        <button
                                            onClick={() => { setShowCreate(true); setTempPass(null); }}
                                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                                        >
                                            <UserPlus className="w-3.5 h-3.5" /> Nuevo usuario
                                        </button>
                                    </div>
                                </div>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                            <th className="text-left px-5 py-2 font-bold">Usuario</th>
                                            <th className="text-left px-3 py-2 font-bold">Rol</th>
                                            <th className="text-center px-3 py-2 font-bold">Estado</th>
                                            <th className="text-right px-5 py-2 font-bold">Creado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredUsers.map(u => (
                                            <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                                                <td className="px-5 py-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                                                            style={{ backgroundColor: ROL_META[u.role]?.color ?? '#94a3b8' }}>
                                                            {u.name.split(' ').slice(0,2).map(n => n[0]).join('').toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="font-semibold text-gray-800 truncate">{u.name}{u.id === currentUser.id && <span className="text-[10px] text-indigo-500 ml-1">(tú)</span>}</p>
                                                            <p className="text-[11px] text-gray-400 truncate">{u.email}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <select
                                                        value={u.role}
                                                        disabled={savingId === u.id || u.id === currentUser.id}
                                                        onChange={e => changeRole(u, e.target.value as Role)}
                                                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                                        title={ROL_META[u.role]?.descripcion}
                                                    >
                                                        {ROLES_ASIGNABLES.map(r => (
                                                            <option key={r} value={r}>{ROL_META[r].label}</option>
                                                        ))}
                                                        {!ROLES_ASIGNABLES.includes(u.role) && (
                                                            <option value={u.role}>{ROL_META[u.role]?.label ?? u.role} (heredado)</option>
                                                        )}
                                                    </select>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <button
                                                        onClick={() => toggleActive(u)}
                                                        disabled={savingId === u.id || u.id === currentUser.id}
                                                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full disabled:opacity-50 ${
                                                            u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                                        }`}
                                                    >
                                                        {u.isActive ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                                        {u.isActive ? 'Activo' : 'Inactivo'}
                                                    </button>
                                                </td>
                                                <td className="px-5 py-3 text-right text-[11px] text-gray-400">{fmtDate(u.createdAt)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* ── BANDEJA DE APROBACIONES ───────────────────── */}
                        {tab === 'aprobaciones' && (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                                    <div>
                                        <h2 className="font-semibold text-gray-800 text-sm">Bandeja de Aprobaciones</h2>
                                        <p className="text-xs text-gray-400 mt-0.5">Flujos pausados esperando tu autorización</p>
                                    </div>
                                    <span className="text-xs text-gray-500">{aprobaciones.length} pendiente{aprobaciones.length !== 1 ? 's' : ''}</span>
                                </div>

                                {aprobaciones.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                                        <CheckCircle className="w-10 h-10 mb-3 text-emerald-300" />
                                        <p className="text-sm font-medium">Sin aprobaciones pendientes</p>
                                        <p className="text-xs mt-1">Los flujos que requieran tu autorización aparecerán aquí</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-gray-100">
                                        {aprobaciones.map(tarea => (
                                            <div key={tarea.id} className="px-5 py-4 hover:bg-gray-50/50 transition-colors">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="font-semibold text-gray-800 text-sm truncate">
                                                                {tarea.workflows?.name ?? tarea.workflow_id}
                                                            </span>
                                                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                                                                {tarea.node_title ?? 'Aprobación'}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-600 mb-1">{tarea.descripcion}</p>
                                                        <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                                                            {tarea.monto != null && (
                                                                <span>Monto: <strong className="text-gray-600">{tarea.monto.toLocaleString('es-VE')}</strong></span>
                                                            )}
                                                            {tarea.categoria && (
                                                                <span>Categoría: <strong className="text-gray-600">{tarea.categoria}</strong></span>
                                                            )}
                                                            <span>Rol requerido: <strong className="text-indigo-600">{tarea.rol_aprobador}</strong></span>
                                                            <span>Vence: <strong className={new Date(tarea.vence_at) < new Date() ? 'text-red-500' : 'text-gray-600'}>{fmtDate(tarea.vence_at)}</strong></span>
                                                        </div>
                                                        <input
                                                            type="text"
                                                            placeholder="Comentario (opcional)..."
                                                            value={comentario[tarea.id] ?? ''}
                                                            onChange={e => setComentario(prev => ({ ...prev, [tarea.id]: e.target.value }))}
                                                            className="mt-2 w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-2 shrink-0">
                                                        <button
                                                            onClick={() => resolveApproval(tarea, 'aprobado')}
                                                            disabled={resolvingId === tarea.id}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                                                        >
                                                            {resolvingId === tarea.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                                            Aprobar
                                                        </button>
                                                        <button
                                                            onClick={() => resolveApproval(tarea, 'rechazado')}
                                                            disabled={resolvingId === tarea.id}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 border border-red-200"
                                                        >
                                                            <XCircle className="w-3 h-3" />
                                                            Rechazar
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── MATRIZ ────────────────────────────────────── */}
                        {tab === 'matriz' && (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60">
                                    <h2 className="font-semibold text-gray-800 text-sm">Reglas de autorización por monto y criticidad</h2>
                                </div>
                                {matriz.length === 0 ? (
                                    <div className="py-12 text-center">
                                        <ShieldCheck className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                        <p className="text-sm text-gray-400">Sin reglas de aprobación configuradas</p>
                                        <p className="text-[11px] text-gray-300 mt-1">Define umbrales de monto y el rol que debe aprobar cada nivel</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                                <th className="text-left px-5 py-2 font-bold">Regla</th>
                                                <th className="text-left px-3 py-2 font-bold">Umbral</th>
                                                <th className="text-left px-3 py-2 font-bold">Aprobador</th>
                                                <th className="text-center px-3 py-2 font-bold">Nivel</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {matriz.map((m) => (
                                                <tr key={m.id as string} className="border-b border-gray-50">
                                                    <td className="px-5 py-3 font-medium text-gray-800">{m.nombre as string}</td>
                                                    <td className="px-3 py-3 text-gray-600">{m.moneda as string} {Number(m.umbral_monto).toLocaleString()}</td>
                                                    <td className="px-3 py-3">
                                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${ROL_META[m.rol_aprobador as Role]?.color ?? '#94a3b8'}18`, color: ROL_META[m.rol_aprobador as Role]?.color ?? '#64748b' }}>
                                                            {ROL_META[m.rol_aprobador as Role]?.label ?? m.rol_aprobador as string}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 text-center text-gray-500">{m.nivel as number}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                                <div className="px-5 py-3 bg-amber-50/50 border-t border-amber-100 flex items-start gap-2">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-amber-700">
                                        <strong>Segregación de funciones activa:</strong> el creador de un flujo no puede aprobarlo. La edición de reglas se habilitará en la siguiente iteración.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* ── AUDITORÍA ─────────────────────────────────── */}
                        {tab === 'auditoria' && (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                                    <h2 className="font-semibold text-gray-800 text-sm">Registro de auditoría — inmutable</h2>
                                    <span className="text-[10px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full font-semibold">{audit.length} eventos</span>
                                </div>
                                {audit.length === 0 ? (
                                    <div className="py-12 text-center">
                                        <ScrollText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                        <p className="text-sm text-gray-400">Sin eventos registrados aún</p>
                                        <p className="text-[11px] text-gray-300 mt-1">Las acciones sensibles (crear, aprobar, cambiar rol) quedarán registradas aquí</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
                                        {audit.map(a => {
                                            const meta = ACCION_META[a.accion] ?? { label: a.accion, color: 'text-gray-500' };
                                            return (
                                                <div key={a.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50/60">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs text-gray-700">
                                                            <span className="font-semibold">{a.usuario_email ?? 'Sistema'}</span>{' '}
                                                            <span className={`font-semibold ${meta.color}`}>{meta.label.toLowerCase()}</span>{' '}
                                                            <span className="text-gray-500">{a.entidad}</span>
                                                            {a.descripcion && <span className="text-gray-400"> — {a.descripcion}</span>}
                                                        </p>
                                                    </div>
                                                    <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtDate(a.created_at)}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── Modal Nuevo Usuario ──────────────────────────────────── */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !creating && setShowCreate(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                            <div className="flex items-center gap-2">
                                <UserPlus className="w-4 h-4 text-indigo-600" />
                                <h3 className="font-semibold text-gray-800 text-sm">Nuevo Usuario</h3>
                            </div>
                            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                        </div>

                        {tempPass ? (
                            <div className="p-6 text-center space-y-3">
                                <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto">
                                    <CheckCircle className="w-6 h-6 text-emerald-500" />
                                </div>
                                <p className="text-sm font-semibold text-gray-800">Usuario creado correctamente</p>
                                <p className="text-xs text-gray-500">Comparte esta clave temporal con el usuario. Debe cambiarla en su primer ingreso.</p>
                                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                    <code className="flex-1 text-sm font-mono text-gray-800 text-left">{tempPass}</code>
                                    <button
                                        onClick={() => { navigator.clipboard.writeText(tempPass); toast.success('Clave copiada'); }}
                                        className="text-gray-400 hover:text-indigo-600"><Copy className="w-4 h-4" /></button>
                                </div>
                                <button onClick={() => { setShowCreate(false); setTempPass(null); }}
                                    className="w-full mt-2 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                                    Entendido
                                </button>
                            </div>
                        ) : (
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre completo</label>
                                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder="Ej: María González"
                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                                    <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                        type="email" placeholder="usuario@empresa.com"
                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">Rol</label>
                                    <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}
                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200">
                                        {ROLES_ASIGNABLES.map(r => <option key={r} value={r}>{ROL_META[r].label}</option>)}
                                    </select>
                                    <p className="text-[11px] text-gray-400 mt-1">{ROL_META[form.role].descripcion}</p>
                                </div>
                                <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                                    <p className="text-[11px] text-indigo-700">Se generará una clave temporal automática que podrás compartir con el usuario.</p>
                                </div>
                                <div className="flex gap-2 pt-1">
                                    <button onClick={() => setShowCreate(false)} disabled={creating}
                                        className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                                        Cancelar
                                    </button>
                                    <button onClick={handleCreate} disabled={creating}
                                        className="flex-1 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                                        {creating ? 'Creando...' : 'Crear usuario'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
