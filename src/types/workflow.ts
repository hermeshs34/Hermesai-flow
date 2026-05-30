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
}

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