import React, { useState, useRef, useEffect } from 'react';
import {
    Mail, Clock, Zap, GitBranch, FileText, Timer,
    Shield, TrendingUp, Bell, Package, UserCheck,
    Database, Play, AlertTriangle, Settings, Trash2,
    CheckCircle, AlertCircle, RefreshCw,
} from 'lucide-react';
import type { WorkflowNodeData } from '../types/workflow';

interface WorkflowNodeProps {
    node:               WorkflowNodeData;
    isSelected:         boolean;
    isConnecting:       boolean;   // este nodo es el origen de una conexión activa
    canBeTarget:        boolean;   // hay una conexión activa y este puede ser destino
    onSelect:           () => void;
    onMove:             (nodeId: string, pos: { x: number; y: number }) => void;
    onDelete:           (nodeId: string) => void;
    onConnectionStart?: (nodeId: string) => void;
    onConnectionEnd?:   (nodeId: string) => void;
    onConfigure?:       (nodeId: string) => void;
}

const ICON_MAP: Record<string, React.ComponentType<any>> = {
    cron:         Clock,
    manual:       Play,
    webhook:      Zap,
    email:        Mail,
    decision:     GitBranch,
    log:          FileText,
    delay:        Timer,
    bcv:          TrendingUp,
    riskguard:    AlertTriangle,
    aml:          Shield,
    notificacion: Bell,
    inventario:   Package,
    aprobacion:   UserCheck,
    erp:          Database,
};

const TYPE_STYLES: Record<string, { border: string; header: string; dot: string }> = {
    trigger:   { border: 'border-green-300',  header: 'bg-green-50  text-green-800',  dot: 'bg-green-500'  },
    processor: { border: 'border-blue-300',   header: 'bg-blue-50   text-blue-800',   dot: 'bg-blue-500'   },
    output:    { border: 'border-orange-300', header: 'bg-orange-50 text-orange-800', dot: 'bg-orange-400' },
};

const TYPE_LABEL: Record<string, string> = {
    trigger: 'Trigger', processor: 'Proceso', output: 'Salida',
};

const STATUS_EL: Record<string, React.ReactNode> = {
    success: <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-3 h-3" />Completado</span>,
    error:   <span className="flex items-center gap-1 text-red-600"><AlertCircle className="w-3 h-3" />Error</span>,
    running: <span className="flex items-center gap-1 text-blue-600"><RefreshCw className="w-3 h-3 animate-spin" />Ejecutando</span>,
    idle:    <span className="text-gray-400">○ Inactivo</span>,
};

export function WorkflowNode({
    node, isSelected, isConnecting, canBeTarget,
    onSelect, onMove, onDelete, onConnectionStart, onConnectionEnd, onConfigure,
}: WorkflowNodeProps) {
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const nodeRef    = useRef<HTMLDivElement>(null);

    const styles = TYPE_STYLES[node.type] ?? TYPE_STYLES.processor;
    const Icon   = ICON_MAP[node.category] ?? Settings;

    // ── Drag ────────────────────────────────────────────────────────────────
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('[data-handle]')) return;
        if (!nodeRef.current) return;
        const rect = nodeRef.current.getBoundingClientRect();
        dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setIsDragging(true);
        onSelect();
        e.preventDefault();
        e.stopPropagation();
    };

    useEffect(() => {
        if (!isDragging) return;
        const onMove_ = (e: MouseEvent) => {
            const parent = nodeRef.current?.parentElement;
            if (!parent) return;
            const pr = parent.getBoundingClientRect();
            onMove(node.id, {
                x: Math.max(0, e.clientX - pr.left - dragOffset.current.x),
                y: Math.max(0, e.clientY - pr.top  - dragOffset.current.y),
            });
        };
        const onUp = () => setIsDragging(false);
        document.addEventListener('mousemove', onMove_);
        document.addEventListener('mouseup',   onUp);
        return () => {
            document.removeEventListener('mousemove', onMove_);
            document.removeEventListener('mouseup',   onUp);
        };
    }, [isDragging, node.id, onMove]);

    // ── Clic en nodo destino durante conexión ─────────────────────────────
    const handleNodeClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('[data-handle]')) return;
        if (canBeTarget) {
            e.stopPropagation();
            onConnectionEnd?.(node.id);
        } else {
            onSelect();
        }
    };

    // ── Borde visual según estado ─────────────────────────────────────────
    const borderClass = isConnecting
        ? 'border-indigo-500 ring-2 ring-indigo-300 shadow-indigo-100'
        : canBeTarget
        ? 'border-indigo-400 ring-2 ring-indigo-200 shadow-indigo-100 cursor-crosshair'
        : isSelected
        ? 'border-indigo-400 ring-2 ring-indigo-200'
        : `${styles.border} hover:shadow-md`;

    return (
        <div
            ref={nodeRef}
            className={`absolute w-52 bg-white rounded-xl border-2 shadow-md select-none transition-shadow ${borderClass} ${isDragging ? 'shadow-xl scale-105 z-20' : 'z-10'}`}
            style={{ left: node.position.x, top: node.position.y, cursor: canBeTarget ? 'crosshair' : isDragging ? 'grabbing' : 'grab' }}
            onMouseDown={handleMouseDown}
            onClick={handleNodeClick}
        >
            {/* Header */}
            <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-xl ${styles.header}`}>
                <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm font-semibold truncate">{node.title}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-1" data-handle="actions">
                    <button
                        onClick={e => { e.stopPropagation(); onConfigure?.(node.id); }}
                        className="p-1 rounded hover:bg-black/10 transition-colors"
                        title="Configurar"
                    >
                        <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={e => { e.stopPropagation(); onDelete(node.id); }}
                        className="p-1 rounded hover:bg-red-200 hover:text-red-700 transition-colors"
                        title="Eliminar"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="px-3 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        node.type === 'trigger'   ? 'bg-green-100  text-green-700'  :
                        node.type === 'processor' ? 'bg-blue-100   text-blue-700'   :
                                                    'bg-orange-100 text-orange-700'
                    }`}>
                        {TYPE_LABEL[node.type]}
                    </span>
                    <span className="text-[10px] text-gray-400">{node.category}</span>
                </div>

                {/* Config preview */}
                {node.config?.to && (
                    <p className="text-[11px] text-gray-500 truncate">→ {node.config.to}</p>
                )}
                {node.config?.cron && (
                    <p className="text-[11px] text-gray-500 font-mono">{node.config.cron}</p>
                )}
                {node.config?.message && (
                    <p className="text-[11px] text-gray-500 truncate italic">"{node.config.message}"</p>
                )}
                {node.config?.left && (
                    <p className="text-[11px] text-gray-500 font-mono truncate">
                        {node.config.left} {node.config.operator} {node.config.right}
                    </p>
                )}

                {/* Status */}
                <div className="mt-2 text-[11px]">
                    {STATUS_EL[node.status ?? 'idle']}
                </div>
            </div>

            {/* ── Handle salida (derecha) — solo para trigger y processor ── */}
            {node.type !== 'output' && (
                <div
                    data-handle="output"
                    className={`absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center cursor-pointer transition-transform hover:scale-125 ${styles.dot}`}
                    title="Clic para iniciar conexión"
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => {
                        e.stopPropagation();
                        onConnectionStart?.(node.id);
                    }}
                >
                    <span className="text-white text-[10px] font-bold leading-none">→</span>
                </div>
            )}

            {/* ── Handle entrada (izquierda) — solo para processor y output ── */}
            {node.type !== 'trigger' && (
                <div
                    data-handle="input"
                    className={`absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center transition-transform ${
                        canBeTarget ? 'bg-indigo-500 scale-125 cursor-crosshair' : 'bg-gray-300 cursor-default'
                    }`}
                    title={canBeTarget ? 'Clic para conectar aquí' : 'Entrada del nodo'}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => {
                        e.stopPropagation();
                        if (canBeTarget) onConnectionEnd?.(node.id);
                    }}
                />
            )}

            {/* Indicador "destino disponible" */}
            {canBeTarget && (
                <div className="absolute inset-0 rounded-xl bg-indigo-500/5 pointer-events-none" />
            )}
        </div>
    );
}
