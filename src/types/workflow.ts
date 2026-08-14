export interface WorkflowNodeData {
  id: string;
  type: 'trigger' | 'processor' | 'output';
  category: string;
  title: string;
  position: { x: number; y: number };
  config: Record<string, any>;
  connections: string[];
  status?: 'idle' | 'running' | 'success' | 'error';
  lastRun?: string;
  executionCount?: number;
}

export interface WorkflowConnection {
  id: string;
  sourceId: string;
  targetId: string;
  branch?: 'true' | 'false'; // solo para nodos decision: rama SI (true) o NO (false)
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNodeData[];
  connections: WorkflowConnection[];
  isActive: boolean;
  schedule?: {
    type: 'manual' | 'interval' | 'cron';
    value?: string;
    interval?: number;
  };
  createdAt: string;
  lastRun?: string;
  executionCount: number;
  status: 'active' | 'paused' | 'error';
  responsible?: string; // derivado de created_by → profiles.name
  /**
   * Estado de la DEFINICIÓN — no confundir con `status`, que es cómo acabó la
   * última ejecución. Solo se mueve por `WorkflowService.transicionar`, que
   * llama a la RPC `transicionar_flujo`; ningún UPDATE normal puede promoverlo
   * (lo impide un trigger de la base).
   */
  estadoDefinicion: EstadoDefinicion;
}

/** borrador → en_revision → publicado. Solo se dispara lo publicado. */
export type EstadoDefinicion = 'borrador' | 'en_revision' | 'publicado';

export const ESTADO_DEFINICION_META: Record<EstadoDefinicion, { label: string; color: string; ayuda: string }> = {
  borrador:    { label: 'Borrador',     color: '#94a3b8', ayuda: 'En diseño. No se ejecuta por sí solo; solo su dueño puede probarlo.' },
  en_revision: { label: 'En revisión',  color: '#f59e0b', ayuda: 'Esperando que el Supervisor o el Autorizador Máximo lo autoricen.' },
  publicado:   { label: 'Publicado',    color: '#10b981', ayuda: 'Autorizado. Puede activarse y dispararse por su programación.' },
};

export interface ExecutionLog {
  id: string;
  workflowId: string;
  nodeId?: string;
  timestamp: string;
  status: 'success' | 'error' | 'warning' | 'info';
  message: string;
  details?: any;
  duration?: number;
}