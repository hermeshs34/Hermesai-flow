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