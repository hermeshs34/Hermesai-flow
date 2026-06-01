import React, { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { WorkflowNode }    from './WorkflowNode';
import { NodePalette }     from './NodePalette';
import { ConnectionLine }  from './ConnectionLine';
import NodeConfigPanel     from './NodeConfigPanel';
import { WorkflowService } from '../services/workflow.service';
import { GovernanceService } from '../services/governance.service';
import { supabase }        from '../core/supabase';
import type { WorkflowNodeData, WorkflowConnection, Workflow } from '../types/workflow';
import type { NodeType }   from './NodePalette';
import type { User }       from '../core/user.types';
import {
    Play, Trash2, Plus, ChevronDown,
    CheckCircle, Loader2, PanelLeftOpen, AlertTriangle, X,
} from 'lucide-react';

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

    // ── Canvas ─────────────────────────────────────────────────────────────
    const [nodes,              setNodes]             = useState<WorkflowNodeData[]>([]);
    const [connections,        setConnections]       = useState<WorkflowConnection[]>([]);
    const [selectedNode,       setSelectedNode]      = useState<string | null>(null);
    const [draggedNodeType,    setDraggedNodeType]   = useState<NodeType | null>(null);
    const [showPalette,        setShowPalette]       = useState(true);
    const [connectingFrom,     setConnectingFrom]    = useState<string | null>(null);
    const [configPanelOpen,    setConfigPanelOpen]   = useState(false);
    const [nodeToConfig,       setNodeToConfig]      = useState<WorkflowNodeData | null>(null);

    // ── Estado de operaciones ──────────────────────────────────────────────
    const [saving,          setSaving]         = useState(false);
    const [executing,       setExecuting]      = useState(false);
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

    // ── Ejecutar flujo via Edge Function ──────────────────────────────────
    const handleExecute = async () => {
        if (!activeWorkflowId) { toast.error('Selecciona un flujo primero'); return; }
        if (nodes.length === 0) { toast.error('Agrega al menos un nodo al flujo'); return; }

        setExecuting(true);
        const toastId = toast.loading('Ejecutando flujo...');
        try {
            const { data, error } = await supabase.functions.invoke('execute-workflow', {
                body: {
                    workflowId:     activeWorkflowId,
                    organizationId: currentUser.organizationId,
                    triggeredBy:    'manual',
                },
            });
            if (error) throw error;
            if (data?.paused) {
                toast.success(
                    '⏸ Flujo pausado — tarea enviada a la Bandeja de Aprobación',
                    { id: toastId, duration: 6000 }
                );
            } else if (data?.success) {
                GovernanceService.log(currentUser, 'ejecutar', 'workflow', { entidadId: activeWorkflowId, descripcion: `Ejecutado "${workflowName}" — ${data.logs} pasos en ${data.duration}ms` });
                toast.success(
                    `Flujo completado — ${data.logs} pasos en ${data.duration}ms`,
                    { id: toastId }
                );
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
        if (!confirm('¿Limpiar todos los nodos del canvas? Esta acción no se puede deshacer.')) return;
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
        setNodes(prev => [...prev, newNode]);
        setDraggedNodeType(null);
    }, [draggedNodeType]);

    // ── Acciones de nodos ─────────────────────────────────────────────────
    const handleNodeMove   = useCallback((nodeId: string, pos: { x: number; y: number }) =>
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, position: pos } : n)), []);

    const handleNodeSelect = useCallback((nodeId: string) => setSelectedNode(nodeId), []);

    const handleNodeDelete = useCallback((nodeId: string) => {
        setNodes(prev => prev.filter(n => n.id !== nodeId));
        setConnections(prev => prev.filter(c => c.sourceId !== nodeId && c.targetId !== nodeId));
        if (selectedNode === nodeId) setSelectedNode(null);
    }, [selectedNode]);

    const handleDeleteConnection = useCallback((connId: string) =>
        setConnections(prev => prev.filter(c => c.id !== connId)), []);

    const handleConnectionStart = useCallback((nodeId: string) => setConnectingFrom(nodeId), []);

    const handleConnectionEnd = useCallback((nodeId: string) => {
        if (connectingFrom && connectingFrom !== nodeId) {
            const src = nodes.find(n => n.id === connectingFrom);
            const tgt = nodes.find(n => n.id === nodeId);
            if (src && tgt && src.type !== 'output' && tgt.type !== 'trigger') {
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

    const handleConfigureNode = useCallback((nodeId: string) => {
        const node = nodes.find(n => n.id === nodeId);
        if (node) { setNodeToConfig(node); setConfigPanelOpen(true); }
    }, [nodes]);

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
                                <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50">
                                    {/* Crear nuevo */}
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
                                                {creatingWorkflow
                                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    : <Plus className="w-3.5 h-3.5" />}
                                                Nuevo
                                            </button>
                                        </div>
                                    </div>

                                    {/* Lista */}
                                    <div className="max-h-60 overflow-y-auto">
                                        {workflows.length === 0 ? (
                                            <p className="text-sm text-gray-400 text-center py-4">
                                                Sin flujos — crea el primero
                                            </p>
                                        ) : (
                                            workflows.map(wf => (
                                                <button
                                                    key={wf.id}
                                                    onClick={() => selectWorkflow(wf)}
                                                    className={`w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors ${
                                                        wf.id === activeWorkflowId ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700'
                                                    }`}
                                                >
                                                    <div className="font-medium truncate">{wf.name}</div>
                                                    <div className="text-xs text-gray-400 mt-0.5">
                                                        {wf.executionCount ?? 0} ejecuciones ·{' '}
                                                        {new Date(wf.createdAt).toLocaleDateString('es-VE')}
                                                    </div>
                                                </button>
                                            ))
                                        )}
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
                isOpen={configPanelOpen}
                onClose={() => { setConfigPanelOpen(false); setNodeToConfig(null); }}
                onSave={handleSaveNodeConfig}
            />
        </div>
    );
}
