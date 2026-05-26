import React, { useState, useRef, useCallback, useEffect } from 'react';
import { WorkflowNode } from './WorkflowNode';
import { NodePalette } from './NodePalette';
import { ConnectionLine } from './ConnectionLine';
import NodeConfigPanel from './NodeConfigPanel';
import { WorkflowNodeData, WorkflowConnection } from '../types/workflow';
import { WorkflowService } from '../services/workflowService';
import { Save, Play, Settings, CheckCircle, Trash2 } from 'lucide-react';

export function WorkflowCanvas() {
  // Cargar flujos guardados al iniciar
  const [nodes, setNodes] = useState<WorkflowNodeData[]>(() => {
    const saved = localStorage.getItem('flowmaster-workflow-nodes');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error('Error cargando nodos:', error);
      }
    }
    return [];
  });
  
  const [connections, setConnections] = useState<WorkflowConnection[]>(() => {
    const saved = localStorage.getItem('flowmaster-workflow-connections');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error('Error cargando conexiones:', error);
      }
    }
    return [];
  });
  
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draggedNodeType, setDraggedNodeType] = useState<any>(null);
  const [showPalette, setShowPalette] = useState(true);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [nodeToConfig, setNodeToConfig] = useState<WorkflowNodeData | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const canvasRef = useRef<HTMLDivElement>(null);

  // Guardar automáticamente cuando cambien los nodos o conexiones
  useEffect(() => {
    if (nodes.length > 0) {
      localStorage.setItem('flowmaster-workflow-nodes', JSON.stringify(nodes));
      setSaveStatus('Flujo guardado automáticamente');
      setTimeout(() => setSaveStatus(''), 2000);
    }
  }, [nodes]);

  useEffect(() => {
    if (connections.length > 0) {
      localStorage.setItem('flowmaster-workflow-connections', JSON.stringify(connections));
    }
  }, [connections]);

  const handleNodeDragStart = useCallback((nodeType: any) => {
    setDraggedNodeType(nodeType);
  }, []);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    
    if (!draggedNodeType || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const position = {
      x: e.clientX - rect.left - 96, // Centrar el nodo (ancho/2)
      y: e.clientY - rect.top - 50   // Centrar el nodo (alto/2)
    };

    const newNode: WorkflowNodeData = {
      id: `node-${Date.now()}`,
      type: draggedNodeType.type,
      category: draggedNodeType.category,
      title: draggedNodeType.title,
      position,
      config: {},
      connections: [],
      status: 'idle'
    };

    setNodes(prev => [...prev, newNode]);
    setDraggedNodeType(null);
  }, [draggedNodeType]);

  const handleNodeMove = useCallback((nodeId: string, newPosition: { x: number; y: number }) => {
    setNodes(prev => prev.map(node => 
      node.id === nodeId ? { ...node, position: newPosition } : node
    ));
  }, []);

  const handleNodeSelect = useCallback((nodeId: string) => {
    setSelectedNode(nodeId);
  }, []);

  const handleNodeDelete = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(node => node.id !== nodeId));
    setConnections(prev => prev.filter(conn => 
      conn.sourceId !== nodeId && conn.targetId !== nodeId
    ));
    if (selectedNode === nodeId) {
      setSelectedNode(null);
    }
  }, [selectedNode]);

  const handleConnectionStart = useCallback((nodeId: string) => {
    setConnectingFrom(nodeId);
  }, []);

  const handleConnectionEnd = useCallback((nodeId: string) => {
    if (connectingFrom && connectingFrom !== nodeId) {
      const sourceNode = nodes.find(n => n.id === connectingFrom);
      const targetNode = nodes.find(n => n.id === nodeId);
      
      // Validar que la conexión sea válida (no conectar output a trigger, etc.)
      if (sourceNode && targetNode && sourceNode.type !== 'output' && targetNode.type !== 'trigger') {
        const newConnection: WorkflowConnection = {
          id: `connection-${Date.now()}`,
          sourceId: connectingFrom,
          targetId: nodeId
        };
        
        setConnections(prev => [...prev, newConnection]);
      }
    }
    setConnectingFrom(null);
  }, [connectingFrom, nodes]);

  const handleConfigureNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      setNodeToConfig(node);
      setConfigPanelOpen(true);
    }
  }, [nodes]);

  const handleSaveNodeConfig = useCallback((nodeId: string, config: any) => {
    setNodes(prev => {
      const updatedNodes = prev.map(node => 
        node.id === nodeId ? { ...node, config } : node
      );
      // Guardar inmediatamente en localStorage
      localStorage.setItem('flowmaster-workflow-nodes', JSON.stringify(updatedNodes));
      return updatedNodes;
    });
    setConfigPanelOpen(false);
    setNodeToConfig(null);
    setSaveStatus('Configuración de nodo guardada');
    setTimeout(() => setSaveStatus(''), 2000);
  }, []);

  const handleSaveWorkflow = async () => {
    if (nodes.length === 0) {
      alert('No hay nodos para guardar. Agrega al menos un nodo al flujo.');
      return;
    }

    const workflow = {
      name: `Flujo ${new Date().toLocaleDateString()}`,
      description: `Flujo creado con ${nodes.length} nodos y ${connections.length} conexiones`,
      nodes,
      connections,
      isActive: false,
      status: 'paused' as const
    };

    try {
      const savedWorkflow = await WorkflowService.createWorkflow(workflow);
      alert(`Flujo de trabajo "${savedWorkflow.name}" guardado exitosamente`);
    } catch (error) {
      alert('Error al guardar el flujo de trabajo');
      console.error(error);
    }
  };

  const handleExecuteWorkflow = async () => {
    if (nodes.length === 0) {
      alert('No hay nodos para ejecutar. Agrega al menos un nodo al flujo.');
      return;
    }

    // Crear un workflow temporal para ejecutar
    const tempWorkflow = {
      name: 'Flujo Temporal',
      description: 'Ejecución temporal desde el canvas',
      nodes,
      connections,
      isActive: true,
      status: 'active' as const
    };

    try {
      const savedWorkflow = await WorkflowService.createWorkflow(tempWorkflow);
      const result = await WorkflowService.executeWorkflow(savedWorkflow.id);
      
      if (result.success) {
        alert(`Ejecución completada exitosamente. Logs: ${result.logs.length} eventos`);
      } else {
        alert(`Ejecución completada con errores: ${result.message}`);
      }
      
      // Limpiar el workflow temporal
      await WorkflowService.deleteWorkflow(savedWorkflow.id);
    } catch (error) {
      alert('Error al ejecutar el flujo de trabajo');
      console.error(error);
    }
  };

  return (
    <div className="h-full flex">
      {/* Node Palette */}
      {showPalette && (
        <div className="w-80 border-r border-gray-200 bg-gray-50">
          <NodePalette 
            onDragStart={handleNodeDragStart}
            onClose={() => setShowPalette(false)}
          />
        </div>
      )}

      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center space-x-2">
            {!showPalette && (
              <button
                onClick={() => setShowPalette(true)}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Mostrar Paleta
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-900">Constructor de Flujos</h2>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {saveStatus && (
                <div className="flex items-center space-x-1 text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm">{saveStatus}</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  localStorage.removeItem('flowmaster-workflow-nodes');
                  localStorage.removeItem('flowmaster-workflow-connections');
                  setNodes([]);
                  setConnections([]);
                  setSaveStatus('Flujo limpiado');
                  setTimeout(() => setSaveStatus(''), 2000);
                }}
                className="flex items-center space-x-2 px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Limpiar</span>
              </button>
              
              <button
                onClick={handleSaveWorkflow}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                <span>Guardar</span>
              </button>
              <button 
                onClick={handleExecuteWorkflow}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Play className="w-4 h-4" />
                <span>Ejecutar</span>
              </button>
              <button className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
                <Settings className="w-4 h-4" />
                <span>Configurar</span>
              </button>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div 
          ref={canvasRef}
          className="flex-1 relative overflow-hidden bg-gray-100"
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          style={{
            backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }}
        >
          {/* Render connections */}
          {connections.map(connection => (
            <ConnectionLine
              key={connection.id}
              connection={connection}
              nodes={nodes}
            />
          ))}

          {/* Render nodes */}
          {nodes.map(node => (
            <WorkflowNode
              key={node.id}
              node={node}
              isSelected={selectedNode === node.id}
              onSelect={() => handleNodeSelect(node.id)}
              onMove={handleNodeMove}
              onDelete={handleNodeDelete}
              onConnectionStart={handleConnectionStart}
              onConnectionEnd={handleConnectionEnd}
              onConfigure={handleConfigureNode}
            />
          ))}

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <div className="text-6xl mb-4">🔧</div>
                <h3 className="text-xl font-semibold mb-2">Comienza a crear tu flujo</h3>
                <p>Arrastra componentes desde la paleta de la izquierda para empezar</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Node Configuration Panel */}
      <NodeConfigPanel
        node={nodeToConfig}
        isOpen={configPanelOpen}
        onClose={() => {
          setConfigPanelOpen(false);
          setNodeToConfig(null);
        }}
        onSave={handleSaveNodeConfig}
      />
    </div>
  );
}