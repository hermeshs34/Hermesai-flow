import { useEffect, useState } from 'react';
import {
    LayoutDashboard, Workflow, Activity,
    Settings as SettingsIcon, Zap, ChevronRight,
    LogOut, CheckCircle, AlertCircle, Clock, HelpCircle,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import type { ViewType } from '../App';
import type { User } from '../core/user.types';

interface SidebarProps {
    currentView:     ViewType;
    onViewChange:    (view: ViewType) => void;
    onShowTutorial?: () => void;
    currentUser?:    User;
    onLogout?:       () => void;
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

const NAV = [
    { id: 'dashboard'  as ViewType, label: 'Dashboard',             icon: LayoutDashboard, badge: null },
    { id: 'canvas'     as ViewType, label: 'Constructor de Flujos',  icon: Workflow,         badge: null },
    { id: 'monitoring' as ViewType, label: 'Monitoreo',              icon: Activity,         badge: null },
    { id: 'settings'   as ViewType, label: 'Configuración',          icon: SettingsIcon,     badge: null },
];

export function Sidebar({ currentView, onViewChange, onShowTutorial, currentUser, onLogout }: SidebarProps) {
    const systems = useSystemHealth();
    const initials = currentUser?.name
        ?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() ?? 'HS';

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
                        <p className="text-[10px] text-indigo-300 leading-tight">Hub de Automatización</p>
                    </div>
                </div>
            </div>

            {/* Navegación */}
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
                <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest px-2 mb-2">Módulos</p>
                {NAV.map(({ id, label, icon: Icon }) => {
                    const active = currentView === id;
                    return (
                        <button
                            key={id}
                            onClick={() => onViewChange(id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-sm ${
                                active
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50'
                                    : 'text-white/60 hover:text-white hover:bg-white/8'
                            }`}
                        >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span className="font-medium">{label}</span>
                            {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-70" />}
                        </button>
                    );
                })}

                {/* Sistemas conectados */}
                <div className="mt-6 pt-4 border-t border-white/10">
                    <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest px-2 mb-3">Sistemas</p>
                    <div className="space-y-1.5 px-2">
                        {systems.map(s => (
                            <div key={s.name}
                                className="flex items-center justify-between"
                                title={`${s.message}${s.latency_ms != null ? ` · ${s.latency_ms}ms` : ''}${s.last_check ? ` · ${new Date(s.last_check).toLocaleTimeString('es-VE')}` : ''}`}
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
                        <p className="text-[10px] text-white/40 truncate">{currentUser?.email ?? ''}</p>
                    </div>
                            <div className="flex items-center gap-1">
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
