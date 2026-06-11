import React, { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { WorkflowNode }    from './WorkflowNode';
import { NodePalette }       from './NodePalette';
import { ConnectionLine }    from './ConnectionLine';
import NodeConfigPanel       from './NodeConfigPanel';
import { DesignAssistant }   from './DesignAssistant';
import { WorkflowService } from '../services/workflow.service';
import { GovernanceService } from '../services/governance.service';
import { supabase }        from '../core/supabase';
import { authService }     from '../core/auth.service';
import type { WorkflowNodeData, WorkflowConnection, Workflow } from '../types/workflow';
import type { NodeType }   from './NodePalette';
import type { User }       from '../core/user.types';
import {
    Play, Trash2, Plus, ChevronDown,
    CheckCircle, Loader2, PanelLeftOpen, AlertTriangle, X, BrainCircuit,
    ShieldCheck, XCircle, Zap, Undo2, Redo2,
} from 'lucide-react';

// ── Checklist pre-ejecución ───────────────────────────────────────────────────
interface CheckItem {
    id:      string;
    label:   string;
    detail?: string;
    status:  'ok' | 'warn' | 'error';
}

function buildChecklist(
    nodes: WorkflowNodeData[],
    connections: WorkflowConnection[],
    workflowName: string,
    saved: boolean,
): CheckItem[] {
    const items: CheckItem[] = [];

    // 1. Flujo guardado
    items.push({
        id: 'saved', label: 'Flujo guardado',
        detail: saved ? 'Todos los cambios están guardados' : 'Hay cambios sin guardar — espera al auto-guardado',
        status: saved ? 'ok' : 'warn',
    });

    // 2. Nombre definido
    items.push({
        id: 'name', label: 'Nombre del flujo',
        detail: workflowName.trim() ? `"${workflowName}"` : 'El flujo no tiene nombre',
        status: workflowName.trim() ? 'ok' : 'warn',
    });

    // 3. Al menos un nodo trigger
    const triggers = nodes.filter(n => n.type === 'trigger');
    items.push({
        id: 'trigger', label: 'Nodo de inicio (trigger)',
        detail: triggers.length > 0
            ? `${triggers.map(t => t.title).join(', ')}`
            : 'Sin trigger — el flujo no sabe cuándo arrancar',
        status: triggers.length > 0 ? 'ok' : 'error',
    });

    // 4. Al menos un nodo de salida
    const outputs = nodes.filter(n => n.type === 'output');
    items.push({
        id: 'output', label: 'Nodo de salida',
        detail: outputs.length > 0
            ? `${outputs.map(o => o.title).join(', ')}`
            : 'Sin salida — el flujo no produce resultado',
        status: outputs.length > 0 ? 'ok' : 'warn',
    });

    // 5. Nodos conectados (ninguno huérfano)
    if (nodes.length > 1) {
        const connectedIds = new Set<string>();
        connections.forEach(c => { connectedIds.add(c.sourceId); connectedIds.add(c.targetId); });
        const orphans = nodes.filter(n => !connectedIds.has(n.id));
        items.push({
            id: 'connections', label: 'Nodos conectados',
            detail: orphans.length === 0
                ? `${connections.length} conexión${connections.length !== 1 ? 'es' : ''} correctas`
                : `${orphans.length} nodo${orphans.length !== 1 ? 's' : ''} sin conectar: ${orphans.map(o => `"${o.title}"`).join(', ')}`,
            status: orphans.length === 0 ? 'ok' : 'warn',
        });
    }

    // 6. Campos requeridos (email to, aprobador, etc.)
    const missing = getMissingFieldsChecklist(nodes);
    items.push({
        id: 'fields', label: 'Campos obligatorios',
        detail: missing.length === 0
            ? 'Todos los campos requeridos están completos'
            : `Faltan: ${missing.join(' · ')}`,
        status: missing.length === 0 ? 'ok' : 'error',
    });

    return items;
}

function getMissingFieldsChecklist(nodes: WorkflowNodeData[]): string[] {
    const REQUIRED: Record<string, { field: string; label: string }[]> = {
        email:      [{ field: 'to',       label: 'Destinatario email'   }],
        reporte:    [{ field: 'to',       label: 'Destinatario reporte' }],
        aprobacion: [{ field: 'approver', label: 'Aprobador'            }],
        eeff:       [{ field: 'company',  label: 'Empresa EE.FF.'       }],
    };
    const missing: string[] = [];
    for (const node of nodes) {
        for (const req of REQUIRED[node.category] ?? []) {
            if (!String(node.config?.[req.field] ?? '').trim())
                missing.push(`"${node.title}" → ${req.label}`);
        }
    }
    return missing;
}

interface ChecklistModalProps {
    workflowName: string;
    items:        CheckItem[];
    onConfirm:    () => void;
    onCancel:     () => void;
    executing:    boolean;
}

function ChecklistModal({ workflowName, items, onConfirm, onCancel, executing }: ChecklistModalProps) {
    const hasError = items.some(i => i.status === 'error');
    const hasWarn  = items.some(i => i.status === 'warn');
    const allOk    = !hasError && !hasWarn;

    const headerColor = hasError
        ? 'from-red-600 to-rose-600'
        : hasWarn
        ? 'from-amber-500 to-orange-500'
        : 'from-emerald-600 to-teal-600';

    const headerIcon = hasError ? XCircle : hasWarn ? AlertTriangle : ShieldCheck;
    const HeaderIcon = headerIcon;

    const headerTitle = hasError
        ? 'Problemas críticos detectados'
        : hasWarn
        ? 'Advertencias — revisa antes de ejecutar'
        : '¡Todo listo para ejecutar!';

    const ICON: Record<CheckItem['status'], React.ReactNode> = {
        ok:    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
        warn:  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />,
        error: <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />,
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

                {/* Header con color de estado */}
                <div className={`bg-gradient-to-r ${headerColor} px-6 py-5 text-white`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <HeaderIcon className="w-6 h-6 flex-shrink-0" />
                            <div>
                                <p className="font-bold text-base leading-tight">{headerTitle}</p>
                                <p className="text-white/80 text-xs mt-0.5 truncate">Flujo: {workflowName}</p>
                            </div>
                        </div>
                        <button onClick={onCancel} className="text-white/70 hover:text-white transition-colors flex-shrink-0">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Checklist */}
                <div className="px-5 py-4 space-y-2.5 max-h-72 overflow-y-auto">
                    {items.map(item => (
                        <div key={item.id} className={`flex items-start gap-3 p-3 rounded-xl border ${
                            item.status === 'error' ? 'bg-red-50 border-red-100' :
                            item.status === 'warn'  ? 'bg-amber-50 border-amber-100' :
                                                      'bg-emerald-50 border-emerald-100'
                        }`}>
                            {ICON[item.status]}
                            <div className="min-w-0">
                                <p className={`text-sm font-semibold ${
                                    item.status === 'error' ? 'text-red-800' :
                                    item.status === 'warn'  ? 'text-amber-800' : 'text-emerald-800'
                                }`}>{item.label}</p>
                                {item.detail && (
                                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.detail}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Resumen + acciones */}
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/60">
                    <div className="flex items-center justify-between gap-2 mb-3 text-xs text-gray-500">
                        <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                <CheckCircle className="w-3 h-3" /> {items.filter(i => i.status === 'ok').length} OK
                            </span>
                            {hasWarn && (
                                <span className="flex items-center gap-1 text-amber-600 font-medium">
                                    <AlertTriangle className="w-3 h-3" /> {items.filter(i => i.status === 'warn').length} advertencia{items.filter(i => i.status === 'warn').length !== 1 ? 's' : ''}
                                </span>
                            )}
                            {hasError && (
                                <span className="flex items-center gap-1 text-red-600 font-medium">
                                    <XCircle className="w-3 h-3" /> {items.filter(i => i.status === 'error').length} error{items.filter(i => i.status === 'error').length !== 1 ? 'es' : ''}
                                </span>
                            )}
                        </div>
                        {hasError && <span className="text-red-500 text-[10px]">Corrige los errores antes de ejecutar</span>}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onCancel}
                            className="flex-1 px-4 py-2 text-sm font-semibold border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors">
                            Revisar flujo
                        </button>
                        <button
                            onClick={onConfirm}
                            disabled={hasError || executing}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white transition-colors disabled:opacity-40 ${
                                allOk ? 'bg-emerald-600 hover:bg-emerald-700' :
                                hasWarn ? 'bg-amber-500 hover:bg-amber-600' :
                                'bg-gray-300 cursor-not-allowed'
                            }`}
                        >
                            {executing
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Ejecutando...</>
                                : <><Zap className="w-4 h-4" /> {hasWarn ? 'Ejecutar de todas formas' : 'Ejecutar ahora'}</>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Campos requeridos por categoría de nodo — vacíos = plantilla incompleta
const REQUIRED_FIELDS: Record<string, { field: string; label: string }[]> = {
    email:      [{ field: 'to',       label: 'Destinatario de email'  }],
    reporte:    [{ field: 'to',       label: 'Destinatario del reporte'}],
    aprobacion: [{ field: 'approver', label: 'Aprobador'               }],
    eeff:       [{ field: 'company',  label: 'Empresa EE.FF.'          }],
};

function getMissingFields(nodes: WorkflowNodeData[]): string[] {
    const missing: string[] = [];
    for (const node of nodes) {
        const reqs = REQUIRED_FIELDS[node.category] ?? [];
        for (const req of reqs) {
            const val = node.config?.[req.field];
            if (!val || String(val).trim() === '') {
                missing.push(`"${node.title}" → ${req.label}`);
            }
        }
    }
    return missing;
}

interface WorkflowCanvasProps {
    currentUser: User;
}

export function WorkflowCanvas({ currentUser }: WorkflowCanvasProps) {

    // ── Workflows ──────────────────────────────────────────────────────────
    const [workflows,          setWorkflows]         = useState<Workflow[]>([]);
    const [activeWorkflowId,   setActiveWorkflowId]  = useState<string | null>(null);
    const [workflowName,       setWorkflowName]      = useState('');
    const [loadingWorkflows,   setLoadingWorkflows]  = useState(true);
    const [showWfDropdown,     setShowWfDropdown]    = useState(false);
    const [creatingWorkflow,   setCreatingWorkflow]  = useState(false);
    const [newWfName,          setNewWfName]         = useState('');
    const [wfSearch,           setWfSearch]          = useState('');
    const [wfDateFilter,       setWfDateFilter]      = useState<'all' | '7d' | '30d' | 'never'>('all');
    const [showChecklist,      setShowChecklist]     = useState(false);
    const [checkItems,         setCheckItems]        = useState<CheckItem[]>([]);

    // ── Canvas ─────────────────────────────────────────────────────────────
    const [nodes,              setNodes]             = useState<WorkflowNodeData[]>([]);
    const [connections,        setConnections]       = useState<WorkflowConnection[]>([]);

    // ── Undo / Redo ────────────────────────────────────────────────────────
    type Snapshot = { nodes: WorkflowNodeData[]; connections: WorkflowConnection[] };
    const undoStack = useRef<Snapshot[]>([]);
    const redoStack = useRef<Snapshot[]>([]);
    const nodesRef  = useRef(nodes);
    const connsRef  = useRef(connections);
    useEffect(() => { nodesRef.current = nodes; }, [nodes]);
    useEffect(() => { connsRef.current = connections; }, [connections]);

    const pushHistory = useCallback(() => {
        undoStack.current.push({ nodes: nodesRef.current, connections: connsRef.current });
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = [];
    }, []);

    const handleUndo = useCallback(() => {
        const snap = undoStack.current.pop();
        if (!snap) return;
        redoStack.current.push({ nodes: nodesRef.current, connections: connsRef.current });
        setNodes(snap.nodes);
        setConnections(snap.connections);
    }, []);

    const handleRedo = useCallback(() => {
        const snap = redoStack.current.pop();
        if (!snap) return;
        undoStack.current.push({ nodes: nodesRef.current, connections: connsRef.current });
        setNodes(snap.nodes);
        setConnections(snap.connections);
    }, []);
    const [selectedNode,       setSelectedNode]      = useState<string | null>(null);
    const [draggedNodeType,    setDraggedNodeType]   = useState<NodeType | null>(null);
    const [showPalette,        setShowPalette]       = useState(true);
    const [connectingFrom,     setConnectingFrom]    = useState<string | null>(null);
    const [configPanelOpen,    setConfigPanelOpen]   = useState(false);
    const [nodeToConfig,       setNodeToConfig]      = useState<WorkflowNodeData | null>(null);

    // ── Estado de operaciones ──────────────────────────────────────────────
    const [saving,          setSaving]         = useState(false);
    const [executing,       setExecuting]      = useState(false);
    const [showAssistant,   setShowAssistant]  = useState(false);
    const [bannerDismissed, setBannerDismissed]= useState(false);
    const canvasRef               = useRef<HTMLDivElement>(null);
    const saveTimer               = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Cargar lista de workflows ──────────────────────────────────────────
    useEffect(() => {
        WorkflowService.getWorkflows(currentUser.organizationId)
            .then(wfs => {
                setWorkflows(wfs);
                if (wfs.length === 0) return;

                // Si viene del Dashboard (plantilla creada), abrir ese flujo
                const pendingId = localStorage.getItem('hermesai_open_workflow');
                if (pendingId) {
                    localStorage.removeItem('hermesai_open_workflow');
                    const target = wfs.find(w => w.id === pendingId);
                    if (target) { selectWorkflow(target); return; }
                }
                selectWorkflow(wfs[0]);
            })
            .catch(() => toast.error('No se pudo cargar los flujos'))
            .finally(() => setLoadingWorkflows(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser.organizationId]);

    // ── Seleccionar flujo y cargar sus nodos ───────────────────────────────
    const selectWorkflow = useCallback(async (wf: Workflow) => {
        setActiveWorkflowId(wf.id);
        setWorkflowName(wf.name);
        setShowWfDropdown(false);
        setBannerDismissed(false); // mostrar banner al abrir cada flujo nuevo
        try {
            const full = await WorkflowService.getWorkflow(wf.id, currentUser.organizationId);
            setNodes(full?.nodes ?? []);
            setConnections(full?.connections ?? []);
        } catch {
            toast.error('Error cargando el flujo');
        }
    }, [currentUser.organizationId]);

    // ── Undo / Redo — atajo de teclado ────────────────────────────────────
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
            if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
            if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); handleRedo(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleUndo, handleRedo]);

    // ── Auto-guardar con debounce (1.5s) ──────────────────────────────────
    useEffect(() => {
        if (!activeWorkflowId) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            setSaving(true);
            try {
                await WorkflowService.saveNodes(activeWorkflowId, currentUser.organizationId, nodes);
                await WorkflowService.saveConnections(activeWorkflowId, connections);
            } catch {
                toast.error('Error guardando flujo');
            } finally {
                setSaving(false);
            }
        }, 1500);
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    }, [nodes, connections, activeWorkflowId]);

    // ── Crear nuevo workflow ───────────────────────────────────────────────
    const handleCreateWorkflow = async () => {
        const name = newWfName.trim() || `Flujo ${new Date().toLocaleDateString('es-VE')}`;
        setCreatingWorkflow(true);
        try {
            const wf = await WorkflowService.createWorkflow(
                currentUser.organizationId,
                currentUser.id,
                { name, description: '' }
            );
            setWorkflows(prev => [wf, ...prev]);
            setNodes([]);
            setConnections([]);
            setActiveWorkflowId(wf.id);
            setWorkflowName(wf.name);
            setNewWfName('');
            setShowWfDropdown(false);
            GovernanceService.log(currentUser, 'crear', 'workflow', { entidadId: wf.id, descripcion: `Flujo "${wf.name}" creado` });
            toast.success(`Flujo "${wf.name}" creado`);
        } catch (err: any) {
            toast.error(`No se pudo crear el flujo: ${err.message}`);
        } finally {
            setCreatingWorkflow(false);
        }
    };

    // ── Abrir checklist pre-ejecución ─────────────────────────────────────
    const handleExecute = () => {
        if (!activeWorkflowId) { toast.error('Selecciona un flujo primero'); return; }
        if (nodes.length === 0) { toast.error('Agrega al menos un nodo al flujo'); return; }
        const items = buildChecklist(nodes, connections, workflowName, !saving);
        setCheckItems(items);
        setShowChecklist(true);
    };

    // ── Ejecutar flujo tras confirmar checklist ────────────────────────────
    const handleConfirmExecute = async () => {
        setShowChecklist(false);
        setExecuting(true);
        const toastId = toast.loading('Ejecutando flujo...');
        try {
            const { data, error } = await supabase.functions.invoke('execute-workflow', {
                body: {
                    workflowId:     activeWorkflowId,
                    organizationId: currentUser.organizationId,
                    triggeredBy:    currentUser.email ?? 'manual',
                },
            });
            if (error) throw error;
            if (data?.paused) {
                toast.success('⏸ Flujo pausado — tarea enviada a la Bandeja de Aprobación', { id: toastId, duration: 6000 });
            } else if (data?.success) {
                GovernanceService.log(currentUser, 'ejecutar', 'workflow', { entidadId: activeWorkflowId ?? undefined, descripcion: `Ejecutado "${workflowName}" — ${data.logs} pasos en ${data.duration}ms` });
                toast.success(`Flujo completado — ${data.logs} pasos en ${data.duration}ms`, { id: toastId });
            } else {
                toast.error(`Error: ${data?.error ?? 'fallo desconocido'}`, { id: toastId });
            }
        } catch (err: any) {
            toast.error(`No se pudo ejecutar: ${err.message}`, { id: toastId });
        } finally {
            setExecuting(false);
        }
    };

    // ── Limpiar canvas ─────────────────────────────────────────────────────
    const handleClearCanvas = async () => {
        if (!activeWorkflowId) return;
        if (!confirm('¿Limpiar todos los nodos del canvas?')) return;
        pushHistory();
        setNodes([]);
        setConnections([]);
    };

    // ── Drag & drop desde paleta ───────────────────────────────────────────
    const handleNodeDragStart  = useCallback((nodeType: NodeType) => setDraggedNodeType(nodeType), []);
    const handleCanvasDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }, []);

    const handleCanvasDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (!draggedNodeType || !canvasRef.current) return;
        const rect     = canvasRef.current.getBoundingClientRect();
        const position = { x: e.clientX - rect.left - 96, y: e.clientY - rect.top - 50 };
        const newNode: WorkflowNodeData = {
            id:          crypto.randomUUID(),
            type:        draggedNodeType.type,
            category:    draggedNodeType.category,
            title:       draggedNodeType.title,
            position,
            config:      {},
            connections: [],
            status:      'idle',
        };
        pushHistory();
        setNodes(prev => [...prev, newNode]);
        setDraggedNodeType(null);
    }, [draggedNodeType, pushHistory]);

    // ── Acciones de nodos ─────────────────────────────────────────────────
    const handleNodeMove   = useCallback((nodeId: string, pos: { x: number; y: number }) =>
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, position: pos } : n)), []);

    const handleNodeSelect = useCallback((nodeId: string) => setSelectedNode(nodeId), []);

    const handleNodeDelete = useCallback((nodeId: string) => {
        pushHistory();
        setNodes(prev => prev.filter(n => n.id !== nodeId));
        setConnections(prev => prev.filter(c => c.sourceId !== nodeId && c.targetId !== nodeId));
        if (selectedNode === nodeId) setSelectedNode(null);
    }, [selectedNode, pushHistory]);

    const handleDeleteConnection = useCallback((connId: string) => {
        pushHistory();
        setConnections(prev => prev.filter(c => c.id !== connId));
    }, [pushHistory]);

    const handleNodeMoveStart = useCallback(() => pushHistory(), [pushHistory]);

    const handleConnectionStart = useCallback((nodeId: string) => setConnectingFrom(nodeId), []);

    const handleConnectionEnd = useCallback((nodeId: string) => {
        if (connectingFrom && connectingFrom !== nodeId) {
            const src = nodes.find(n => n.id === connectingFrom);
            const tgt = nodes.find(n => n.id === nodeId);
            if (src && tgt && src.type !== 'output' && tgt.type !== 'trigger') {
                pushHistory();
                setConnections(prev => {
                    const exists = prev.some(c => c.sourceId === connectingFrom && c.targetId === nodeId);
                    if (exists) return prev;

                    // Nodo decisión: máx 2 salidas, primera = SI (true), segunda = NO (false)
                    if (src.category === 'decision') {
                        const existing = prev.filter(c => c.sourceId === connectingFrom);
                        if (existing.length >= 2) {
                            toast.error('Un nodo Decisión solo puede tener 2 salidas: SI y NO');
                            return prev;
                        }
                        const branch = existing.length === 0 ? 'true' : 'false';
                        toast.info(branch === 'true' ? '✅ Rama SI conectada' : '❌ Rama NO conectada');
                        return [...prev, { id: crypto.randomUUID(), sourceId: connectingFrom, targetId: nodeId, branch: branch as 'true' | 'false' }];
                    }

                    return [...prev, { id: crypto.randomUUID(), sourceId: connectingFrom, targetId: nodeId }];
                });
            }
        }
        setConnectingFrom(null);
    }, [connectingFrom, nodes]);

    const [prevNodeToConfig, setPrevNodeToConfig] = useState<WorkflowNodeData | null>(null);

    const handleConfigureNode = useCallback((nodeId: string) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;
        // Detectar nodo anterior — buscar conexión cuyo target es este nodo
        const incomingConn = connections.find(c => c.targetId === nodeId);
        const prevNode = incomingConn ? nodes.find(n => n.id === incomingConn.sourceId) ?? null : null;
        setPrevNodeToConfig(prevNode);
        setNodeToConfig(node);
        setConfigPanelOpen(true);
    }, [nodes, connections]);

    const handleToggleBranch = useCallback((connId: string) => {
        setConnections(prev => prev.map(c => {
            if (c.id !== connId) return c;
            // Ciclo: null → 'true' → 'false' → 'true' ...
            const next = c.branch == null ? 'true' : c.branch === 'true' ? 'false' : 'true';
            toast.info(next === 'true' ? '✅ Rama SI' : '❌ Rama NO');
            return { ...c, branch: next as 'true' | 'false' };
        }));
    }, []);

    const handleSaveNodeConfig = useCallback((nodeId: string, config: any) => {
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config } : n));
        setConfigPanelOpen(false);
        setNodeToConfig(null);
    }, []);

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div className="h-full flex">

            {/* Paleta de nodos */}
            {showPalette && (
                <div className="w-72 border-r border-gray-200 bg-gray-50 flex-shrink-0">
                    <NodePalette onDragStart={handleNodeDragStart} onClose={() => setShowPalette(false)} />
                </div>
            )}

            <div className="flex-1 flex flex-col min-w-0">

                {/* ── Toolbar ─────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white gap-3">

                    <div className="flex items-center gap-2">
                        {!showPalette && (
                            <button
                                onClick={() => setShowPalette(true)}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                                title="Mostrar paleta"
                            >
                                <PanelLeftOpen className="w-4 h-4" />
                            </button>
                        )}

                        {/* Selector de workflow */}
                        <div className="relative">
                            <button
                                onClick={() => setShowWfDropdown(v => !v)}
                                className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg hover:border-gray-300 bg-white text-sm font-medium text-gray-700 min-w-[200px] max-w-[280px]"
                            >
                                {loadingWorkflows ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                                ) : (
                                    <>
                                        <span className="truncate flex-1 text-left">
                                            {workflowName || 'Seleccionar flujo...'}
                                        </span>
                                        <ChevronDown className="w-4 h-4 flex-shrink-0 text-gray-400" />
                                    </>
                                )}
                            </button>

                            {showWfDropdown && (
                                <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50">
                                    {/* Crear nuevo */}
                                    {authService.hasPermission(currentUser, 'manage_workflows') && (
                                    <div className="p-2 border-b border-gray-100">
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="Nombre del flujo..."
                                                value={newWfName}
                                                onChange={e => setNewWfName(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleCreateWorkflow()}
                                                className="flex-1 text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                                autoFocus
                                            />
                                            <button
                                                onClick={handleCreateWorkflow}
                                                disabled={creatingWorkflow}
                                                className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                                            >
                                                {creatingWorkflow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                                Nuevo
                                            </button>
                                        </div>
                                    </div>
                                    )}

                                    {/* Búsqueda + filtro fecha */}
                                    <div className="p-2 border-b border-gray-100 space-y-1.5">
                                        <input
                                            type="text"
                                            placeholder="Buscar flujo..."
                                            value={wfSearch}
                                            onChange={e => setWfSearch(e.target.value)}
                                            className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                        />
                                        <div className="flex gap-1">
                                            {(['all', '7d', '30d', 'never'] as const).map(f => (
                                                <button
                                                    key={f}
                                                    onClick={() => setWfDateFilter(f)}
                                                    className={`flex-1 text-[11px] py-1 rounded-md font-medium transition-colors ${
                                                        wfDateFilter === f
                                                            ? 'bg-indigo-600 text-white'
                                                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                                    }`}
                                                >
                                                    {f === 'all' ? 'Todos' : f === 'never' ? 'Sin ejec.' : `Últ. ${f}`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Lista filtrada */}
                                    <div className="max-h-64 overflow-y-auto">
                                        {(() => {
                                            const now = Date.now();
                                            const filtered = workflows.filter(wf => {
                                                const nameOk = wf.name.toLowerCase().includes(wfSearch.toLowerCase());
                                                if (!nameOk) return false;
                                                if (wfDateFilter === 'all') return true;
                                                if (wfDateFilter === 'never') return !wf.lastRun;
                                                const cutoff = wfDateFilter === '7d' ? 7 : 30;
                                                if (!wf.lastRun) return false;
                                                return (now - new Date(wf.lastRun).getTime()) <= cutoff * 86400000;
                                            });
                                            if (filtered.length === 0) return (
                                                <p className="text-xs text-gray-400 text-center py-4">Sin resultados</p>
                                            );
                                            return filtered.map(wf => (
                                                <div key={wf.id} className={`group flex items-center border-b border-gray-50 last:border-0 ${wf.id === activeWorkflowId ? 'bg-indigo-50' : 'hover:bg-gray-50'} transition-colors`}>
                                                    <button
                                                        onClick={() => selectWorkflow(wf)}
                                                        className={`flex-1 text-left px-3 py-2.5 text-sm min-w-0 ${wf.id === activeWorkflowId ? 'text-indigo-700' : 'text-gray-700'}`}
                                                    >
                                                        <div className="font-medium truncate">{wf.name}</div>
                                                        <div className="flex items-center justify-between mt-0.5">
                                                            <span className="text-xs text-gray-400">{wf.executionCount ?? 0} ejecuciones</span>
                                                            <span className="text-xs text-gray-400">
                                                                {wf.lastRun ? `Últ. ${new Date(wf.lastRun).toLocaleDateString('es-VE')}` : 'Sin ejecuciones'}
                                                            </span>
                                                        </div>
                                                    </button>
                                                    {(authService.hasPermission(currentUser, 'manage_workflows')) && (
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                if (!confirm(`¿Eliminar el flujo "${wf.name}"? Esta acción no se puede deshacer.`)) return;
                                                                try {
                                                                    await WorkflowService.deleteWorkflow(wf.id, currentUser.organizationId);
                                                                    setWorkflows(prev => prev.filter(w => w.id !== wf.id));
                                                                    if (activeWorkflowId === wf.id) {
                                                                        setActiveWorkflowId(null);
                                                                        setWorkflowName('');
                                                                        setNodes([]);
                                                                        setConnections([]);
                                                                    }
                                                                    toast.success(`Flujo "${wf.name}" eliminado`);
                                                                } catch {
                                                                    toast.error('No se pudo eliminar el flujo');
                                                                }
                                                            }}
                                                            title="Eliminar flujo"
                                                            className="opacity-0 group-hover:opacity-100 p-2 mr-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center gap-2">
                        {saving && (
                            <span className="flex items-center gap-1 text-xs text-gray-400">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando...
                            </span>
                        )}
                        {!saving && activeWorkflowId && nodes.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-green-600">
                                <CheckCircle className="w-3.5 h-3.5" /> Guardado
                            </span>
                        )}

                        <button
                            onClick={handleClearCanvas}
                            disabled={!activeWorkflowId}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 disabled:opacity-40 transition-colors"
                        >
                            <Trash2 className="w-4 h-4" />
                            <span>Limpiar</span>
                        </button>

                        <div className="flex items-center gap-1 border border-gray-200 rounded-lg bg-white px-1">
                            <button
                                onClick={handleUndo}
                                disabled={undoStack.current.length === 0}
                                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-600 transition-colors"
                                title="Deshacer (Ctrl+Z)"
                            >
                                <Undo2 className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleRedo}
                                disabled={redoStack.current.length === 0}
                                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-600 transition-colors"
                                title="Rehacer (Ctrl+Y)"
                            >
                                <Redo2 className="w-4 h-4" />
                            </button>
                        </div>

                        <button
                            onClick={() => setShowAssistant(v => !v)}
                            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                                showAssistant
                                    ? 'bg-violet-600 text-white'
                                    : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                            }`}
                            title="Asistente de Diseño IA"
                        >
                            <BrainCircuit className="w-4 h-4" />
                            Asistente
                        </button>

                        <button
                            onClick={handleExecute}
                            disabled={!activeWorkflowId || executing}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors font-semibold"
                        >
                            {executing
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Play className="w-4 h-4" />}
                            {executing ? 'Ejecutando...' : 'Ejecutar'}
                        </button>
                    </div>
                </div>

                {/* ── Banner de validación de plantilla ───────────────── */}
                {!bannerDismissed && (() => {
                    const missing = getMissingFields(nodes);
                    if (missing.length === 0) return null;
                    return (
                        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200 text-amber-800">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold">Plantilla incompleta — completa estos campos antes de ejecutar:</p>
                                <p className="text-[11px] mt-0.5 text-amber-700">{missing.join(' · ')}</p>
                            </div>
                            <button onClick={() => setBannerDismissed(true)} className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })()}

                {/* ── Canvas ──────────────────────────────────────────── */}
                {!activeWorkflowId && !loadingWorkflows ? (
                    <div className="flex-1 flex items-center justify-center bg-gray-50">
                        <div className="text-center">
                            <div className="text-5xl mb-4">⚡</div>
                            <h3 className="text-lg font-semibold text-gray-700 mb-2">Sin flujo seleccionado</h3>
                            <p className="text-sm text-gray-400 mb-4">
                                Crea un nuevo flujo o selecciona uno existente desde el selector de arriba
                            </p>
                            <button
                                onClick={() => setShowWfDropdown(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-semibold mx-auto"
                            >
                                <Plus className="w-4 h-4" /> Crear primer flujo
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        ref={canvasRef}
                        className="flex-1 relative overflow-hidden"
                        style={{
                            backgroundColor: '#f8fafc',
                            backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
                            backgroundSize: '24px 24px',
                        }}
                        onDragOver={handleCanvasDragOver}
                        onDrop={handleCanvasDrop}
                        onClick={() => { setSelectedNode(null); setShowWfDropdown(false); }}
                    >
                        {connections.map(conn => (
                            <ConnectionLine
                                key={conn.id}
                                connection={conn}
                                nodes={nodes}
                                onDelete={handleDeleteConnection}
                                onToggleBranch={handleToggleBranch}
                            />
                        ))}

                        {nodes.map(node => (
                            <WorkflowNode
                                key={node.id}
                                node={node}
                                isSelected={selectedNode === node.id}
                                isConnecting={connectingFrom === node.id}
                                canBeTarget={!!connectingFrom && connectingFrom !== node.id && node.type !== 'trigger'}
                                onSelect={()   => handleNodeSelect(node.id)}
                                onMove={handleNodeMove}
                                onMoveStart={handleNodeMoveStart}
                                onDelete={handleNodeDelete}
                                onConnectionStart={handleConnectionStart}
                                onConnectionEnd={handleConnectionEnd}
                                onConfigure={handleConfigureNode}
                            />
                        ))}

                        {nodes.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="text-center text-gray-400">
                                    <div className="text-5xl mb-3">🔧</div>
                                    <p className="text-base font-medium">Arrastra nodos desde la paleta izquierda</p>
                                    <p className="text-sm mt-1">Empieza con un nodo <strong>Trigger</strong> para activar el flujo</p>
                                </div>
                            </div>
                        )}

                        {/* Indicador de conexión activa */}
                        {connectingFrom && (
                            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
                                Haz clic en el nodo destino para conectar
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Panel de configuración */}
            <NodeConfigPanel
                node={nodeToConfig}
                prevNode={prevNodeToConfig}
                isOpen={configPanelOpen}
                onClose={() => { setConfigPanelOpen(false); setNodeToConfig(null); setPrevNodeToConfig(null); }}
                onSave={handleSaveNodeConfig}
            />

            {/* Asistente de Diseño IA (F3.2) */}
            {showAssistant && (
                <DesignAssistant
                    nodes={nodes}
                    connections={connections}
                    onClose={() => setShowAssistant(false)}
                />
            )}

            {/* Checklist pre-ejecución */}
            {showChecklist && (
                <ChecklistModal
                    workflowName={workflowName}
                    items={checkItems}
                    executing={executing}
                    onConfirm={handleConfirmExecute}
                    onCancel={() => setShowChecklist(false)}
                />
            )}
        </div>
    );
}
