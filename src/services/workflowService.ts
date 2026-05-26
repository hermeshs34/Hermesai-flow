import type { Workflow, WorkflowNodeData, ExecutionLog } from '../types/workflow';

export class WorkflowService {
  // En memoria para desarrollo, puede ser reemplazado por API real
  private static workflows: Workflow[] = [];
  private static executionLogs: ExecutionLog[] = [];

  /**
   * Obtener todos los workflows
   * TODO: Conectar a API/Supabase real
   */
  static async getWorkflows(): Promise<Workflow[]> {
    // Simular delay de red
    return new Promise((resolve) => {
      setTimeout(() => {
        // Cargar desde localStorage si existe
        const saved = localStorage.getItem('flowmaster-workflows');
        if (saved) {
          try {
            this.workflows = JSON.parse(saved);
          } catch {
            console.warn('Error al cargar workflows del localStorage');
          }
        }
        resolve(this.workflows);
      }, 100);
    });
  }

  /**
   * Obtener un workflow específico
   */
  static async getWorkflow(id: string): Promise<Workflow | undefined> {
    const workflows = await this.getWorkflows();
    return workflows.find(w => w.id === id);
  }

  /**
   * Crear un nuevo workflow
   */
  static async createWorkflow(
    workflow: Omit<Workflow, 'id' | 'createdAt' | 'executionCount'>
  ): Promise<Workflow> {
    const newWorkflow: Workflow = {
      ...workflow,
      id: `workflow-${Date.now()}`,
      createdAt: new Date().toISOString(),
      executionCount: 0
    };

    // Obtener workflows actuales primero
    await this.getWorkflows();
    this.workflows.push(newWorkflow);
    this.saveToLocalStorage();
    
    return newWorkflow;
  }

  /**
   * Actualizar un workflow existente
   */
  static async updateWorkflow(
    id: string,
    updates: Partial<Workflow>
  ): Promise<Workflow | null> {
    await this.getWorkflows();
    const index = this.workflows.findIndex(w => w.id === id);
    if (index === -1) return null;

    this.workflows[index] = { ...this.workflows[index], ...updates };
    this.saveToLocalStorage();
    return this.workflows[index];
  }

  /**
   * Eliminar un workflow
   */
  static async deleteWorkflow(id: string): Promise<boolean> {
    await this.getWorkflows();
    const index = this.workflows.findIndex(w => w.id === id);
    if (index === -1) return false;

    this.workflows.splice(index, 1);
    this.saveToLocalStorage();
    return true;
  }

  /**
   * Guardar workflows en localStorage
   */
  private static saveToLocalStorage(): void {
    try {
      localStorage.setItem('flowmaster-workflows', JSON.stringify(this.workflows));
    } catch (error) {
      console.error('Error guardando workflows en localStorage:', error);
    }
  }

  /**
   * Ejecutar un workflow completo
   */
  static async executeWorkflow(id: string): Promise<{ success: boolean; message: string; logs: ExecutionLog[] }> {
    const workflow = await this.getWorkflow(id);
    if (!workflow) {
      return { success: false, message: 'Flujo no encontrado', logs: [] };
    }

    const executionId = `exec-${Date.now()}`;
    const logs: ExecutionLog[] = [];

    try {
      // Log de inicio
      logs.push({
        id: `${executionId}-start`,
        workflowId: id,
        timestamp: new Date().toISOString(),
        status: 'info',
        message: `Iniciando ejecución del flujo: ${workflow.name}`
      });

      // Ejecutar nodos en orden (basado en conexiones)
      const executedNodeIds = new Set<string>();
      
      for (const node of workflow.nodes) {
        const startTime = Date.now();
        
        logs.push({
          id: `${executionId}-${node.id}-start`,
          workflowId: id,
          nodeId: node.id,
          timestamp: new Date().toISOString(),
          status: 'info',
          message: `Ejecutando módulo: ${node.title}`
        });

        try {
          // Simular ejecución del nodo
          await this.executeNode(node);
          const duration = Date.now() - startTime;

          logs.push({
            id: `${executionId}-${node.id}-success`,
            workflowId: id,
            nodeId: node.id,
            timestamp: new Date().toISOString(),
            status: 'success',
            message: `Módulo ${node.title} ejecutado exitosamente`,
            duration,
            details: this.generateNodeExecutionDetails(node)
          });

          executedNodeIds.add(node.id);
        } catch (error) {
          const duration = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : 'Error desconocido';

          logs.push({
            id: `${executionId}-${node.id}-error`,
            workflowId: id,
            nodeId: node.id,
            timestamp: new Date().toISOString(),
            status: 'error',
            message: `Error en módulo ${node.title}: ${errorMessage}`,
            duration,
            details: { error: errorMessage }
          });

          // Detener ejecución si hay error crítico
          logs.push({
            id: `${executionId}-end`,
            workflowId: id,
            timestamp: new Date().toISOString(),
            status: 'error',
            message: `Flujo detenido debido a error en: ${node.title}`
          });

          await this.updateWorkflow(id, {
            lastRun: new Date().toISOString(),
            executionCount: (workflow.executionCount || 0) + 1,
            status: 'error'
          });

          this.executionLogs.push(...logs);
          return { 
            success: false, 
            message: `Error en nodo ${node.title}: ${errorMessage}`, 
            logs 
          };
        }
      }

      // Log de finalización exitosa
      logs.push({
        id: `${executionId}-end`,
        workflowId: id,
        timestamp: new Date().toISOString(),
        status: 'success',
        message: `Flujo ${workflow.name} ejecutado exitosamente (${executedNodeIds.size} nodos)`
      });

      // Actualizar estadísticas del workflow
      await this.updateWorkflow(id, {
        lastRun: new Date().toISOString(),
        executionCount: (workflow.executionCount || 0) + 1,
        status: 'active'
      });

      // Guardar logs
      this.executionLogs.push(...logs);

      return { success: true, message: 'Flujo ejecutado exitosamente', logs };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      logs.push({
        id: `${executionId}-error`,
        workflowId: id,
        timestamp: new Date().toISOString(),
        status: 'error',
        message: `Error general en ejecución: ${errorMessage}`
      });

      this.executionLogs.push(...logs);
      return { success: false, message: `Error: ${errorMessage}`, logs };
    }
  }

  // Nueva función para ejecutar nodos individualmente
  private static async executeNode(node: WorkflowNodeData): Promise<void> {
    const config = node.config || {};
    
    switch (node.category) {
      case 'email':
        await this.executeEmailNode(node, config);
        break;
      case 'web':
        await this.executeWebNode(node, config);
        break;
      case 'ai':
        await this.executeAINode(node, config);
        break;
      case 'excel':
        await this.executeExcelNode(node, config);
        break;
      case 'crm':
        await this.executeCRMNode(node, config);
        break;
      default:
        throw new Error(`Tipo de nodo no soportado: ${node.category}`);
    }
  }

  private static async executeEmailNode(node: WorkflowNodeData, config: any): Promise<void> {
    if (!config.smtpHost || !config.email) {
      throw new Error('Configuración de email incompleta');
    }
    
    // Aquí iría la lógica real de email
    console.log(`Ejecutando nodo de email: ${node.title}`, config);
  }

  private static async executeWebNode(_node: WorkflowNodeData, config: any): Promise<void> {
    if (!config.url) {
      throw new Error('URL requerida para nodo web');
    }
    
    // Hacer request real
    const response = await fetch(config.url, {
      method: config.method || 'GET',
      headers: config.headers || {}
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    console.log(`Datos extraídos de ${config.url}`);
  }

  private static async executeAINode(node: WorkflowNodeData, config: any): Promise<void> {
    if (!config.apiKey) {
      throw new Error('API Key requerida para nodo IA');
    }
    
    // Aquí iría la llamada real a la API de IA
    console.log(`Procesando con IA: ${node.title}`, config);
  }

  private static async executeExcelNode(_node: WorkflowNodeData, config: any): Promise<void> {
    if (!config.filePath) {
      throw new Error('Ruta de archivo requerida para Excel');
    }
    
    console.log(`Exportando a Excel: ${config.filePath}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  private static async executeCRMNode(node: WorkflowNodeData, config: any): Promise<void> {
    if (!config.connectionString && !config.host) {
      throw new Error('Configuración de base de datos requerida');
    }
    
    console.log(`Conectando a CRM/DB: ${node.title}`, config);
  }

  private static generateNodeExecutionDetails(node: WorkflowNodeData) {
    // Retornar detalles reales basados en la configuración del nodo
    return {
      nodeType: node.category,
      nodeTitle: node.title,
      configurationApplied: node.config ? Object.keys(node.config).length > 0 : false,
      executedAt: new Date().toISOString()
    };
  }

  /**
   * Obtener logs de ejecución
   */
  static async getExecutionLogs(workflowId?: string): Promise<ExecutionLog[]> {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (workflowId) {
          resolve(this.executionLogs.filter(log => log.workflowId === workflowId));
        } else {
          resolve(this.executionLogs);
        }
      }, 50);
    });
  }

  /**
   * Cambiar estado de un workflow
   */
  static async toggleWorkflowStatus(id: string): Promise<boolean> {
    const workflow = await this.getWorkflow(id);
    if (!workflow) return false;

    const newStatus = workflow.status === 'active' ? 'paused' : 'active';
    const updated = await this.updateWorkflow(id, { 
      status: newStatus, 
      isActive: newStatus === 'active' 
    });
    
    return updated !== null;
  }
}