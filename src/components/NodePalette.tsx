import React from 'react';
import { X, Mail, Globe, Brain, FileText, Database, Filter } from 'lucide-react';

interface NodeType {
  id: string;
  type: 'trigger' | 'processor' | 'output';
  category: string;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
}

interface NodePaletteProps {
  onDragStart: (nodeType: NodeType) => void;
  onClose: () => void;
}

export function NodePalette({ onDragStart, onClose }: NodePaletteProps) {
  const nodeTypes: NodeType[] = [
    // Triggers
    {
      id: 'email-trigger',
      type: 'trigger',
      category: 'email',
      title: 'Monitor Email',
      description: 'Monitorea una bandeja de entrada específica',
      icon: Mail
    },
    {
      id: 'web-trigger',
      type: 'trigger',
      category: 'web',
      title: 'Web Scraper',
      description: 'Extrae datos de sitios web automáticamente',
      icon: Globe
    },
    
    // Processors
    {
      id: 'ai-classifier',
      type: 'processor',
      category: 'ai',
      title: 'Clasificador IA',
      description: 'Clasifica y analiza contenido usando IA',
      icon: Brain
    },
    {
      id: 'ai-responder',
      type: 'processor',
      category: 'ai',
      title: 'Responder IA',
      description: 'Genera respuestas automáticas usando IA',
      icon: Brain
    },
    {
      id: 'filter',
      type: 'processor',
      category: 'logic',
      title: 'Filtro Lógico',
      description: 'Aplica reglas condicionales',
      icon: Filter
    },
    
    // Outputs
    {
      id: 'excel-output',
      type: 'output',
      category: 'excel',
      title: 'Exportar Excel',
      description: 'Guarda datos en archivos Excel/CSV',
      icon: FileText
    },
    {
      id: 'crm-output',
      type: 'output',
      category: 'crm',
      title: 'Enviar a CRM',
      description: 'Integra con sistemas CRM/ERP',
      icon: Database
    }
  ];

  const handleDragStart = (_e: React.DragEvent, nodeType: NodeType) => {
    onDragStart(nodeType);
  };

  const groupedNodes = nodeTypes.reduce((acc, node) => {
    const group = node.type;
    if (!acc[group]) acc[group] = [];
    acc[group].push(node);
    return acc;
  }, {} as Record<string, NodeType[]>);

  const getGroupTitle = (type: string) => {
    switch (type) {
      case 'trigger': return 'Disparadores (Entrada)';
      case 'processor': return 'Procesadores (IA & Lógica)';
      case 'output': return 'Salidas (Destinos)';
      default: return type;
    }
  };

  const getGroupColor = (type: string) => {
    switch (type) {
      case 'trigger': return 'text-green-700';
      case 'processor': return 'text-blue-700';
      case 'output': return 'text-orange-700';
      default: return 'text-gray-700';
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">Paleta de Módulos</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {Object.entries(groupedNodes).map(([type, nodes]) => (
          <div key={type}>
            <h3 className={`font-medium mb-3 ${getGroupColor(type)}`}>
              {getGroupTitle(type)}
            </h3>
            <div className="space-y-2">
              {nodes.map((nodeType) => {
                const Icon = nodeType.icon;
                return (
                  <div
                    key={nodeType.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, nodeType)}
                    className="p-3 bg-white border border-gray-200 rounded-lg cursor-move hover:border-gray-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start space-x-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        nodeType.type === 'trigger' ? 'bg-green-100' :
                        nodeType.type === 'processor' ? 'bg-blue-100' : 'bg-orange-100'
                      }`}>
                        <Icon className={`w-4 h-4 ${
                          nodeType.type === 'trigger' ? 'text-green-600' :
                          nodeType.type === 'processor' ? 'text-blue-600' : 'text-orange-600'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm">
                          {nodeType.title}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          {nodeType.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="text-xs text-gray-600">
          <p className="font-medium mb-1">Instrucciones:</p>
          <p>• Arrastra módulos al canvas para crear tu flujo</p>
          <p>• Conecta módulos arrastrando desde los puntos de conexión</p>
          <p>• Haz clic en un módulo para configurar sus propiedades</p>
        </div>
      </div>
    </div>
  );
}