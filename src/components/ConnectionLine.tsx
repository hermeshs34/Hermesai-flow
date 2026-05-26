import { WorkflowConnection, WorkflowNodeData } from '../types/workflow';

interface ConnectionLineProps {
  connection: WorkflowConnection;
  nodes: WorkflowNodeData[];
}

export function ConnectionLine({ connection, nodes }: ConnectionLineProps) {
  const sourceNode = nodes.find(n => n.id === connection.sourceId);
  const targetNode = nodes.find(n => n.id === connection.targetId);
  
  if (!sourceNode || !targetNode) return null;
  
  // Calcular posiciones de los puntos de conexión
  const start = {
    x: sourceNode.position.x + 192, // Ancho del nodo (192px) para punto de salida derecho
    y: sourceNode.position.y + 50   // Mitad de la altura del nodo
  };
  
  const end = {
    x: targetNode.position.x,       // Punto de entrada izquierdo
    y: targetNode.position.y + 50   // Mitad de la altura del nodo
  };
  
  const midX = (start.x + end.x) / 2;
  const path = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
  
  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
      <defs>
        <marker
          id={`arrowhead-${connection.id}`}
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon
            points="0 0, 10 3.5, 0 7"
            fill="#3B82F6"
          />
        </marker>
      </defs>
      <path
        d={path}
        stroke="#3B82F6"
        strokeWidth="2"
        fill="none"
        markerEnd={`url(#arrowhead-${connection.id})`}
        className="transition-all duration-200 hover:stroke-blue-600"
      />
    </svg>
  );
}