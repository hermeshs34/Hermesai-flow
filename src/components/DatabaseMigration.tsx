import { useState } from 'react';
import { DatabaseMigrationService } from '../services/databaseMigrationService';
import {
  Database,
  CheckCircle,
  AlertCircle,
  Clock,
  Play,
  FileText,
  Settings,
  BarChart3
} from 'lucide-react';

interface MigrationStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  details?: string[];
}

export function DatabaseMigration() {
  const [migrationConfig, setMigrationConfig] = useState({
    oracleConnection: {
      host: '',
      port: 1521,
      database: '',
      username: '',
      password: ''
    },
    supabaseConfig: {
      url: '',
      anonKey: ''
    }
  });

  const [migrationSteps, setMigrationSteps] = useState<MigrationStep[]>([
    {
      id: 'analysis',
      title: 'Análisis de Esquema',
      description: 'Analizar estructura de base de datos Oracle',
      status: 'pending',
      progress: 0
    },
    {
      id: 'schema',
      title: 'Migración de Esquema',
      description: 'Crear tablas y estructuras en PostgreSQL',
      status: 'pending',
      progress: 0
    },
    {
      id: 'data',
      title: 'Migración de Datos',
      description: 'Transferir datos tabla por tabla',
      status: 'pending',
      progress: 0
    },
    {
      id: 'procedures',
      title: 'Procedimientos y Funciones',
      description: 'Convertir PL/SQL a PL/pgSQL',
      status: 'pending',
      progress: 0
    },
    {
      id: 'validation',
      title: 'Validación',
      description: 'Verificar integridad de datos migrados',
      status: 'pending',
      progress: 0
    }
  ]);

  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [migrationService, setMigrationService] = useState<DatabaseMigrationService | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [migrationLog, setMigrationLog] = useState<string[]>([]);

  const updateStepStatus = (stepId: string, status: MigrationStep['status'], progress: number = 0, details?: string[]) => {
    setMigrationSteps(prev => prev.map(step => 
      step.id === stepId 
        ? { ...step, status, progress, details }
        : step
    ));
  };

  const addToLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setMigrationLog(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const startMigration = async () => {
    if (!migrationService) {
      const service = new DatabaseMigrationService(migrationConfig);
      setMigrationService(service);
    }

    // Paso 1: Análisis
    setCurrentStep('analysis');
    updateStepStatus('analysis', 'running', 0);
    addToLog('Iniciando análisis de esquema Oracle...');

    try {
      const analysis = await migrationService!.analyzeOracleSchema();
      setAnalysisResult(analysis);
      updateStepStatus('analysis', 'completed', 100, [
        `${analysis.tables.length} tablas encontradas`,
        `${analysis.procedures.length} procedimientos`,
        `${analysis.functions.length} funciones`
      ]);
      addToLog(`Análisis completado: ${analysis.tables.length} tablas identificadas`);

      // Paso 2: Esquema
      setCurrentStep('schema');
      updateStepStatus('schema', 'running', 0);
      addToLog('Generando scripts de migración de esquema...');

      await migrationService!.generateSchemaScript(analysis);
      updateStepStatus('schema', 'completed', 100, [
        'Scripts SQL generados',
        'Esquema listo para creación'
      ]);
      addToLog('Scripts de esquema generados exitosamente');

      // Paso 3: Datos
      setCurrentStep('data');
      updateStepStatus('data', 'running', 0);
      addToLog('Iniciando migración de datos...');

      for (let i = 0; i < analysis.tables.length; i++) {
        const table = analysis.tables[i];
        addToLog(`Migrando tabla: ${table.name}`);
        
        await migrationService!.migrateTableData(table.name);
        const overallProgress = ((i + 1) / analysis.tables.length) * 100;
        
        updateStepStatus('data', 'running', overallProgress, [
          `Tabla actual: ${table.name}`,
          `Progreso: ${Math.round(overallProgress)}%`
        ]);
      }

      updateStepStatus('data', 'completed', 100);
      addToLog('Migración de datos completada');

      // Paso 4: Procedimientos
      setCurrentStep('procedures');
      updateStepStatus('procedures', 'running', 0);
      addToLog('Convirtiendo procedimientos almacenados...');

      const procResult = await migrationService!.migrateProcedures(analysis.procedures);
      updateStepStatus('procedures', 'completed', 100, [
        `${procResult.converted.length} convertidos automáticamente`,
        `${procResult.manual.length} requieren conversión manual`
      ]);
      addToLog(`Procedimientos procesados: ${procResult.converted.length} automáticos, ${procResult.manual.length} manuales`);

      // Paso 5: Validación
      setCurrentStep('validation');
      updateStepStatus('validation', 'running', 0);
      addToLog('Validando integridad de datos...');

      let allValid = true;
      for (const table of analysis.tables) {
        const validation = await migrationService!.validateMigration(table.name);
        if (!validation.isValid) {
          allValid = false;
          addToLog(`Advertencia en tabla ${table.name}: ${validation.issues.join(', ')}`);
        }
      }

      updateStepStatus('validation', allValid ? 'completed' : 'error', 100, [
        allValid ? 'Todos los datos validados correctamente' : 'Se encontraron inconsistencias',
        'Revisar log para detalles'
      ]);

      setCurrentStep(null);
      addToLog('Migración completada');

    } catch (error) {
      const errorMessage = (error as Error).message;
      updateStepStatus(currentStep!, 'error', 0, [errorMessage]);
      addToLog(`Error: ${errorMessage}`);
      setCurrentStep(null);
    }
  };

  const getStepIcon = (step: MigrationStep) => {
    switch (step.status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'running':
        return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Migración de Base de Datos</h1>
        <p className="text-gray-600">Migra tu aplicación de Oracle a Supabase (PostgreSQL)</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuración */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center space-x-2 mb-4">
              <Settings className="w-5 h-5 text-blue-600" />
              <h2 className="font-semibold text-gray-900">Configuración</h2>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Oracle Database</h3>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Host"
                    value={migrationConfig.oracleConnection.host}
                    onChange={(e) => setMigrationConfig(prev => ({
                      ...prev,
                      oracleConnection: { ...prev.oracleConnection, host: e.target.value }
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      placeholder="Puerto"
                      value={migrationConfig.oracleConnection.port}
                      onChange={(e) => setMigrationConfig(prev => ({
                        ...prev,
                        oracleConnection: { ...prev.oracleConnection, port: parseInt(e.target.value) }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Database"
                      value={migrationConfig.oracleConnection.database}
                      onChange={(e) => setMigrationConfig(prev => ({
                        ...prev,
                        oracleConnection: { ...prev.oracleConnection, database: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Usuario"
                    value={migrationConfig.oracleConnection.username}
                    onChange={(e) => setMigrationConfig(prev => ({
                      ...prev,
                      oracleConnection: { ...prev.oracleConnection, username: e.target.value }
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="password"
                    placeholder="Contraseña"
                    value={migrationConfig.oracleConnection.password}
                    onChange={(e) => setMigrationConfig(prev => ({
                      ...prev,
                      oracleConnection: { ...prev.oracleConnection, password: e.target.value }
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Supabase</h3>
                <div className="space-y-2">
                  <input
                    type="url"
                    placeholder="URL del proyecto"
                    value={migrationConfig.supabaseConfig.url}
                    onChange={(e) => setMigrationConfig(prev => ({
                      ...prev,
                      supabaseConfig: { ...prev.supabaseConfig, url: e.target.value }
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="password"
                    placeholder="Anon Key"
                    value={migrationConfig.supabaseConfig.anonKey}
                    onChange={(e) => setMigrationConfig(prev => ({
                      ...prev,
                      supabaseConfig: { ...prev.supabaseConfig, anonKey: e.target.value }
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <button
                onClick={startMigration}
                disabled={currentStep !== null}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
              >
                <Play className="w-4 h-4" />
                <span>{currentStep ? 'Migrando...' : 'Iniciar Migración'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Progreso */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center space-x-2 mb-4">
              <BarChart3 className="w-5 h-5 text-green-600" />
              <h2 className="font-semibold text-gray-900">Progreso de Migración</h2>
            </div>

            <div className="space-y-4">
              {migrationSteps.map((step) => (
                <div key={step.id} className="flex items-start space-x-3">
                  <div className="flex-shrink-0 mt-1">
                    {getStepIcon(step)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-900">{step.title}</h3>
                      <span className="text-xs text-gray-500">{step.progress}%</span>
                    </div>
                    <p className="text-sm text-gray-600">{step.description}</p>
                    
                    {step.progress > 0 && (
                      <div className="mt-2">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full transition-all duration-300 ${
                              step.status === 'completed' ? 'bg-green-500' :
                              step.status === 'error' ? 'bg-red-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${step.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {step.details && step.details.length > 0 && (
                      <ul className="mt-2 text-xs text-gray-500 space-y-1">
                        {step.details.map((detail, i) => (
                          <li key={i}>• {detail}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Log de Migración */}
          <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center space-x-2 mb-4">
              <FileText className="w-5 h-5 text-gray-600" />
              <h2 className="font-semibold text-gray-900">Log de Migración</h2>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
              {migrationLog.length === 0 ? (
                <p className="text-sm text-gray-500">No hay actividad aún...</p>
              ) : (
                <div className="space-y-1">
                  {migrationLog.map((entry, index) => (
                    <div key={index} className="text-xs font-mono text-gray-700">
                      {entry}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Análisis de Esquema */}
      {analysisResult && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Database className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">Análisis de Esquema</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <h3 className="font-medium text-blue-900">Tablas</h3>
              <p className="text-2xl font-bold text-blue-600">{analysisResult.tables.length}</p>
              <ul className="mt-2 text-sm text-blue-700 space-y-1">
                {analysisResult.tables.slice(0, 3).map((table: any) => (
                  <li key={table.name}>• {table.name}</li>
                ))}
                {analysisResult.tables.length > 3 && (
                  <li>• ... y {analysisResult.tables.length - 3} más</li>
                )}
              </ul>
            </div>

            <div className="bg-green-50 rounded-lg p-4">
              <h3 className="font-medium text-green-900">Procedimientos</h3>
              <p className="text-2xl font-bold text-green-600">{analysisResult.procedures.length}</p>
              <ul className="mt-2 text-sm text-green-700 space-y-1">
                {analysisResult.procedures.slice(0, 3).map((proc: string) => (
                  <li key={proc}>• {proc}</li>
                ))}
              </ul>
            </div>

            <div className="bg-orange-50 rounded-lg p-4">
              <h3 className="font-medium text-orange-900">Funciones</h3>
              <p className="text-2xl font-bold text-orange-600">{analysisResult.functions.length}</p>
              <ul className="mt-2 text-sm text-orange-700 space-y-1">
                {analysisResult.functions.slice(0, 3).map((func: string) => (
                  <li key={func}>• {func}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}