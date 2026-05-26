import { create } from 'zustand';
import type { Workflow, WorkflowNodeData, WorkflowConnection, ExecutionLog } from '../types/workflow';

interface WorkflowState {
  // Estado de workflows
  workflows: Workflow[];
  selectedWorkflowId: string | null;
  executionLogs: ExecutionLog[];
  isLoading: boolean;
  error: string | null;

  // Acciones de workflows
  setWorkflows: (workflows: Workflow[]) => void;
  addWorkflow: (workflow: Workflow) => void;
  updateWorkflow: (id: string, updates: Partial<Workflow>) => void;
  deleteWorkflow: (id: string) => void;
  selectWorkflow: (id: string | null) => void;
  getSelectedWorkflow: () => Workflow | undefined;

  // Acciones de nodos
  addNode: (workflowId: string, node: WorkflowNodeData) => void;
  updateNode: (workflowId: string, nodeId: string, updates: Partial<WorkflowNodeData>) => void;
  deleteNode: (workflowId: string, nodeId: string) => void;

  // Acciones de conexiones
  addConnection: (workflowId: string, connection: WorkflowConnection) => void;
  deleteConnection: (workflowId: string, connectionId: string) => void;

  // Logs
  addExecutionLog: (log: ExecutionLog) => void;
  getExecutionLogs: (workflowId?: string) => ExecutionLog[];
  clearExecutionLogs: (workflowId?: string) => void;

  // Estado UI
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  // Estado inicial
  workflows: [],
  selectedWorkflowId: null,
  executionLogs: [],
  isLoading: false,
  error: null,

  // Setters de workflows
  setWorkflows: (workflows) => set({ workflows }),
  
  addWorkflow: (workflow) =>
    set((state) => ({
      workflows: [...state.workflows, workflow],
    })),

  updateWorkflow: (id, updates) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === id ? { ...w, ...updates } : w
      ),
    })),

  deleteWorkflow: (id) =>
    set((state) => ({
      workflows: state.workflows.filter((w) => w.id !== id),
      selectedWorkflowId: state.selectedWorkflowId === id ? null : state.selectedWorkflowId,
    })),

  selectWorkflow: (id) => set({ selectedWorkflowId: id }),

  getSelectedWorkflow: () => {
    const state = get();
    return state.workflows.find((w) => w.id === state.selectedWorkflowId);
  },

  // Acciones de nodos
  addNode: (workflowId, node) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? { ...w, nodes: [...w.nodes, node] }
          : w
      ),
    })),

  updateNode: (workflowId, nodeId, updates) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              nodes: w.nodes.map((n) =>
                n.id === nodeId ? { ...n, ...updates } : n
              ),
            }
          : w
      ),
    })),

  deleteNode: (workflowId, nodeId) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              nodes: w.nodes.filter((n) => n.id !== nodeId),
              connections: w.connections.filter(
                (c) => c.sourceId !== nodeId && c.targetId !== nodeId
              ),
            }
          : w
      ),
    })),

  // Acciones de conexiones
  addConnection: (workflowId, connection) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? { ...w, connections: [...w.connections, connection] }
          : w
      ),
    })),

  deleteConnection: (workflowId, connectionId) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              connections: w.connections.filter((c) => c.id !== connectionId),
            }
          : w
      ),
    })),

  // Logs
  addExecutionLog: (log) =>
    set((state) => ({
      executionLogs: [log, ...state.executionLogs].slice(0, 1000), // Máximo 1000 logs
    })),

  getExecutionLogs: (workflowId) => {
    const state = get();
    if (workflowId) {
      return state.executionLogs.filter((log) => log.workflowId === workflowId);
    }
    return state.executionLogs;
  },

  clearExecutionLogs: (workflowId) =>
    set((state) => ({
      executionLogs: workflowId
        ? state.executionLogs.filter((log) => log.workflowId !== workflowId)
        : [],
    })),

  // Estado UI
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}));
