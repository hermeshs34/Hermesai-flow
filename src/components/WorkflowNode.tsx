import React, { useState, useRef } from 'react';
import { Mail, Globe, Database, Brain, FileText, Trash2, Settings } from 'lucide-react';
import type { WorkflowNodeData } from '../types/workflow';

interface WorkflowNodeProps {
  node: WorkflowNodeData;
  isSelected: boolean;
  onSelect: () => void;
  onMove: (nodeId: string, newPosition: { x: number; y: number }) => void;
  onDelete: (nodeId: string) => void;
  onConnectionStart?: (nodeId: string) => void;
  onConnectionEnd?: (nodeId: string) => void;
  onConfigure?: (nodeId: string) => void;
}

export function WorkflowNode({ node, isSelected, onSelect, onMove, onDelete, onConnectionStart, onConnectionEnd, onConfigure }: WorkflowNodeProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const nodeRef = useRef<HTMLDivElement>(null);

  const getNodeIcon = () => {
    switch (node.category) {
      case 'email': return Mail;
      case 'web': return Globe;
      case 'ai': return Brain;
      case 'excel': return FileText;
      case 'crm': return Database;
      default: return Settings;
    }
  };

  const getNodeColor = () => {
    switch (node.type) {
      case 'trigger': return 'bg-green-100 border-green-300 text-green-800';
      case 'processor': return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'output': return 'bg-orange-100 border-orange-300 text-orange-800';
      default: return 'bg-gray-100 border-gray-300 text-gray-800';
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!nodeRef.current) return;
    
    const rect = nodeRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    setIsDragging(true);
    onSelect();
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !nodeRef.current?.parentElement) return;

    const parentRect = nodeRef.current.parentElement.getBoundingClientRect();
    const newX = e.clientX - parentRect.left - dragOffset.x;
    const newY = e.clientY - parentRect.top - dragOffset.y;

    onMove(node.id, { x: Math.max(0, newX), y: Math.max(0, newY) });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  const Icon = getNodeIcon();

  return (
    <div
      ref={nodeRef}
      className={`absolute w-48 bg-white rounded-lg border-2 shadow-lg cursor-move select-none transition-all duration-200 ${
        getNodeColor()
      } ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''} ${
        isDragging ? 'scale-105 shadow-xl' : 'hover:shadow-md'
      }`}
      style={{
        left: node.position.x,
        top: node.position.y,
        zIndex: isSelected ? 10 : 1
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Node Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <Icon className="w-5 h-5" />
          <span className="font-medium text-sm">{node.title}</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfigure?.(node.id);
            }}
            className="text-gray-400 hover:text-blue-500 transition-colors"
            title="Configurar nodo"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.id);
            }}
            className="text-gray-400 hover:text-red-500 transition-colors"
            title="Eliminar nodo"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Node Body */}
      <div className="p-3">
        <div className="text-xs text-gray-600 mb-2">
          ID: {node.id.split('-').pop()}
        </div>
        <div className="text-xs text-gray-600 mb-2">
          {node.type === 'trigger' && 'Disparador'}
          {node.type === 'processor' && 'Procesador'}
          {node.type === 'output' && 'Salida'}
        </div>
        
        <div className="text-xs text-gray-500">
          {node.category === 'email' && 'Monitoreo de correos'}
          {node.category === 'web' && 'Extracción web'}
          {node.category === 'ai' && 'Procesamiento IA'}
          {node.category === 'logic' && 'Lógica condicional'}
          {node.category === 'excel' && 'Exportar a Excel'}
          {node.category === 'crm' && 'Integración CRM'}
        </div>
        
        {node.status && (
          <div className={`text-xs mt-2 px-2 py-1 rounded ${
            node.status === 'success' ? 'bg-green-100 text-green-800' :
            node.status === 'error' ? 'bg-red-100 text-red-800' :
            node.status === 'running' ? 'bg-blue-100 text-blue-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {node.status === 'success' && '✓ Completado'}
            {node.status === 'error' && '✗ Error'}
            {node.status === 'running' && '⟳ Ejecutando'}
            {node.status === 'idle' && '○ Inactivo'}
          </div>
        )}
      </div>

      {/* Connection Points */}
      {node.type !== 'output' && (
        <div 
          className="absolute -right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow cursor-pointer hover:bg-blue-600 transition-colors"
          onMouseDown={(e) => {
            e.stopPropagation();
            onConnectionStart?.(node.id);
          }}
          title="Arrastrar para conectar"
        />
      )}
      {node.type !== 'trigger' && (
        <div 
          className="absolute -left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 bg-gray-400 rounded-full border-2 border-white shadow cursor-pointer hover:bg-gray-500 transition-colors"
          onMouseUp={(e) => {
            e.stopPropagation();
            onConnectionEnd?.(node.id);
          }}
          title="Punto de conexión de entrada"
        />
      )}
    </div>
  );
}