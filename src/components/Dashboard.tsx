import { useEffect } from 'react';
import { useWorkflows, useWorkflowExecution } from '../hooks/useWorkflow';
import { useWorkflowStore } from '../store/workflowStore';
import { 
  TrendingUp, 
  Mail, 
  Globe, 
  Database,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  Play,
  Pause
} from 'lucide-react';
import { showInfo } from '../utils/toast';

export function Dashboard() {
  const { workflows, loadWorkflows } = useWorkflows();
  const executionLogs = useWorkflowStore(state => state.executionLogs);
  const { executeWorkflow } = useWorkflowExecution();

  const recentLogs = executionLogs.slice(0, 10);

  const stats = [
    { label: 'Flujos Ejecutados Hoy', value: '0', icon: Zap, color: 'blue', trend: '0%' },
    { label: 'Emails Procesados', value: '0', icon: Mail, color: 'green', trend: '0%' },
    { label: 'Web Scrapings', value: '0', icon: Globe, color: 'purple', trend: '0%' },
    { label: 'Registros CRM', value: '0', icon: Database, color: 'orange', trend: '0%' },
  ];

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleToggleWorkflow = async (_workflowId: string) => {
    try {
      // Agregar await para operación async
      await loadWorkflows();
      showInfo('Estado del flujo actualizado');
    } catch (error) {
      console.error('Error actualizando flujo:', error);
    }
  };

  const handleExecuteWorkflow = async (workflowId: string) => {
    try {
      await executeWorkflow(workflowId);
    } catch (error) {
      console.error('Error ejecutando flujo:', error);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Monitorea tus flujos de automatización en tiempo real</p>
        </div>
        <div className="flex items-center space-x-2 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-green-700 font-medium">Sistema Operativo</span>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div key={index} className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">{stat.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                  <div className="flex items-center mt-2">
                    <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                    <span className="text-sm text-green-600 font-medium">{stat.trend}</span>
                  </div>
                </div>
                <div className={`w-12 h-12 bg-${stat.color}-100 rounded-lg flex items-center justify-center`}>
                  <Icon className={`w-6 h-6 text-${stat.color}-600`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Workflows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Flujos de Trabajo</h2>
            <span className="text-sm text-gray-500">{workflows.length} activos</span>
          </div>
          <div className="space-y-4">
            {workflows.map((workflow) => (
              <div key={workflow.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    workflow.status === 'active' ? 'bg-green-500' :
                    workflow.status === 'paused' ? 'bg-yellow-500' : 'bg-red-500'
                  }`}></div>
                  <div>
                    <p className="font-medium text-gray-900">{workflow.name}</p>
                    <p className="text-sm text-gray-600">
                      {workflow.lastRun ? `Última ejecución: ${new Date(workflow.lastRun).toLocaleString()}` : 'Nunca ejecutado'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="text-right mr-2">
                    <p className="text-sm font-medium text-gray-900">{workflow.executionCount}</p>
                    <p className="text-xs text-gray-500">ejecuciones</p>
                  </div>
                  <button
                    onClick={() => handleExecuteWorkflow(workflow.id)}
                    className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors"
                    title="Ejecutar ahora"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleWorkflow(workflow.id)}
                    className={`p-1 rounded transition-colors ${
                      workflow.status === 'active' 
                        ? 'text-yellow-600 hover:bg-yellow-100' 
                        : 'text-green-600 hover:bg-green-100'
                    }`}
                    title={workflow.status === 'active' ? 'Pausar' : 'Activar'}
                  >
                    {workflow.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
            {workflows.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p>No hay flujos de trabajo creados</p>
                <p className="text-sm mt-1">Ve al Constructor de Flujos para crear uno</p>
              </div>
            )}
          </div>
        </div>

        {/* System Health */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Actividad Reciente</h2>
            <span className="text-sm text-gray-500">{recentLogs.length} eventos</span>
          </div>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {recentLogs.map((log) => (
              <div key={log.id} className="flex items-start space-x-3 p-2 rounded-lg hover:bg-gray-50">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                  log.status === 'success' ? 'bg-green-500' :
                  log.status === 'error' ? 'bg-red-500' :
                  log.status === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                }`}></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{log.message}</p>
                  <p className="text-xs text-gray-500">{new Date(log.timestamp).toLocaleString()}</p>
                  {log.duration && (
                    <p className="text-xs text-gray-400">Duración: {log.duration}ms</p>
                  )}
                </div>
              </div>
            ))}
            {recentLogs.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p>No hay actividad reciente</p>
                <p className="text-sm mt-1">Los logs aparecerán aquí cuando ejecutes flujos</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Estado del Sistema</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-gray-700">API de Email</span>
              </div>
              <span className="text-green-600 text-sm font-medium">Operativo</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-gray-700">Web Scraping Engine</span>
              </div>
              <span className="text-green-600 text-sm font-medium">Operativo</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                <span className="text-gray-700">Procesador IA</span>
              </div>
              <span className="text-yellow-600 text-sm font-medium">Carga Alta</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <span className="text-gray-700">Conexión CRM</span>
              </div>
              <span className="text-red-600 text-sm font-medium">Error</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}