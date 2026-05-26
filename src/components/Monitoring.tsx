import { useState } from 'react';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  RefreshCw,
  Filter,
  Download
} from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: string;
  workflow: string;
  status: 'success' | 'error' | 'running' | 'warning';
  message: string;
  duration?: number;
  details?: string;
}

export function Monitoring() {
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  
  // En producción, estos logs vendrían de una API real
  const logs: LogEntry[] = [];

  const getStatusIcon = (status: LogEntry['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'running':
        return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'warning':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      default:
        return <Activity className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: LogEntry['status']) => {
    switch (status) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'running':
        return 'bg-blue-50 border-blue-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const filteredLogs = selectedFilter === 'all' 
    ? logs 
    : logs.filter(log => log.status === selectedFilter);

  const statusCounts = {
    all: logs.length,
    success: logs.filter(l => l.status === 'success').length,
    error: logs.filter(l => l.status === 'error').length,
    running: logs.filter(l => l.status === 'running').length,
    warning: logs.filter(l => l.status === 'warning').length,
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monitoreo en Tiempo Real</h1>
          <p className="text-gray-600">Supervisa la ejecución y el rendimiento de tus flujos de trabajo</p>
        </div>
        <div className="flex items-center space-x-2">
          <button className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <RefreshCw className="w-4 h-4" />
            <span>Actualizar</span>
          </button>
          <button className="flex items-center space-x-2 px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
            <Download className="w-4 h-4" />
            <span>Exportar</span>
          </button>
        </div>
      </header>

      {/* Status Summary */}
      <div className="grid grid-cols-5 gap-4">
        {Object.entries(statusCounts).map(([status, count]) => (
          <button
            key={status}
            onClick={() => setSelectedFilter(status)}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              selectedFilter === status 
                ? 'border-blue-500 bg-blue-50' 
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600 capitalize">
                {status === 'all' ? 'Total' : status}
              </span>
              {status !== 'all' && getStatusIcon(status as LogEntry['status'])}
            </div>
            <p className="text-2xl font-bold text-gray-900">{count}</p>
          </button>
        ))}
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Registro de Actividad</h2>
            <div className="flex items-center space-x-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                Mostrando {filteredLogs.length} de {logs.length} entradas
              </span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Flujo de Trabajo
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Mensaje
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duración
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredLogs.map((log) => (
                <tr key={log.id} className={`${getStatusColor(log.status)} hover:bg-gray-50 transition-colors`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(log.status)}
                      <span className="text-sm font-medium text-gray-900 capitalize">
                        {log.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{log.workflow}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-900">{log.message}</div>
                    {log.details && (
                      <div className="text-xs text-gray-500 mt-1">{log.details}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {log.timestamp}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {log.duration ? `${log.duration}s` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Real-time Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Rendimiento Promedio</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Tiempo de ejecución</span>
              <span className="font-medium">0s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Tasa de éxito</span>
              <span className="font-medium text-green-600">0%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Flujos por hora</span>
              <span className="font-medium">0</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Recursos del Sistema</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-600 text-sm">CPU</span>
                <span className="text-sm font-medium">0%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full" style={{ width: '0%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-600 text-sm">Memoria</span>
                <span className="text-sm font-medium">0%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-orange-500 h-2 rounded-full" style={{ width: '0%' }}></div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Alertas Activas</h3>
          <div className="space-y-2">
            <div className="text-sm text-gray-500 text-center py-4">
              No hay alertas activas
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}