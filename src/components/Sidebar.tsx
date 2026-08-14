import { useEffect, useState, useCallback } from 'react';
import {
    LayoutDashboard, Workflow, Activity,
    Settings as SettingsIcon, Zap, ChevronRight,
    LogOut, CheckCircle, AlertCircle, Clock, HelpCircle, ShieldCheck, KeyRound,
    ListTodo,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import { horaVE } from '../utils/fecha';
import { authService } from '../core/auth.service';
import { ROL_META, puedeResolverTarea, type TareaResoluble } from '../core/user.types';
import { useRolesDelegados } from '../utils/delegaciones';
import type { ViewType } from '../App';
import type { User } from '../core/user.types';

interface SidebarProps {
    currentView:       ViewType;
    onViewChange:      (view: ViewType) => void;
    onShowTutorial?:   () => void;
    onChangePassword?: () => void;
    currentUser?:      User;
    onLogout?:         () => void;
}

type SystemStatus = 'ok' | 'error' | 'unconfigured' | 'loading';

interface SystemHealth {
    name:       string;
    status:     SystemStatus;
    latency_ms: number | null;
    message:    string;
    last_check: string;
}

const STATUS_DOT: Record<string, string> = {
    ok:           'bg-emerald-400',
    error:        'bg-red-400',
    unconfigured: 'bg-amber-400',
    loading:      'bg-gray-300 animate-pulse',
};

const INIT: SystemHealth[] = [
    { name: 'Tasa BCV',    status: 'loading', latency_ms: null, message: 'Verificando...', last_check: '' },
    { name: 'Indicadores', status: 'loading', latency_ms: null, message: 'Verificando...', last_check: '' },
    { name: 'EE.FF.',      status: 'loading', latency_ms: null, message: 'Verificando...', last_check: '' },
    { name: 'RiskGuard',   status: 'loading', latency_ms: null, message: 'Verificando...', last_check: '' },
    { name: 'Resend',      status: 'loading', latency_ms: null, message: 'Verificando...', last_check: '' },
];

interface SidebarBadges { errors: number; pending: number; }

function useSidebarBadges(organizationId: string | undefined, userId: string | undefined, role: string | undefined): SidebarBadges {
    const [badges, setBadges] = useState<SidebarBadges>({ errors: 0, pending: 0 });
    // Los roles que ejerce por suplencia cuentan igual que el propio: si a
    // alguien le delegaron la firma, sus pendientes son suyos de verdad.
    const delegados = useRolesDelegados(userId, organizationId);

    const fetch = useCallback(async () => {
        const [errRes, pendRes] = await Promise.all([
            supabase.from('execution_runs').select('id', { count: 'exact', head: true }).eq('status', 'error'),
            organizationId
                // `solicitante_id` hace falta para la segregación de funciones:
                // sin él el globo contaba tareas que este usuario no puede
                // aprobar por ser quien lanzó el flujo.
                ? supabase.from('tareas_aprobacion').select('rol_aprobador, solicitante_id')
                    .eq('organization_id', organizationId).eq('estado', 'pendiente')
                : Promise.resolve({ data: [], error: null }),
        ]);

        // Misma regla que WorkQueue, Governance y —la que manda— resolve-approval.
        const tareas = (pendRes as { data: TareaResoluble[] | null }).data ?? [];
        const pendingCount = (userId && role)
            ? tareas.filter(t => puedeResolverTarea({ id: userId, role }, t, delegados)).length
            : 0;

        setBadges({ errors: errRes.count ?? 0, pending: pendingCount });
    }, [organizationId, userId, role, delegados]);

    useEffect(() => {
        fetch();
        const ch = supabase
            .channel('sidebar-badges')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'execution_runs' }, fetch)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_aprobacion' }, fetch)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [fetch]);

    return badges;
}

// Llama a la edge function health-check para obtener latencia y estado reales
function useSystemHealth(): SystemHealth[] {
    const [health, setHealth] = useState<SystemHealth[]>(INIT);

    const check = () => {
        supabase.functions.invoke('health-check')
            .then(({ data }) => {
                if (data?.systems) setHealth(data.systems as SystemHealth[]);
            })
            .catch(() => {
                setHealth(INIT.map(s => ({ ...s, status: 'error' as const, message: 'No se pudo contactar health-check' })));
            });
    };

    useEffect(() => {
        check();
        const interval = setInterval(check, 60_000); // refrescar cada minuto
        return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return health;
}

const NAV_BASE = [
    { id: 'dashboard'  as ViewType, label: 'Dashboard',            icon: LayoutDashboard, badgeKey: null             as null | 'errors' | 'pending' },
    { id: 'workqueue'  as ViewType, label: 'Cola de Trabajo',      icon: ListTodo,         badgeKey: null             },
    { id: 'canvas'     as ViewType, label: 'Constructor de Flujos', icon: Workflow,        badgeKey: null             },
    { id: 'monitoring' as ViewType, label: 'Monitoreo',             icon: Activity,        badgeKey: 'errors'        as const },
    { id: 'settings'   as ViewType, label: 'Configuración',         icon: SettingsIcon,    badgeKey: null             },
];

export function Sidebar({ currentView, onViewChange, onShowTutorial, onChangePassword, currentUser, onLogout }: SidebarProps) {
    const systems  = useSystemHealth();
    const badges   = useSidebarBadges(currentUser?.organizationId, currentUser?.id, currentUser?.role);
    const initials = currentUser?.name
        ?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() ?? 'HS';

    // Los tres permisos que abren alguna pestaña de Gobierno. Faltaba
    // 'view_audit', y por eso el auditor no tenía entrada al módulo pese a que
    // el Dashboard le ofrecía un botón "Audit trail completo" que apuntaba ahí.
    const canGovern = authService.hasPermission(currentUser ?? null, 'manage_users')
        || authService.hasPermission(currentUser ?? null, 'approve_tasks')
        || authService.hasPermission(currentUser ?? null, 'view_audit');

    const navItems = canGovern
        ? [...NAV_BASE, { id: 'governance' as ViewType, label: 'Gobierno', icon: ShieldCheck, badgeKey: 'pending' as const }]
        : NAV_BASE;

    const rolMeta = currentUser ? ROL_META[currentUser.role] : null;

    const badgeCount = (key: 'errors' | 'pending' | null) =>
        key === 'errors' ? badges.errors : key === 'pending' ? badges.pending : 0;

    return (
        <div className="w-64 flex flex-col bg-[#0f1729] text-white flex-shrink-0">

            {/* Logo */}
            <div className="px-5 py-5 border-b border-white/10">
                <div className="flex items-center gap-2.5 mb-1">
                    <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Zap className="w-4 h-4 text-white" />
                    </div>
                    <div>
                        <p className="font-bold text-sm leading-tight">HermesAI Flow</p>
                        <p className="text-xs text-indigo-300 leading-tight">Hub de Automatización</p>
                    </div>
                </div>
            </div>

            {/* Navegación */}
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
                <p className="text-xs font-semibold text-white/30 uppercase tracking-widest px-2 mb-2">Trabajo</p>
                {navItems.map(({ id, label, icon: Icon, badgeKey }) => {
                    const active = currentView === id;
                    const count  = badgeCount(badgeKey);
                    const isError = badgeKey === 'errors';
                    return (
                        <button
                            key={id}
                            onClick={() => onViewChange(id)}
                            title={label}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-sm ${
                                active
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50'
                                    : 'text-white/60 hover:text-white hover:bg-white/8'
                            }`}
                        >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span className="font-medium flex-1">{label}</span>
                            {count > 0 && (
                                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                                    isError
                                        ? 'bg-red-500 text-white'
                                        : 'bg-amber-400 text-amber-900'
                                }`}>
                                    {count > 99 ? '99+' : count}
                                </span>
                            )}
                            {active && count === 0 && <ChevronRight className="w-3.5 h-3.5 opacity-70" />}
                        </button>
                    );
                })}

                {/* Sistemas conectados */}
                <div className="mt-6 pt-4 border-t border-white/10">
                    <p className="text-xs font-semibold text-white/30 uppercase tracking-widest px-2 mb-3">Sistemas</p>
                    <div className="space-y-1.5 px-2">
                        {systems.map(s => (
                            <div key={s.name}
                                className="flex items-center justify-between"
                                title={`${s.message}${s.latency_ms != null ? ` · ${s.latency_ms}ms` : ''}${s.last_check ? ` · ${horaVE(s.last_check)}` : ''}`}
                            >
                                <span className="text-xs text-white/50">{s.name}</span>
                                <div className="flex items-center gap-1.5">
                                    <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s.status] ?? 'bg-gray-300'}`} />
                                    {s.status === 'ok'
                                        ? <CheckCircle className="w-3 h-3 text-emerald-400" />
                                        : s.status === 'unconfigured'
                                        ? <Clock className="w-3 h-3 text-amber-400" />
                                        : s.status === 'loading'
                                        ? <div className="w-3 h-3 rounded-full bg-gray-200 animate-pulse" />
                                        : <AlertCircle className="w-3 h-3 text-red-400" />
                                    }
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </nav>

            {/* Usuario */}
            <div className="px-3 py-3 border-t border-white/10">
                <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{currentUser?.name ?? 'Usuario'}</p>
                        {rolMeta && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5"
                                style={{ backgroundColor: `${rolMeta.color}26`, color: rolMeta.color }}>
                                <ShieldCheck className="w-2.5 h-2.5" /> {rolMeta.label}
                            </span>
                        )}
                    </div>
                            <div className="flex items-center gap-1">
                        {onChangePassword && (
                            <button
                                onClick={onChangePassword}
                                className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-white/40 hover:text-indigo-400 transition-colors"
                                title="Cambiar contraseña"
                            >
                                <KeyRound className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {onShowTutorial && (
                            <button
                                onClick={onShowTutorial}
                                className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-white/40 hover:text-indigo-400 transition-colors"
                                title="Guía de inicio"
                            >
                                <HelpCircle className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {onLogout && (
                            <button
                                onClick={onLogout}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                                title="Cerrar sesión"
                            >
                                <LogOut className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
