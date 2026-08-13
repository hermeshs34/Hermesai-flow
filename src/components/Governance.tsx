import { useEffect, useState, useCallback } from 'react';
import {
    Users, ShieldCheck, ScrollText, Loader2, Search,
    CheckCircle, XCircle, Lock, AlertTriangle, UserPlus, X, Copy, ClipboardCheck,
    Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Sparkles, FlaskConical,
    TrendingUp, Clock, ChevronDown, ChevronUp, BookOpen, KeyRound,
} from 'lucide-react';
import { GovernanceService, type ManagedUser, type AuditEntry } from '../services/governance.service';
import { ROL_META, ROLES_ASIGNABLES, type Role, type User } from '../core/user.types';
import { authService } from '../core/auth.service';
import { supabase } from '../core/supabase';
import { fechaHoraVE } from '../utils/fecha';
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
    return fechaHoraVE(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    const [auditSearch,  setAuditSearch]  = useState('');
    const [auditDateFilter, setAuditDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
    const [matriz,       setMatriz]       = useState<Record<string, unknown>[]>([]);
    const [aprobaciones, setAprobaciones] = useState<TareaAprobacion[]>([]);
    const [loading,      setLoading]      = useState(true);
    const [search,       setSearch]       = useState('');
    const [resolvingId,  setResolvingId]  = useState<string | null>(null);
    const [comentario,   setComentario]   = useState<Record<string, string>>({});
    const [savingId,     setSavingId]     = useState<string | null>(null);

    // Matriz CRUD — F3.3
    type MatrizRegla = {
        id: string; nombre: string; categoria: string;
        operador: string; umbral_monto: number; umbral_max: number | null; moneda: string;
        rol_aprobador: string; nivel: number; activa: boolean;
        condicion_extra: string; aprobadores_multiples: number;
        escalamiento_horas: number; aplica_automatico: boolean;
        descripcion_regulatoria: string;
        veces_activada: number; aprobaciones_count: number;
        rechazos_count: number; tiempo_promedio_hs: number | null;
    };
    const REGLA_VACIA: Omit<MatrizRegla, 'id'> = {
        nombre: '', categoria: '', operador: '>=', umbral_monto: 0, umbral_max: null,
        moneda: 'USD', rol_aprobador: 'autorizador', nivel: 1, activa: true,
        condicion_extra: '', aprobadores_multiples: 1, escalamiento_horas: 48,
        aplica_automatico: false, descripcion_regulatoria: '',
        veces_activada: 0, aprobaciones_count: 0, rechazos_count: 0, tiempo_promedio_hs: null,
    };
    const [showMatrizForm,  setShowMatrizForm]  = useState(false);
    const [editingRegla,    setEditingRegla]    = useState<MatrizRegla | null>(null);
    const [reglaForm,       setReglaForm]       = useState<Omit<MatrizRegla, 'id'>>(REGLA_VACIA);
    const [savingRegla,     setSavingRegla]     = useState(false);
    const [expandedRegla,   setExpandedRegla]   = useState<string | null>(null);
    const [simuladorVal,    setSimuladorVal]    = useState('');
    const [simuladorCat,    setSimuladorCat]    = useState('');
    const [simuladorResult, setSimuladorResult] = useState<MatrizRegla[] | null>(null);
    const [iaLoading,       setIaLoading]       = useState(false);
    const [iaSugerencia,    setIaSugerencia]    = useState<string | null>(null);

    // Crear usuario
    const [showCreate, setShowCreate] = useState(false);
    const [creating,   setCreating]   = useState(false);
    const [form, setForm] = useState<{ name: string; email: string; role: Role }>({ name: '', email: '', role: 'operador' });
    const [tempPass, setTempPass] = useState<string | null>(null);

    // Restablecer la clave de otro (olvido)
    const [resetUser,  setResetUser]  = useState<ManagedUser | null>(null);
    const [resetting,  setResetting]  = useState(false);
    const [resetPass,  setResetPass]  = useState<string | null>(null);

    const isAdmin      = authService.hasPermission(currentUser, 'manage_users');
    const canApprove   = authService.hasPermission(currentUser, 'approve_tasks');
    // El permiso 'view_audit' existía desde F1 y esta vista no lo usaba: la
    // pestaña de Auditoría era adminOnly, así que el propio 'auditor' —cuyo
    // único cometido es leer la traza— no podía entrar. Ahora manda el permiso,
    // y la política audit_read_org de la base usa esta misma lista de roles
    // (20260803_audit_read_por_rol.sql). Una sola fuente de verdad.
    const canViewAudit = authService.hasPermission(currentUser, 'view_audit');

    // Roles regulatorios (AML/CFT) — el admin NO puede aprobar sus tareas (segregación de funciones)
    // ⚠️ Copiada en `WorkQueue.tsx`, `Sidebar.tsx` y en la Edge Function
    // `resolve-approval`, que es quien manda de verdad. Si cambias una, las cuatro.
    const ROLES_REGULATORIOS = ['cumplimiento'];
    const canResolve = (tarea: TareaAprobacion) => {
        if (ROLES_REGULATORIOS.includes(tarea.rol_aprobador)) {
            return currentUser.role === tarea.rol_aprobador;
        }
        return isAdmin || currentUser.role === tarea.rol_aprobador;
    };

    // ── Handlers Matriz ──────────────────────────────────────────────────────
    const openNuevaRegla = () => {
        setEditingRegla(null);
        setReglaForm(REGLA_VACIA);
        setShowMatrizForm(true);
        setIaSugerencia(null);
    };

    const openEditarRegla = (r: MatrizRegla) => {
        setEditingRegla(r);
        setReglaForm({
            nombre: r.nombre, categoria: r.categoria ?? '',
            operador: r.operador ?? '>=', umbral_monto: r.umbral_monto, umbral_max: r.umbral_max,
            moneda: r.moneda, rol_aprobador: r.rol_aprobador, nivel: r.nivel, activa: r.activa,
            condicion_extra: r.condicion_extra ?? '', aprobadores_multiples: r.aprobadores_multiples ?? 1,
            escalamiento_horas: r.escalamiento_horas ?? 48, aplica_automatico: r.aplica_automatico ?? false,
            descripcion_regulatoria: r.descripcion_regulatoria ?? '',
            veces_activada: 0, aprobaciones_count: 0, rechazos_count: 0, tiempo_promedio_hs: null,
        });
        setShowMatrizForm(true);
        setIaSugerencia(null);
    };

    const cancelarReglaForm = () => { setShowMatrizForm(false); setEditingRegla(null); setReglaForm(REGLA_VACIA); };

    const guardarRegla = async () => {
        if (!reglaForm.nombre.trim() || !reglaForm.rol_aprobador) { toast.error('Nombre y rol aprobador son requeridos'); return; }
        if (reglaForm.operador === 'entre' && !reglaForm.umbral_max) { toast.error('Con operador "entre" debes indicar el monto máximo'); return; }
        setSavingRegla(true);
        const payload = {
            nombre:                   reglaForm.nombre,
            categoria:                reglaForm.categoria || null,
            operador:                 reglaForm.operador,
            umbral_monto:             reglaForm.umbral_monto,
            umbral_max:               reglaForm.operador === 'entre' ? reglaForm.umbral_max : null,
            moneda:                   reglaForm.moneda,
            rol_aprobador:            reglaForm.rol_aprobador,
            nivel:                    reglaForm.nivel,
            activa:                   reglaForm.activa,
            condicion_extra:          reglaForm.condicion_extra || null,
            aprobadores_multiples:    reglaForm.aprobadores_multiples,
            escalamiento_horas:       reglaForm.escalamiento_horas,
            aplica_automatico:        reglaForm.aplica_automatico,
            descripcion_regulatoria:  reglaForm.descripcion_regulatoria || null,
        };
        try {
            if (editingRegla) {
                const { error } = await supabase.from('matriz_aprobacion').update(payload).eq('id', editingRegla.id);
                if (error) throw new Error(error.message);
                toast.success('Regla actualizada');
            } else {
                const { error } = await supabase.from('matriz_aprobacion').insert({ ...payload, organization_id: currentUser.organizationId, created_by: currentUser.id });
                if (error) throw new Error(error.message);
                toast.success('Regla creada');
            }
            cancelarReglaForm();
            const m = await GovernanceService.getMatriz(currentUser.organizationId);
            setMatriz(m as Record<string, unknown>[]);
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setSavingRegla(false);
        }
    };

    // Simulador de reglas
    const simularReglas = () => {
        const monto = Number(simuladorVal);
        const cat   = simuladorCat.trim().toLowerCase();
        const activas = (matriz as MatrizRegla[]).filter(r => r.activa);
        const matches = activas.filter(r => {
            const catMatch = !r.categoria || r.categoria.toLowerCase() === cat || cat === '';
            let montoMatch = true;
            if (r.umbral_monto > 0 || r.operador !== '>=') {
                switch (r.operador) {
                    case '>=':    montoMatch = monto >= r.umbral_monto; break;
                    case '>':     montoMatch = monto >  r.umbral_monto; break;
                    case '<=':    montoMatch = monto <= r.umbral_monto; break;
                    case '<':     montoMatch = monto <  r.umbral_monto; break;
                    case '==':    montoMatch = monto === r.umbral_monto; break;
                    case 'entre': montoMatch = monto >= r.umbral_monto && monto <= (r.umbral_max ?? Infinity); break;
                }
            }
            return catMatch && montoMatch;
        });
        setSimuladorResult(matches.sort((a, b) => b.nivel - a.nivel));
    };

    // Sugerencias IA (llama a execute-workflow con un flujo especial o simplemente genera localmente)
    const pedirSugerenciaIA = async () => {
        setIaLoading(true);
        setIaSugerencia(null);
        try {
            // Análisis local de gaps en la matriz actual
            const reglas = (matriz as MatrizRegla[]).filter(r => r.activa);
            const categorias = [...new Set(reglas.map(r => r.categoria).filter(Boolean))];
            const sinEscalamiento = reglas.filter(r => r.aprobadores_multiples < 2 && r.umbral_monto >= 50000);
            const sinRegulatorio = reglas.filter(r => !r.descripcion_regulatoria);
            const sugerencias: string[] = [];

            if (reglas.length === 0) {
                sugerencias.push('📋 No hay reglas activas. Recomiendo crear al menos: (1) Pagos > USD 10.000 → Supervisor, (2) Contratos > USD 50.000 → Gerente con doble aprobación, (3) Listas restrictivas → Cumplimiento automático.');
            } else {
                if (sinEscalamiento.length > 0)
                    sugerencias.push(`⚠️ ${sinEscalamiento.length} regla(s) con montos ≥ USD 50.000 tienen solo 1 aprobador. Considera activar doble control (aprobadores_multiples = 2) para cumplir con controles internos.`);
                if (sinRegulatorio.length > 0)
                    sugerencias.push(`📑 ${sinRegulatorio.length} regla(s) no tienen referencia regulatoria. Documenta la normativa aplicable (SUDEBAN, OFAC, etc.) para auditorías.`);
                if (!categorias.includes('aml') && !categorias.includes('ofac'))
                    sugerencias.push('🔍 No hay regla para la categoría "aml" u "ofac". Recomiendo crear una regla de cumplimiento para verificaciones OFAC/PEP que aplique automáticamente.');
                if (reglas.every(r => r.escalamiento_horas >= 72))
                    sugerencias.push('⏰ Todas las reglas tienen escalamiento ≥ 72 horas. Considera reducir el SLA para procesos críticos (pagos urgentes, siniestros activos).');
                if (sugerencias.length === 0)
                    sugerencias.push('✅ La matriz está bien configurada. Considera revisar las métricas de uso periódicamente para ajustar umbrales según el volumen real de operaciones.');
            }
            setIaSugerencia(sugerencias.join('\n\n'));
        } finally {
            setIaLoading(false);
        }
    };

    const toggleRegla = async (r: MatrizRegla) => {
        const { error } = await supabase.from('matriz_aprobacion').update({ activa: !r.activa }).eq('id', r.id);
        if (error) { toast.error(error.message); return; }
        setMatriz(prev => prev.map(m => m.id === r.id ? { ...m, activa: !r.activa } : m));
    };

    const eliminarRegla = async (r: MatrizRegla) => {
        if (!confirm(`¿Eliminar la regla "${r.nombre}"?`)) return;
        const { error } = await supabase.from('matriz_aprobacion').delete().eq('id', r.id);
        if (error) { toast.error(error.message); return; }
        setMatriz(prev => prev.filter(m => m.id !== r.id));
        toast.success('Regla eliminada');
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // Se pide solo lo que el rol va a poder ver. Con la auditoría no es
            // cosmético: la RLS filtra filas, no da error, así que un rol sin
            // 'view_audit' recibiría una lista vacía indistinguible de "no hay
            // nada registrado". Mejor no preguntar que mostrar un vacío que miente.
            const [u, a, m] = await Promise.all([
                isAdmin       ? GovernanceService.getUsers(currentUser.organizationId)          : Promise.resolve([]),
                canViewAudit  ? GovernanceService.getAuditTrail(currentUser.organizationId, 150) : Promise.resolve([]),
                isAdmin       ? GovernanceService.getMatriz(currentUser.organizationId)         : Promise.resolve([]),
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
    }, [currentUser.organizationId, isAdmin, canViewAudit]);

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
            } else if (result.reanudado) {
                toast.success('✅ Flujo aprobado y reanudado correctamente');
            } else {
                // Reanudar ya NO lo hace el frontend: lo hace resolve-approval por
                // la vía interna. Desde el navegador se llamaba a execute-workflow
                // con el JWT del aprobador, y esa función exige ROLES_QUE_EJECUTAN
                // —un `cumplimiento` aprobaba y se comía un 403 al reanudar.
                toast.warning(`⚠ Aprobado pero error al reanudar: ${result.errorResume ?? 'error desconocido'}`);
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

    // Clave temporal para quien olvidó la suya.
    //
    // Invalida la contraseña actual de esa persona en el acto, así que se
    // confirma antes: el usuario que estuviera dentro seguirá con su sesión,
    // pero no podrá volver a entrar con lo que sabía.
    const handleReset = async () => {
        if (!resetUser || resetting) return;
        setResetting(true);
        try {
            const { tempPassword } = await GovernanceService.resetPassword(resetUser.id);
            setResetPass(tempPassword);
        } catch (e) {
            toast.error((e as Error)?.message ?? 'No se pudo restablecer la contraseña');
        } finally { setResetting(false); }
    };

    const cerrarReset = () => { setResetUser(null); setResetPass(null); };

    // Sin ningún permiso relevante — bloquear completamente
    if (!isAdmin && !canApprove && !canViewAudit) {
        return (
            <div className="h-full flex items-center justify-center bg-gray-50">
                <div className="text-center max-w-sm">
                    <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Lock className="w-6 h-6 text-red-400" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-800">Acceso restringido</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        El módulo de Gobierno no está disponible para tu rol.
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

    // Cada pestaña declara el permiso que exige, en vez del antiguo adminOnly.
    // Auditoría pasa a 'view_audit', que es lo que la deja ver al auditor, al
    // dueño de proceso y a cumplimiento, no solo al admin.
    const ALL_TABS: { id: Tab; label: string; icon: typeof Users; badge?: number; visible: boolean }[] = [
        { id: 'usuarios',      label: 'Usuarios y Roles',      icon: Users,          visible: isAdmin },
        { id: 'aprobaciones',  label: 'Bandeja de Aprobación', icon: ClipboardCheck, visible: isAdmin || canApprove, badge: aprobaciones.filter(t => isAdmin || currentUser.role === t.rol_aprobador).length },
        { id: 'matriz',        label: 'Matriz de Aprobación',  icon: ShieldCheck,    visible: isAdmin },
        { id: 'auditoria',     label: 'Auditoría',             icon: ScrollText,     visible: canViewAudit },
    ];
    const TABS = ALL_TABS.filter(t => t.visible);
    // Caer en la primera pestaña disponible, no en 'aprobaciones' fija: un
    // auditor no tiene bandeja, así que ese destino le dejaba la vista en blanco.
    const efectiveTab = TABS.find(t => t.id === tab)?.id ?? TABS[0]?.id;
    const misBandeja = isAdmin
        ? aprobaciones
        : aprobaciones.filter(t => currentUser.role === t.rol_aprobador);

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
                                efectiveTab === id ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:text-gray-700'
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
                        {efectiveTab === 'usuarios' && (
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
                                            <th className="text-center px-3 py-2 font-bold">Clave</th>
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
                                                <td className="px-3 py-3 text-center">
                                                    {/* Para uno mismo no: «Cambiar mi contraseña» pide la actual,
                                                        y saltarse esa comprobación desde aquí sería regalarle a
                                                        cualquiera con la sesión de un admin abierta una forma de
                                                        cambiarle la clave sin conocerla. */}
                                                    {u.id === currentUser.id ? (
                                                        <span className="text-[10px] text-gray-300">—</span>
                                                    ) : (
                                                        <button
                                                            onClick={() => { setResetPass(null); setResetUser(u); }}
                                                            disabled={savingId === u.id}
                                                            title={`Asignar una clave temporal a ${u.name} (olvidó la suya)`}
                                                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                                                        >
                                                            <KeyRound className="w-3 h-3" />
                                                            Restablecer
                                                        </button>
                                                    )}
                                                </td>
                                                <td className="px-5 py-3 text-right text-[11px] text-gray-400">{fmtDate(u.createdAt)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* ── BANDEJA DE APROBACIONES ───────────────────── */}
                        {efectiveTab === 'aprobaciones' && (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                                    <div>
                                        <h2 className="font-semibold text-gray-800 text-sm">Bandeja de Aprobaciones</h2>
                                        <p className="text-xs text-gray-400 mt-0.5">Flujos pausados esperando tu autorización</p>
                                    </div>
                                    <span className="text-xs text-gray-500">{misBandeja.length} pendiente{misBandeja.length !== 1 ? 's' : ''}</span>
                                </div>

                                {misBandeja.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                                        <CheckCircle className="w-10 h-10 mb-3 text-emerald-300" />
                                        <p className="text-sm font-medium">Sin aprobaciones pendientes</p>
                                        <p className="text-xs mt-1">Los flujos que requieran tu autorización aparecerán aquí</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-gray-100">
                                        {misBandeja.map(tarea => (
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
                                                        {canResolve(tarea) ? (<>
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
                                                        </>) : (
                                                            <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
                                                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                                                Solo rol {tarea.rol_aprobador}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── MATRIZ F3.3 ───────────────────────────────── */}
                        {efectiveTab === 'matriz' && (
                            <div className="space-y-4">

                                {/* ── Cabecera ── */}
                                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                    <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
                                        <div>
                                            <h2 className="font-semibold text-gray-800 text-sm">Matriz de Autorización</h2>
                                            <p className="text-[11px] text-gray-400 mt-0.5">Umbrales, aprobadores, doble control, escalamiento y normativa</p>
                                        </div>
                                        {isAdmin && !showMatrizForm && (
                                            <div className="flex items-center gap-2">
                                                <button onClick={pedirSugerenciaIA} disabled={iaLoading}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors disabled:opacity-50">
                                                    {iaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                                    Sugerencias IA
                                                </button>
                                                <button onClick={openNuevaRegla}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                                                    <Plus className="w-3.5 h-3.5" /> Nueva regla
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Sugerencias IA */}
                                    {iaSugerencia && (
                                        <div className="px-5 py-3 bg-violet-50 border-b border-violet-100">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-start gap-2">
                                                    <Sparkles className="w-3.5 h-3.5 text-violet-500 mt-0.5 flex-shrink-0" />
                                                    <div className="space-y-1.5">
                                                        {iaSugerencia.split('\n\n').map((s, i) => (
                                                            <p key={i} className="text-[11px] text-violet-800">{s}</p>
                                                        ))}
                                                    </div>
                                                </div>
                                                <button onClick={() => setIaSugerencia(null)} className="text-violet-400 hover:text-violet-600 flex-shrink-0">
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* ── Formulario crear/editar ── */}
                                    {showMatrizForm && (
                                        <div className="px-5 py-4 bg-indigo-50/40 border-b border-indigo-100">
                                            <p className="text-xs font-semibold text-indigo-700 mb-4">
                                                {editingRegla ? '✏️ Editar regla' : '➕ Nueva regla de autorización'}
                                            </p>
                                            <div className="grid grid-cols-2 gap-3">

                                                {/* Nombre */}
                                                <div className="col-span-2">
                                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Nombre de la regla *</label>
                                                    <input value={reglaForm.nombre} onChange={e => setReglaForm(f => ({ ...f, nombre: e.target.value }))}
                                                        placeholder="Ej: Pagos patrimoniales mayores a USD 10.000"
                                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                </div>

                                                {/* Categoría */}
                                                <div>
                                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Categoría del proceso</label>
                                                    <input value={reglaForm.categoria} onChange={e => setReglaForm(f => ({ ...f, categoria: e.target.value }))}
                                                        placeholder="siniestro / pago / contrato / aml"
                                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                </div>

                                                {/* Rol aprobador */}
                                                <div>
                                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Rol aprobador *</label>
                                                    <select value={reglaForm.rol_aprobador} onChange={e => setReglaForm(f => ({ ...f, rol_aprobador: e.target.value }))}
                                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                                                        {ROLES_ASIGNABLES.map(r => <option key={r} value={r}>{ROL_META[r]?.label ?? r}</option>)}
                                                    </select>
                                                </div>

                                                {/* Operador + umbral */}
                                                <div>
                                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Condición de monto</label>
                                                    <div className="flex gap-2">
                                                        <select value={reglaForm.moneda} onChange={e => setReglaForm(f => ({ ...f, moneda: e.target.value }))}
                                                            className="text-sm px-2 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white w-20">
                                                            {['USD','EUR','VES'].map(c => <option key={c}>{c}</option>)}
                                                        </select>
                                                        <select value={reglaForm.operador} onChange={e => setReglaForm(f => ({ ...f, operador: e.target.value }))}
                                                            className="text-sm px-2 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white w-20">
                                                            {[['>=','≥'],['>', '>'],['<=','≤'],['<','<'],['==','='],['entre','Entre']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                                                        </select>
                                                        <input type="number" min={0} value={reglaForm.umbral_monto}
                                                            onChange={e => setReglaForm(f => ({ ...f, umbral_monto: Number(e.target.value) }))}
                                                            placeholder="Mínimo" className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                        {reglaForm.operador === 'entre' && (
                                                            <input type="number" min={0} value={reglaForm.umbral_max ?? ''}
                                                                onChange={e => setReglaForm(f => ({ ...f, umbral_max: Number(e.target.value) || null }))}
                                                                placeholder="Máximo" className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Nivel + doble control */}
                                                <div>
                                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Nivel de escalamiento</label>
                                                    <div className="flex gap-2">
                                                        <input type="number" min={1} max={5} value={reglaForm.nivel}
                                                            onChange={e => setReglaForm(f => ({ ...f, nivel: Number(e.target.value) }))}
                                                            className="w-20 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                        <div className="flex-1">
                                                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Aprobadores requeridos</label>
                                                            <select value={reglaForm.aprobadores_multiples}
                                                                onChange={e => setReglaForm(f => ({ ...f, aprobadores_multiples: Number(e.target.value) }))}
                                                                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                                                                <option value={1}>1 aprobador</option>
                                                                <option value={2}>2 — doble control</option>
                                                                <option value={3}>3 — triple control</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Escalamiento horas */}
                                                <div>
                                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">SLA de aprobación (horas)</label>
                                                    <input type="number" min={1} value={reglaForm.escalamiento_horas}
                                                        onChange={e => setReglaForm(f => ({ ...f, escalamiento_horas: Number(e.target.value) }))}
                                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                    <p className="text-[10px] text-gray-400 mt-1">Si no responden en este tiempo el flujo escala al nivel superior</p>
                                                </div>

                                                {/* Condición extra */}
                                                <div className="col-span-2">
                                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Condición adicional (opcional)</label>
                                                    <input value={reglaForm.condicion_extra}
                                                        onChange={e => setReglaForm(f => ({ ...f, condicion_extra: e.target.value }))}
                                                        placeholder="Ej: solo si país = Venezuela  /  solo si ramo = patrimonial"
                                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                </div>

                                                {/* Referencia regulatoria */}
                                                <div className="col-span-2">
                                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Referencia normativa</label>
                                                    <input value={reglaForm.descripcion_regulatoria}
                                                        onChange={e => setReglaForm(f => ({ ...f, descripcion_regulatoria: e.target.value }))}
                                                        placeholder="Ej: SUDEBAN Circular SIB-II-GGIBPV-12, OFAC 50% Ownership Rule"
                                                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                                </div>

                                                {/* Automático */}
                                                <div className="col-span-2 flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                                                    <input type="checkbox" id="aplica_auto" checked={reglaForm.aplica_automatico}
                                                        onChange={e => setReglaForm(f => ({ ...f, aplica_automatico: e.target.checked }))}
                                                        className="w-4 h-4 accent-amber-500" />
                                                    <label htmlFor="aplica_auto" className="text-[11px] text-amber-800 cursor-pointer">
                                                        <strong>El Agente IA puede decidir automáticamente</strong> sin requerir aprobador humano
                                                    </label>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 mt-4">
                                                <button onClick={guardarRegla} disabled={savingRegla}
                                                    className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                                                    {savingRegla ? 'Guardando...' : editingRegla ? 'Actualizar regla' : 'Crear regla'}
                                                </button>
                                                <button onClick={cancelarReglaForm} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                                                    Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* ── Lista de reglas ── */}
                                    {matriz.length === 0 && !showMatrizForm ? (
                                        <div className="py-12 text-center">
                                            <ShieldCheck className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                            <p className="text-sm text-gray-400">Sin reglas de autorización configuradas</p>
                                            <p className="text-[11px] text-gray-300 mt-1">Haz clic en "Nueva regla" o en "Sugerencias IA" para comenzar</p>
                                        </div>
                                    ) : matriz.length > 0 && (
                                        <div className="divide-y divide-gray-50">
                                            {(matriz as MatrizRegla[]).map((m) => {
                                                const expanded = expandedRegla === m.id;
                                                const tasaExito = (m.aprobaciones_count + m.rechazos_count) > 0
                                                    ? Math.round(m.aprobaciones_count / (m.aprobaciones_count + m.rechazos_count) * 100) : null;
                                                return (
                                                    <div key={m.id} className={`${!m.activa ? 'opacity-50' : ''}`}>
                                                        {/* Fila principal */}
                                                        <div className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50/60">
                                                            <button onClick={() => setExpandedRegla(expanded ? null : m.id)}
                                                                className="text-gray-400 hover:text-indigo-600 flex-shrink-0">
                                                                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                                            </button>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="font-medium text-gray-800 text-sm">{m.nombre}</span>
                                                                    {m.categoria && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{m.categoria}</span>}
                                                                    {m.aplica_automatico && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">IA auto</span>}
                                                                    {m.aprobadores_multiples >= 2 && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">Doble control</span>}
                                                                </div>
                                                                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400 flex-wrap">
                                                                    <span>{m.moneda} {m.operador === 'entre'
                                                                        ? `${Number(m.umbral_monto).toLocaleString()} – ${Number(m.umbral_max).toLocaleString()}`
                                                                        : `${m.operador} ${Number(m.umbral_monto).toLocaleString()}`}</span>
                                                                    <span>·</span>
                                                                    <span style={{ color: ROL_META[m.rol_aprobador as Role]?.color ?? '#64748b' }}>
                                                                        {ROL_META[m.rol_aprobador as Role]?.label ?? m.rol_aprobador}
                                                                    </span>
                                                                    <span>· SLA {m.escalamiento_horas}h</span>
                                                                    {m.veces_activada > 0 && <span>· {m.veces_activada} activaciones</span>}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.activa ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                                                                    {m.activa ? 'Activa' : 'Inactiva'}
                                                                </span>
                                                                {isAdmin && (
                                                                    <>
                                                                        <button onClick={() => toggleRegla(m)} title={m.activa ? 'Desactivar' : 'Activar'}
                                                                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-indigo-600 transition-colors">
                                                                            {m.activa ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                                                                        </button>
                                                                        <button onClick={() => openEditarRegla(m)} title="Editar"
                                                                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-indigo-600 transition-colors">
                                                                            <Pencil className="w-3.5 h-3.5" />
                                                                        </button>
                                                                        <button onClick={() => eliminarRegla(m)} title="Eliminar"
                                                                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Detalle expandido */}
                                                        {expanded && (
                                                            <div className="px-5 pb-4 pt-1 bg-gray-50/50 border-t border-gray-100">
                                                                <div className="grid grid-cols-3 gap-4">
                                                                    {/* Métricas */}
                                                                    <div className="bg-white rounded-xl border border-gray-100 p-3 space-y-2">
                                                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                                                            <TrendingUp className="w-3 h-3" /> Métricas de uso
                                                                        </p>
                                                                        <div className="grid grid-cols-2 gap-2 text-center">
                                                                            <div>
                                                                                <p className="text-lg font-bold text-gray-800">{m.veces_activada}</p>
                                                                                <p className="text-[10px] text-gray-400">Activaciones</p>
                                                                            </div>
                                                                            <div>
                                                                                <p className="text-lg font-bold text-emerald-600">{tasaExito !== null ? `${tasaExito}%` : '—'}</p>
                                                                                <p className="text-[10px] text-gray-400">Tasa aprobación</p>
                                                                            </div>
                                                                            <div>
                                                                                <p className="text-base font-bold text-emerald-500">{m.aprobaciones_count}</p>
                                                                                <p className="text-[10px] text-gray-400">Aprobados</p>
                                                                            </div>
                                                                            <div>
                                                                                <p className="text-base font-bold text-red-400">{m.rechazos_count}</p>
                                                                                <p className="text-[10px] text-gray-400">Rechazados</p>
                                                                            </div>
                                                                        </div>
                                                                        {m.tiempo_promedio_hs != null && (
                                                                            <div className="flex items-center gap-1 text-[11px] text-gray-500 border-t border-gray-50 pt-2">
                                                                                <Clock className="w-3 h-3" />
                                                                                Tiempo promedio: <strong>{m.tiempo_promedio_hs.toFixed(1)}h</strong>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* Configuración */}
                                                                    <div className="bg-white rounded-xl border border-gray-100 p-3 space-y-2">
                                                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Configuración</p>
                                                                        <div className="space-y-1.5 text-[11px]">
                                                                            <div className="flex justify-between"><span className="text-gray-400">Aprobadores</span><span className="font-medium">{m.aprobadores_multiples} requerido{m.aprobadores_multiples > 1 ? 's' : ''}</span></div>
                                                                            <div className="flex justify-between"><span className="text-gray-400">Nivel escalamiento</span><span className="font-medium">{m.nivel}</span></div>
                                                                            <div className="flex justify-between"><span className="text-gray-400">SLA</span><span className="font-medium">{m.escalamiento_horas}h</span></div>
                                                                            <div className="flex justify-between"><span className="text-gray-400">Agente IA</span><span className={`font-medium ${m.aplica_automatico ? 'text-amber-600' : 'text-gray-400'}`}>{m.aplica_automatico ? 'Automático' : 'Manual'}</span></div>
                                                                            {m.condicion_extra && <div><span className="text-gray-400">Condición extra: </span><span className="font-medium">{m.condicion_extra}</span></div>}
                                                                        </div>
                                                                    </div>

                                                                    {/* Normativa */}
                                                                    <div className="bg-white rounded-xl border border-gray-100 p-3 space-y-2">
                                                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                                                            <BookOpen className="w-3 h-3" /> Normativa
                                                                        </p>
                                                                        {m.descripcion_regulatoria ? (
                                                                            <p className="text-[11px] text-gray-600 leading-relaxed">{m.descripcion_regulatoria}</p>
                                                                        ) : (
                                                                            <p className="text-[11px] text-gray-300 italic">Sin referencia regulatoria</p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <div className="px-5 py-3 bg-amber-50/50 border-t border-amber-100 flex items-start gap-2">
                                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                                        <p className="text-[11px] text-amber-700">
                                            <strong>Segregación de funciones activa:</strong> quien ejecuta un flujo no puede aprobarlo.
                                        </p>
                                    </div>
                                </div>

                                {/* ── Simulador de reglas ── */}
                                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                    <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
                                        <FlaskConical className="w-4 h-4 text-indigo-500" />
                                        <h3 className="font-semibold text-gray-800 text-sm">Simulador de reglas</h3>
                                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">¿Qué regla aplica?</span>
                                    </div>
                                    <div className="px-5 py-4">
                                        <div className="flex items-end gap-3 flex-wrap">
                                            <div>
                                                <label className="block text-[11px] text-gray-500 mb-1">Monto a verificar</label>
                                                <input type="number" value={simuladorVal} onChange={e => setSimuladorVal(e.target.value)}
                                                    placeholder="Ej: 15000"
                                                    className="text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 w-40" />
                                            </div>
                                            <div>
                                                <label className="block text-[11px] text-gray-500 mb-1">Categoría (opcional)</label>
                                                <input value={simuladorCat} onChange={e => setSimuladorCat(e.target.value)}
                                                    placeholder="siniestro / pago"
                                                    className="text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 w-44" />
                                            </div>
                                            <button onClick={simularReglas}
                                                className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                                                Simular
                                            </button>
                                            {simuladorResult !== null && (
                                                <button onClick={() => setSimuladorResult(null)} className="text-xs text-gray-400 hover:text-gray-600">
                                                    Limpiar
                                                </button>
                                            )}
                                        </div>

                                        {simuladorResult !== null && (
                                            <div className="mt-4">
                                                {simuladorResult.length === 0 ? (
                                                    <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">
                                                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                                                        Ninguna regla activa aplica a estos parámetros — el proceso puede continuar sin aprobación.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-semibold text-gray-600">{simuladorResult.length} regla{simuladorResult.length > 1 ? 's aplican' : ' aplica'} — se usa la de mayor nivel:</p>
                                                        {simuladorResult.map((r, i) => (
                                                            <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${i === 0 ? 'border-indigo-200 bg-indigo-50' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                                                                {i === 0 && <span className="text-[10px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded">APLICA</span>}
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-medium text-gray-800">{r.nombre}</p>
                                                                    <p className="text-[11px] text-gray-400">
                                                                        Aprobador: <strong style={{ color: ROL_META[r.rol_aprobador as Role]?.color }}>{ROL_META[r.rol_aprobador as Role]?.label ?? r.rol_aprobador}</strong>
                                                                        {r.aprobadores_multiples >= 2 && <span className="ml-2 text-blue-600 font-semibold">· Doble control</span>}
                                                                        <span className="ml-2">· SLA {r.escalamiento_horas}h</span>
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── AUDITORÍA ─────────────────────────────────── */}
                        {efectiveTab === 'auditoria' && (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <h2 className="font-semibold text-gray-800 text-sm">Registro de auditoría — inmutable</h2>
                                        <span className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full font-semibold">{audit.length} eventos</span>
                                    </div>
                                    {/* Filtros */}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="Buscar usuario, acción, entidad..."
                                            value={auditSearch}
                                            onChange={e => setAuditSearch(e.target.value)}
                                            className="flex-1 text-xs px-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                        />
                                        <div className="flex gap-1">
                                            {(['all', 'today', '7d', '30d'] as const).map(f => (
                                                <button
                                                    key={f}
                                                    onClick={() => setAuditDateFilter(f)}
                                                    className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                                                        auditDateFilter === f
                                                            ? 'bg-indigo-600 text-white'
                                                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                                    }`}
                                                >
                                                    {f === 'all' ? 'Todos' : f === 'today' ? 'Hoy' : `Últ. ${f}`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                {(() => {
                                    const now = Date.now();
                                    const filtered = audit.filter(a => {
                                        const text = `${a.usuario_email ?? ''} ${a.accion} ${a.entidad} ${a.descripcion ?? ''}`.toLowerCase();
                                        if (auditSearch && !text.includes(auditSearch.toLowerCase())) return false;
                                        if (auditDateFilter === 'all') return true;
                                        const t = new Date(a.created_at).getTime();
                                        if (auditDateFilter === 'today') return (now - t) < 86400000;
                                        if (auditDateFilter === '7d')    return (now - t) < 7 * 86400000;
                                        if (auditDateFilter === '30d')   return (now - t) < 30 * 86400000;
                                        return true;
                                    });

                                    if (filtered.length === 0) return (
                                        <div className="py-12 text-center">
                                            <ScrollText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                            <p className="text-sm text-gray-400">Sin eventos para los filtros seleccionados</p>
                                        </div>
                                    );

                                    return (
                                        <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
                                            {filtered.map(a => {
                                                const meta = ACCION_META[a.accion] ?? { label: a.accion, color: 'text-gray-500' };
                                                return (
                                                    <div key={a.id} className="px-5 py-3 hover:bg-gray-50/60 transition-colors">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-xs text-gray-700">
                                                                    <span className="font-semibold text-gray-900">{a.usuario_email ?? 'Sistema'}</span>{' '}
                                                                    <span className={`font-semibold ${meta.color}`}>{meta.label.toLowerCase()}</span>{' '}
                                                                    <span className="font-medium text-gray-600">{a.entidad}</span>
                                                                </p>
                                                                {a.descripcion && (
                                                                    <p className="text-xs text-gray-500 mt-0.5">{a.descripcion}</p>
                                                                )}
                                                                {a.entidad_id && (
                                                                    <p className="text-xs text-gray-400 mt-0.5 font-mono">ID: {a.entidad_id}</p>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                                                <span className="text-xs text-gray-400">{fmtDate(a.created_at)}</span>
                                                                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                                                                    a.accion === 'aprobar'   ? 'bg-emerald-50 text-emerald-600' :
                                                                    a.accion === 'rechazar'  ? 'bg-red-50 text-red-600' :
                                                                    a.accion === 'eliminar'  ? 'bg-red-50 text-red-500' :
                                                                    a.accion === 'ejecutar'  ? 'bg-indigo-50 text-indigo-600' :
                                                                    a.accion === 'login'     ? 'bg-gray-50 text-gray-400' :
                                                                    'bg-blue-50 text-blue-600'
                                                                }`}>
                                                                    {meta.label}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── Modal Restablecer contraseña ─────────────────────────── */}
            {resetUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !resetting && cerrarReset()}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                            <div className="flex items-center gap-2">
                                <KeyRound className="w-4 h-4 text-amber-600" />
                                <h3 className="font-semibold text-gray-800 text-sm">Restablecer contraseña</h3>
                            </div>
                            <button onClick={cerrarReset} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                        </div>

                        {resetPass ? (
                            <div className="p-6 text-center space-y-3">
                                <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto">
                                    <CheckCircle className="w-6 h-6 text-emerald-500" />
                                </div>
                                <p className="text-sm font-semibold text-gray-800">Clave temporal generada</p>
                                <p className="text-xs text-gray-500">
                                    Entrégasela a <strong>{resetUser.name}</strong> por un medio que no sea este.
                                    El sistema le obligará a cambiarla en cuanto entre.
                                </p>
                                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                    <code className="flex-1 text-sm font-mono text-gray-800 text-left">{resetPass}</code>
                                    <button
                                        onClick={() => { navigator.clipboard.writeText(resetPass); toast.success('Clave copiada'); }}
                                        className="text-gray-400 hover:text-indigo-600"><Copy className="w-4 h-4" /></button>
                                </div>
                                {/* No se guarda en ningún sitio: si se cierra sin copiarla, hay que repetir. */}
                                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                    Cópiala ahora. No se guarda en ninguna parte y no se puede volver a consultar.
                                </p>
                                <button onClick={cerrarReset}
                                    className="w-full mt-2 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                                    Entendido
                                </button>
                            </div>
                        ) : (
                            <div className="p-5 space-y-4">
                                <p className="text-sm text-gray-700">
                                    Vas a generar una clave temporal para <strong>{resetUser.name}</strong>
                                    <span className="text-gray-400"> ({resetUser.email})</span>.
                                </p>
                                <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 space-y-1.5">
                                    <p className="text-[11px] text-amber-800">
                                        Su contraseña actual dejará de funcionar <strong>inmediatamente</strong>.
                                    </p>
                                    <p className="text-[11px] text-amber-800">
                                        Hazlo solo si esa persona te lo ha pedido y sabes que es ella.
                                    </p>
                                </div>
                                <div className="flex gap-2 pt-1">
                                    <button onClick={cerrarReset} disabled={resetting}
                                        className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                                        Cancelar
                                    </button>
                                    <button onClick={handleReset} disabled={resetting}
                                        className="flex-1 py-2 text-sm font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2">
                                        {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                                        {resetting ? 'Generando...' : 'Generar clave temporal'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

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
