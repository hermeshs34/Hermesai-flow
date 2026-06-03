import React, { useState } from 'react';
import {
    X, Play, Clock, Zap, Mail, GitBranch, FileText,
    Shield, Search, TrendingUp, Lock, Bell, Package,
    ShoppingCart, UserCheck, Database, ArrowUpRight,
    AlertTriangle, Timer, ChevronDown, ChevronRight,
    BarChart2, Activity, PieChart, BookOpen, Gauge, BrainCircuit,
} from 'lucide-react';

export interface NodeType {
    id:          string;
    type:        'trigger' | 'processor' | 'output';
    category:    string;
    title:       string;
    description: string;
    icon:        React.ComponentType<any>;
    color:       string;
}

interface NodePaletteProps {
    onDragStart: (nodeType: NodeType) => void;
    onClose:     () => void;
}

// ── Catálogo de nodos por industria ─────────────────────────────────────────

const CATALOG: { label: string; color: string; nodes: NodeType[] }[] = [
    {
        label: 'Universal',
        color: '#6366f1',
        nodes: [
            { id: 'manual-trigger',  type: 'trigger',   category: 'manual',   title: 'Inicio Manual',      description: 'Ejecutar flujo manualmente con un clic',  icon: Play,         color: '#22c55e' },
            { id: 'cron-trigger',    type: 'trigger',   category: 'cron',     title: 'Programado (Cron)',  description: 'Ejecutar en horario fijo (ej: 0 9 * * 1)', icon: Clock,        color: '#3b82f6' },
            { id: 'webhook-trigger', type: 'trigger',   category: 'webhook',  title: 'Webhook Entrante',   description: 'Recibir llamadas HTTP de sistemas externos',icon: Zap,          color: '#f59e0b' },
            { id: 'email-output',    type: 'output',    category: 'email',    title: 'Enviar Email',       description: 'Enviar correo vía Resend API',             icon: Mail,         color: '#ec4899' },
            { id: 'decision',        type: 'processor', category: 'decision', title: 'Decisión (Si/No)',   description: 'Bifurcar flujo según condición evaluada',  icon: GitBranch,    color: '#8b5cf6' },
            { id: 'agente-ia',       type: 'processor', category: 'agente',   title: 'Agente IA',          description: 'Claude analiza contexto y decide o genera texto', icon: BrainCircuit, color: '#7c3aed' },
            { id: 'delay',           type: 'processor', category: 'delay',    title: 'Espera',             description: 'Pausar N segundos antes del siguiente nodo',icon: Timer,        color: '#64748b' },
            { id: 'log-message',     type: 'output',    category: 'log',      title: 'Registrar Log',      description: 'Guardar mensaje en historial de ejecución',icon: FileText,     color: '#94a3b8' },
        ],
    },
    {
        label: 'Seguros & Reaseguros',
        color: '#0ea5e9',
        nodes: [
            { id: 'riskguard-siniestro',    type: 'trigger',   category: 'riskguard',   title: 'Alerta Siniestro',        description: 'Disparar cuando ingresa siniestro en RiskGuard',    icon: AlertTriangle, color: '#ef4444' },
            { id: 'verificar-poliza',        type: 'processor', category: 'riskguard',   title: 'Verificar Póliza',        description: 'Consultar cobertura vigente en SIRWeb',              icon: Search,        color: '#3b82f6' },
            { id: 'calcular-reserva',        type: 'processor', category: 'actuarial',   title: 'Calcular Reserva IBNR',   description: 'Calcular reserva técnica con método Chain Ladder',   icon: TrendingUp,    color: '#10b981' },
            { id: 'escalar-reaseguro',       type: 'processor', category: 'reaseguro',   title: 'Escalar Reaseguro',       description: 'Si monto > XL → notificar reasegurador',            icon: ArrowUpRight,  color: '#f59e0b' },
            { id: 'notificar-ajustador',     type: 'output',    category: 'notificacion', title: 'Notificar Ajustador',    description: 'Email + WhatsApp al ajustador asignado',             icon: Bell,          color: '#6366f1' },
            { id: 'reporte-sudeaseg',        type: 'output',    category: 'regulatorio',  title: 'Reporte SUDEASEG',       description: 'Generar informe regulatorio en formato SUDEASEG',    icon: FileText,      color: '#8b5cf6' },
            { id: 'score-fraude',            type: 'processor', category: 'fraude',       title: 'Score Fraude',           description: 'Calcular score de fraude con motor determinístico',  icon: Shield,        color: '#ef4444' },
        ],
    },
    {
        label: 'Banca & Finanzas',
        color: '#10b981',
        nodes: [
            { id: 'bcv-query',        type: 'processor', category: 'bcv',        title: 'Tasa BCV',              description: 'Obtener tasa de cambio oficial BCV del día',          icon: TrendingUp, color: '#f59e0b' },
            { id: 'aml-score',        type: 'processor', category: 'aml',        title: 'Score AML',             description: 'Calcular riesgo AML del cliente (PEP, OFAC, ONU)',    icon: Shield,     color: '#ef4444' },
            { id: 'verificar-ofac',   type: 'processor', category: 'aml',        title: 'Verificar OFAC/ONU',    description: 'Consultar listas restrictivas internacionales',        icon: Search,     color: '#dc2626' },
            { id: 'congelar-op',      type: 'output',    category: 'operacion',  title: 'Congelar Operación',    description: 'Bloquear transacción sospechosa y notificar',         icon: Lock,       color: '#7c3aed' },
            { id: 'reporte-sudeban',  type: 'output',    category: 'regulatorio',title: 'Reporte SUDEBAN',       description: 'Generar reporte regulatorio bancario mensual',        icon: FileText,   color: '#0ea5e9' },
            { id: 'alerta-umbral',    type: 'trigger',   category: 'umbral',     title: 'Alerta por Umbral',     description: 'Disparar cuando valor supera umbral configurado',     icon: AlertTriangle, color: '#f59e0b' },
        ],
    },
    {
        label: 'Gestión Empresarial',
        color: '#8b5cf6',
        nodes: [
            { id: 'indicadores-leer',    type: 'processor', category: 'indicadores',   title: 'Leer Indicadores',        description: 'Consultar KPIs del Sistema de Indicadores de Gestión',    icon: BarChart2,  color: '#6366f1' },
            { id: 'indicador-critico',   type: 'trigger',   category: 'indicadores',   title: 'Alerta KPI Crítico',      description: 'Disparar cuando hay indicadores en estado crítico/riesgo', icon: Activity,   color: '#ef4444' },
            { id: 'semaforo',            type: 'processor', category: 'semaforo',       title: 'Semáforo de Gestión',     description: 'Evaluar valor contra umbrales verde/amarillo/rojo',        icon: Gauge,      color: '#f59e0b' },
            { id: 'eeff-leer',           type: 'processor', category: 'eeff',           title: 'Datos EE.FF.',            description: 'Consultar indicadores del sistema Estados Financieros',    icon: PieChart,   color: '#10b981' },
            { id: 'reporte-gerencial',   type: 'output',    category: 'reporte',        title: 'Reporte Gerencial',       description: 'Enviar informe ejecutivo HTML con KPIs y semáforo',        icon: BookOpen,   color: '#8b5cf6' },
        ],
    },
    {
        label: 'Manufactura & Textil',
        color: '#f59e0b',
        nodes: [
            { id: 'check-stock',        type: 'trigger',   category: 'inventario',  title: 'Alerta de Stock',       description: 'Cuando stock < umbral mínimo configurado',           icon: Package,     color: '#ef4444' },
            { id: 'generar-oc',         type: 'output',    category: 'compras',     title: 'Orden de Compra',       description: 'Generar OC automática al proveedor aprobado',        icon: ShoppingCart,color: '#10b981' },
            { id: 'solicitar-aprob',    type: 'processor', category: 'aprobacion',  title: 'Solicitar Aprobación',  description: 'Pausar flujo hasta que gerencia apruebe/rechace',    icon: UserCheck,   color: '#3b82f6' },
            { id: 'actualizar-erp',     type: 'output',    category: 'erp',         title: 'Actualizar ERP/WMS',    description: 'Sincronizar datos con sistema ERP o WMS',            icon: Database,    color: '#8b5cf6' },
            { id: 'notif-produccion',   type: 'output',    category: 'notificacion',title: 'Notificar Producción',  description: 'Alerta al jefe de planta con detalle de acción',     icon: Bell,        color: '#f59e0b' },
            { id: 'control-calidad',    type: 'processor', category: 'calidad',     title: 'Control de Calidad',    description: 'Verificar parámetros de calidad contra estándar',   icon: Shield,      color: '#22c55e' },
        ],
    },
];

const TYPE_LABEL: Record<string, string> = {
    trigger:   'Trigger',
    processor: 'Proceso',
    output:    'Salida',
};

const TYPE_BG: Record<string, string> = {
    trigger:   'bg-green-100 text-green-700',
    processor: 'bg-blue-100 text-blue-700',
    output:    'bg-purple-100 text-purple-700',
};

export function NodePalette({ onDragStart, onClose }: NodePaletteProps) {
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        Universal: true,
        'Gestión Empresarial': false,
        'Seguros & Reaseguros': false,
        'Banca & Finanzas': false,
        'Manufactura & Textil': false,
    });
    const [search, setSearch] = useState('');

    const toggle = (label: string) =>
        setOpenSections(prev => ({ ...prev, [label]: !prev[label] }));

    const filtered = CATALOG.map(section => ({
        ...section,
        nodes: search
            ? section.nodes.filter(n =>
                  n.title.toLowerCase().includes(search.toLowerCase()) ||
                  n.description.toLowerCase().includes(search.toLowerCase())
              )
            : section.nodes,
    })).filter(s => s.nodes.length > 0);

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900 text-sm">Biblioteca de Nodos</h2>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-gray-100">
                <input
                    type="text"
                    placeholder="Buscar nodo..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
            </div>

            {/* Catalog */}
            <div className="flex-1 overflow-y-auto">
                {filtered.map(section => (
                    <div key={section.label}>
                        {/* Section header */}
                        <button
                            onClick={() => toggle(section.label)}
                            className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: section.color }}
                                />
                                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                    {section.label}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs text-gray-400">{section.nodes.length}</span>
                                {(openSections[section.label] || !!search)
                                    ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                    : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                            </div>
                        </button>

                        {/* Nodes */}
                        {(openSections[section.label] || !!search) && (
                            <div className="p-2 space-y-1.5">
                                {section.nodes.map(node => {
                                    const Icon = node.icon;
                                    return (
                                        <div
                                            key={node.id}
                                            draggable
                                            onDragStart={() => onDragStart(node)}
                                            className="flex items-start gap-3 p-2.5 rounded-lg border border-gray-100 bg-white hover:border-indigo-200 hover:bg-indigo-50 cursor-grab active:cursor-grabbing transition-all group"
                                        >
                                            <div
                                                className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                                                style={{ backgroundColor: `${node.color}18` }}
                                            >
                                                <Icon
                                                    className="w-4 h-4"
                                                    style={{ color: node.color }}
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                    <span className="text-xs font-semibold text-gray-800 truncate">
                                                        {node.title}
                                                    </span>
                                                    <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TYPE_BG[node.type]}`}>
                                                        {TYPE_LABEL[node.type]}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-gray-500 leading-tight line-clamp-2">
                                                    {node.description}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Footer hint */}
            <div className="p-3 border-t border-gray-100 bg-gray-50">
                <p className="text-[11px] text-gray-400 text-center">
                    Arrastra un nodo al canvas para agregarlo al flujo
                </p>
            </div>
        </div>
    );
}
