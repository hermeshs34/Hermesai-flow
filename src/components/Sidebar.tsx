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

type SystemStatus = 'ok' | 'error' | 'pending' | 'unknown';

interface SystemHealth {
    name:       string;
    status:     SystemStatus;
    lastRun?:   string;
    nodeKey:    string;  // keyword en el nombre del nodo o workflow
}

const STATUS_DOT: Record<string, string> = {
    ok:      'bg-emerald-400',
    pending: 'bg-amber-400',
    error:   'bg-red-400',
    unknown: 'bg-gray-400',
};

// Detecta salud de cada sistema mirando ejecuciones recientes
function useSystemHealth(): SystemHealth[] {
    const [health, setHealth] = useState<SystemHealth[]>([
        { name: 'Tasa BCV',    nodeKey: 'bcv',        status: 'unknown' },
        { name: 'Indicadores', nodeKey: 'indicadores', status: 'unknown' },
        { name: 'EE.FF.',      nodeKey: 'eeff',        status: 'unknown' },
        { name: 'RiskGuard',   nodeKey: 'riskguard',   status: 'unknown' },
        { name: 'LegalTech',   nodeKey: 'legaltech',   status: 'unknown' },
    ]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const [{ data: runs }, { data: nodes }] = await Promise.all([
                    supabase.from('execution_runs')
                        .select('status, started_at, workflows(name)')
                        .order('started_at', { ascending: false })
                        .limit(50),
                    supabase.from('workflow_nodes')
                        .select('category')
                        .in('category', ['bcv', 'indicadores', 'eeff', 'riskguard', 'legaltech']),
                ]);
                if (!active) return;

                const configured = new Set((nodes ?? []).map((n: any) => n.category as string));

                setHealth(prev => prev.map(sys => {
                    const rel = (runs ?? []).filter((r: any) => {
                        const name = (Array.isArray(r.workflows) ? r.workflows[0]?.name : r.workflows?.name) ?? '';
                        return String(name).toLowerCase().includes(sys.nodeKey);
                    });
                    if (rel.length === 0) {
                        return { ...sys, status: configured.has(sys.nodeKey) ? 'pending' : 'unknown' };
                    }
                    const last = rel[0] as any;
                    const status: SystemStatus = last.status === 'success' ? 'ok'
                        : last.status === 'error' ? 'error' : 'pending';
                    return { ...sys, status, lastRun: last.started_at };
                }));
            } catch { /* fallo silencioso */ }
        })();
        return () => { active = false; };
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
                            <div key={s.name} className="flex items-center justify-between">
                                <span className="text-xs text-white/50">{s.name}</span>
                                <div className="flex items-center gap-1.5">
                                    <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s.status]}`} />
                                    {s.status === 'ok'
                                        ? <CheckCircle className="w-3 h-3 text-emerald-400" />
                                        : s.status === 'pending'
                                        ? <Clock className="w-3 h-3 text-amber-400" />
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
