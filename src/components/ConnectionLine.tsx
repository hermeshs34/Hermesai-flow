import { WorkflowConnection, WorkflowNodeData } from '../types/workflow';

interface ConnectionLineProps {
    connection:       WorkflowConnection;
    nodes:            WorkflowNodeData[];
    onDelete?:        (connectionId: string) => void;
    onToggleBranch?:  (connectionId: string) => void;
}

export function ConnectionLine({ connection, nodes, onDelete, onToggleBranch }: ConnectionLineProps) {
    const sourceNode = nodes.find(n => n.id === connection.sourceId);
    const targetNode = nodes.find(n => n.id === connection.targetId);

    if (!sourceNode || !targetNode) return null;

    const start = {
        x: sourceNode.position.x + 208,
        y: sourceNode.position.y + 52,
    };
    const end = {
        x: targetNode.position.x,
        y: targetNode.position.y + 52,
    };

    const midX      = (start.x + end.x) / 2;
    const path      = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
    const isDecision = sourceNode.category === 'decision';

    // null branch = sin etiquetar → naranja advertencia
    const branchColor = connection.branch === 'true'  ? '#22c55e'
                      : connection.branch === 'false' ? '#ef4444'
                      : '#f59e0b'; // null → advertencia

    const color = isDecision ? branchColor : '#6366f1';

    const labelX = midX;
    const labelY = (start.y + end.y) / 2;
    const markerId = `arrow-${connection.id}`;

    return (
        <svg
            className="absolute inset-0 overflow-visible pointer-events-none"
            style={{ zIndex: 1, width: '100%', height: '100%' }}
        >
            <defs>
                <marker
                    id={markerId}
                    markerWidth="8" markerHeight="6"
                    refX="7" refY="3" orient="auto"
                >
                    <polygon points="0 0, 8 3, 0 6" fill={color} />
                </marker>
            </defs>

            {/* Línea invisible más gruesa para facilitar el clic */}
            <path
                d={path}
                stroke="transparent"
                strokeWidth="12"
                fill="none"
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onClick={() => onDelete?.(connection.id)}
            />

            {/* Línea visible */}
            <path
                d={path}
                stroke={color}
                strokeWidth="2"
                fill="none"
                strokeDasharray={isDecision && connection.branch === 'false' ? '6 3' : undefined}
                markerEnd={`url(#${markerId})`}
                style={{ pointerEvents: 'none' }}
            />

            {/* Etiqueta SI / NO — clic para intercambiar */}
            {isDecision && (
                <g
                    style={{ pointerEvents: onToggleBranch ? 'all' : 'none', cursor: onToggleBranch ? 'pointer' : 'default' }}
                    onClick={e => { e.stopPropagation(); onToggleBranch?.(connection.id); }}
                >
                    <rect
                        x={labelX - 16} y={labelY - 10}
                        width="32" height="20" rx="5"
                        fill={connection.branch === 'false' ? '#fef2f2' : connection.branch === 'true' ? '#f0fdf4' : '#fffbeb'}
                        stroke={color} strokeWidth="1.5"
                    />
                    <text
                        x={labelX} y={labelY + 4}
                        textAnchor="middle" fontSize="10"
                        fontWeight="700" fill={color}
                    >
                        {connection.branch === 'true' ? 'SI' : connection.branch === 'false' ? 'NO' : '?'}
                    </text>
                    {/* Tooltip: mostrar "clic para cambiar" */}
                    {onToggleBranch && connection.branch == null && (
                        <title>Sin rama asignada — haz clic para asignar SI o NO</title>
                    )}
                    {onToggleBranch && connection.branch != null && (
                        <title>Rama {connection.branch === 'true' ? 'SI ✅' : 'NO ❌'} — clic para intercambiar</title>
                    )}
                </g>
            )}

            {/* Botón × en el punto medio — visible al hacer hover */}
            {onDelete && (
                <g
                    style={{ pointerEvents: 'all', cursor: 'pointer' }}
                    onClick={() => onDelete(connection.id)}
                    className="connection-delete-btn"
                >
                    <circle cx={labelX + (isDecision ? 20 : 0)} cy={labelY} r="8" fill="white" stroke="#e5e7eb" strokeWidth="1" opacity="0" />
                    <text
                        x={labelX + (isDecision ? 20 : 0)} y={labelY + 4}
                        textAnchor="middle" fontSize="10"
                        fill="#9ca3af" opacity="0"
                    >×</text>
                </g>
            )}
        </svg>
    );
}
