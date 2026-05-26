import { useCallback } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import type { Workflow, WorkflowNodeData, WorkflowConnection, ExecutionLog } from '../types/workflow';
import { showSuccess, showError, showInfo, executeWithToast } from '../utils/toast';
import { WorkflowService } from '../services/workflowService';

/**
 * Hook para gestionar workflows
 */
export function useWorkflows() {
  const { workflows, isLoading, error, setWorkflows, addWorkflow, updateWorkflow, deleteWorkflow } = useWorkflowStore();

  const loadWorkflows = useCallback(async () => {
    try {
      useWorkflowStore.setState({ isLoading: true, error: null });
      const workflows = await WorkflowService.getWorkflows();
      setWorkflows(workflows);
      return workflows;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error cargando flujos';
      useWorkflowStore.setState({ error: errorMessage });
      showError(errorMessage);
      throw err;
    } finally {
      useWorkflowStore.setState({ isLoading: false });
    }
  }, [setWorkflows]);

  const createWorkflow = useCallback(
    async (workflow: Omit<Workflow, 'id' | 'createdAt' | 'executionCount'>) => {
      return executeWithToast(
        (async () => {
          const newWorkflow = await WorkflowService.createWorkflow(workflow);
          addWorkflow(newWorkflow);
          return newWorkflow;
        })(),
        {
          loading: 'Creando flujo...',
          success: `Flujo "${workflow.name}" creado exitosamente`,
          error: 'Error al crear el flujo',
        }
      );
    },
    [addWorkflow]
  );

  const editWorkflow = useCallback(
    async (id: string, updates: Partial<Workflow>) => {
      return executeWithToast(
        (async () => {
          const updated = await WorkflowService.updateWorkflow(id, updates);
          if (updated) {
            updateWorkflow(id, updates);
          }
          return updated;
        })(),
        {
          loading: 'Actualizando flujo...',
          success: 'Flujo actualizado exitosamente',
          error: 'Error al actualizar el flujo',
        }
      );
    },
    [updateWorkflow]
  );

  const removeWorkflow = useCallback(
    async (id: string) => {
      return executeWithToast(
        (async () => {
          const success = await WorkflowService.deleteWorkflow(id);
          if (success) {
            deleteWorkflow(id);
          }
          return success;
        })(),
        {
          loading: 'Eliminando flujo...',
          success: 'Flujo eliminado exitosamente',
          error: 'Error al eliminar el flujo',
        }
      );
    },
    [deleteWorkflow]
  );

  return {
    workflows,
    isLoading,
    error,
    loadWorkflows,
    createWorkflow,
    editWorkflow,
    removeWorkflow,
  };
}

/**
 * Hook para gestionar un workflow específico
 */
export function useWorkflow(workflowId: string | null) {
  const { workflows, selectWorkflow, addNode, updateNode, deleteNode, addConnection, deleteConnection } =
    useWorkflowStore();

  const workflow = workflows.find((w) => w.id === workflowId);

  const addWorkflowNode = useCallback(
    async (node: WorkflowNodeData) => {
      if (!workflowId) {
        showError('No hay flujo seleccionado');
        return;
      }
      try {
        addNode(workflowId, node);
        showSuccess('Nodo agregado');
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Error agregando nodo');
      }
    },
    [workflowId, addNode]
  );

  const updateWorkflowNode = useCallback(
    async (nodeId: string, updates: Partial<WorkflowNodeData>) => {
      if (!workflowId) {
        showError('No hay flujo seleccionado');
        return;
      }
      try {
        updateNode(workflowId, nodeId, updates);
        showInfo('Nodo actualizado');
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Error actualizando nodo');
      }
    },
    [workflowId, updateNode]
  );

  const removeNode = useCallback(
    async (nodeId: string) => {
      if (!workflowId) {
        showError('No hay flujo seleccionado');
        return;
      }
      try {
        deleteNode(workflowId, nodeId);
        showSuccess('Nodo eliminado');
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Error eliminando nodo');
      }
    },
    [workflowId, deleteNode]
  );

  const addWorkflowConnection = useCallback(
    async (connection: WorkflowConnection) => {
      if (!workflowId) {
        showError('No hay flujo seleccionado');
        return;
      }
      try {
        addConnection(workflowId, connection);
        showInfo('Conexión agregada');
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Error agregando conexión');
      }
    },
    [workflowId, addConnection]
  );

  const removeConnection = useCallback(
    async (connectionId: string) => {
      if (!workflowId) {
        showError('No hay flujo seleccionado');
        return;
      }
      try {
        deleteConnection(workflowId, connectionId);
        showSuccess('Conexión eliminada');
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Error eliminando conexión');
      }
    },
    [workflowId, deleteConnection]
  );

  return {
    workflow,
    selectWorkflow,
    addNode: addWorkflowNode,
    updateNode: updateWorkflowNode,
    deleteNode: removeNode,
    addConnection: addWorkflowConnection,
    deleteConnection: removeConnection,
  };
}

/**
 * Hook para gestionar logs de ejecución
 */
export function useExecutionLogs(workflowId?: string) {
  const { executionLogs, addExecutionLog, getExecutionLogs, clearExecutionLogs } = useWorkflowStore();

  const logs = workflowId ? getExecutionLogs(workflowId) : executionLogs;

  const addLog = useCallback(
    (log: ExecutionLog) => {
      addExecutionLog(log);
    },
    [addExecutionLog]
  );

  const clearLogs = useCallback(() => {
    clearExecutionLogs(workflowId);
    showInfo('Logs eliminados');
  }, [workflowId, clearExecutionLogs]);

  return {
    logs,
    addLog,
    clearLogs,
  };
}

/**
 * Hook para ejecutar workflows
 */
export function useWorkflowExecution() {
  const { updateWorkflow } = useWorkflowStore();
  const { addLog } = useExecutionLogs();

  const executeWorkflow = useCallback(
    async (workflowId: string) => {
      return executeWithToast(
        (async () => {
          const result = await WorkflowService.executeWorkflow(workflowId);
          if (result.success) {
            // Actualizar último run
            updateWorkflow(workflowId, {
              lastRun: new Date().toISOString(),
            });

            // Agregar logs
            result.logs.forEach((log) => addLog(log));
          }
          return result;
        })(),
        {
          loading: 'Ejecutando flujo...',
          success: 'Flujo ejecutado exitosamente',
          error: 'Error ejecutando el flujo',
        }
      );
    },
    [updateWorkflow, addLog]
  );

  return {
    executeWorkflow,
  };
}
