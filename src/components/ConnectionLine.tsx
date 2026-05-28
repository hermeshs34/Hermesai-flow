import { WorkflowConnection, WorkflowNodeData } from '../types/workflow';

interface ConnectionLineProps {
    connection: WorkflowConnection;
    nodes:      WorkflowNodeData[];
}

export function ConnectionLine({ connection, nodes }: ConnectionLineProps) {
    const sourceNode = nodes.find(n => n.id === connection.sourceId);
    const targetNode = nodes.find(n => n.id === connection.targetId);

    if (!sourceNode || !targetNode) return null;

    const start = {
        x: sourceNode.position.x + 208, // handle derecho del nodo (w-52 = 208px)
        y: sourceNode.position.y + 52,
    };
    const end = {
        x: targetNode.position.x,
        y: targetNode.position.y + 52,
    };

    const midX     = (start.x + end.x) / 2;
    const path     = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
    const isDecision = sourceNode.category === 'decision';

    // Color según rama
    const color = isDecision
        ? connection.branch === 'false' ? '#ef4444' : '#22c55e'
        : '#6366f1';

    // Punto medio de la curva para colocar la etiqueta
    const labelX = midX;
    const labelY = (start.y + end.y) / 2;

    const markerId = `arrow-${connection.id}`;

    return (
        <svg
            className="absolute inset-0 pointer-events-none overflow-visible"
            style={{ zIndex: 1, width: '100%', height: '100%' }}
        >
            <defs>
                <marker
                    id={markerId}
                    markerWidth="8"
                    markerHeight="6"
                    refX="7"
                    refY="3"
                    orient="auto"
                >
                    <polygon points="0 0, 8 3, 0 6" fill={color} />
                </marker>
            </defs>

            <path
                d={path}
                stroke={color}
                strokeWidth="2"
                fill="none"
                strokeDasharray={isDecision && connection.branch === 'false' ? '6 3' : undefined}
                markerEnd={`url(#${markerId})`}
            />

            {/* Etiqueta SI / NO en nodos de decisión */}
            {isDecision && (
                <>
                    <rect
                        x={labelX - 14}
                        y={labelY - 10}
                        width="28"
                        height="18"
                        rx="4"
                        fill={connection.branch === 'false' ? '#fef2f2' : '#f0fdf4'}
                        stroke={color}
                        strokeWidth="1"
                    />
                    <text
                        x={labelX}
                        y={labelY + 4}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="700"
                        fill={color}
                    >
                        {connection.branch === 'false' ? 'NO' : 'SI'}
                    </text>
                </>
            )}
        </svg>
    );
}
