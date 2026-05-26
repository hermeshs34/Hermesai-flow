import { useState } from 'react';
import { ConnectionService } from '../services/connectionService';
import { 
  Mail, 
  Globe, 
  Database, 
  Key, 
  Shield, 
  Bell,
  Save,
  TestTube,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle
} from 'lucide-react';

export function Settings() {
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<string>('');
  
  // Cargar configuraciones guardadas al iniciar
  const [formData, setFormData] = useState(() => {
    const saved = localStorage.getItem('flowmaster-settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error('Error cargando configuraciones:', error);
      }
    }
    
    return {
      email: {
        server: 'imap.gmail.com',
        port: 993,
        security: 'SSL/TLS',
        username: '',
        password: ''
      },
      crm: {
        type: 'Salesforce',
        apiUrl: 'https://api.salesforce.com/v1',
        apiKey: ''
      },
      ai: {
        provider: 'OpenAI (GPT-4)',
        apiKey: '',
        model: 'gpt-4'
      },
      webScraping: {
        userAgent: 'Mozilla/5.0 (compatible; FlowMaster/1.0)',
        timeout: 30,
        delay: 1000,
        useProxy: false,
        respectRobots: true
      }
    };
  });

  const togglePasswordVisibility = (field: string) => {
    setShowPasswords(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const handleInputChange = (section: string, field: string, value: any) => {
    const newFormData = {
      ...formData,
      [section]: {
        ...formData[section as keyof typeof formData],
        [field]: value
      }
    };
    
    setFormData(newFormData);
    
    // Guardar automáticamente en localStorage
    localStorage.setItem('flowmaster-settings', JSON.stringify(newFormData));
    setSaveStatus('Guardado automáticamente');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const testConnection = async (type: 'email' | 'crm' | 'ai') => {
    setIsLoading(prev => ({ ...prev, [type]: true }));
    setTestResults(prev => ({ ...prev, [type]: null }));

    try {
      let result;
      
      switch (type) {
        case 'email':
          result = await ConnectionService.testEmailConnection(formData.email);
          break;
        case 'crm':
          result = await ConnectionService.testCrmConnection(formData.crm);
          break;
        case 'ai':
          result = await ConnectionService.testAiConnection(formData.ai);
          break;
      }

      setTestResults(prev => ({ ...prev, [type]: result }));
    } catch (error) {
      setTestResults(prev => ({ 
        ...prev, 
        [type]: { 
          success: false, 
          message: 'Error inesperado: ' + (error as Error).message 
        } 
      }));
    } finally {
      setIsLoading(prev => ({ ...prev, [type]: false }));
    }
  };

  const renderTestResult = (type: string) => {
    const result = testResults[type];
    if (!result) return null;

    return (
      <div className={`mt-3 p-3 rounded-lg border ${
        result.success 
          ? 'bg-green-50 border-green-200 text-green-800' 
          : 'bg-red-50 border-red-200 text-red-800'
      }`}>
        <div className="flex items-center space-x-2">
          {result.success ? (
            <CheckCircle className="w-4 h-4 text-green-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600" />
          )}
          <span className="font-medium">{result.message}</span>
        </div>
        {result.details && (
          <div className="mt-2 text-sm">
            <pre className="bg-white bg-opacity-50 p-2 rounded text-xs overflow-x-auto">
              {JSON.stringify(result.details, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Configuración del Sistema</h1>
        <p className="text-gray-600">Gestiona conexiones, credenciales y configuraciones globales</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Email Configuration */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Mail className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Configuración de Email</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Servidor IMAP
              </label>
              <input
                type="text"
                value={formData.email.server}
                onChange={(e) => handleInputChange('email', 'server', e.target.value)}
                placeholder="imap.gmail.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Puerto
                </label>
                <input
                  type="number"
                  value={formData.email.port}
                  onChange={(e) => handleInputChange('email', 'port', parseInt(e.target.value))}
                  placeholder="993"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Seguridad
                </label>
                <select 
                  value={formData.email.security}
                  onChange={(e) => handleInputChange('email', 'security', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="SSL/TLS">SSL/TLS</option>
                  <option value="STARTTLS">STARTTLS</option>
                  <option value="None">None</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Usuario
              </label>
              <input
                type="email"
                value={formData.email.username}
                onChange={(e) => handleInputChange('email', 'username', e.target.value)}
                placeholder="usuario@empresa.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPasswords.email ? 'text' : 'password'}
                  value={formData.email.password}
                  onChange={(e) => handleInputChange('email', 'password', e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('email')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPasswords.email ? (
                    <EyeOff className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Eye className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <button 
              onClick={() => {
                testConnection('email').catch(error => {
                  console.error('Error en testConnection:', error);
                  setTestResults(prev => ({ 
                    ...prev, 
                    email: { 
                      success: false, 
                      message: 'Error de conexión: ' + (error as Error).message 
                    } 
                  }));
                  setIsLoading(prev => ({ ...prev, email: false }));
                });
              }}
              disabled={isLoading.email}
              className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
            >
              <TestTube className={`w-4 h-4 ${isLoading.email ? 'animate-spin' : ''}`} />
              <span>{isLoading.email ? 'Probando...' : 'Probar Conexión'}</span>
            </button>
            
            {renderTestResult('email')}
          </div>
        </div>

        {/* CRM Integration */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Database className="w-5 h-5 text-green-600" />
            <h2 className="font-semibold text-gray-900">Integración CRM</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tipo de CRM
              </label>
              <select 
                value={formData.crm.type}
                onChange={(e) => handleInputChange('crm', 'type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="Salesforce">Salesforce</option>
                <option value="HubSpot">HubSpot</option>
                <option value="Zoho CRM">Zoho CRM</option>
                <option value="Pipedrive">Pipedrive</option>
                <option value="Personalizado">Personalizado (API REST)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URL de API
              </label>
              <input
                type="url"
                value={formData.crm.apiUrl}
                onChange={(e) => handleInputChange('crm', 'apiUrl', e.target.value)}
                placeholder="https://api.salesforce.com/v1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key / Token
              </label>
              <div className="relative">
                <input
                  type={showPasswords.crm ? 'text' : 'password'}
                  value={formData.crm.apiKey}
                  onChange={(e) => handleInputChange('crm', 'apiKey', e.target.value)}
                  placeholder="sk_live_••••••••••••••••"
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('crm')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPasswords.crm ? (
                    <EyeOff className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Eye className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <button 
              onClick={() => testConnection('crm')}
              disabled={isLoading.crm}
              className="flex items-center space-x-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-400 transition-colors"
            >
              <TestTube className={`w-4 h-4 ${isLoading.crm ? 'animate-spin' : ''}`} />
              <span>{isLoading.crm ? 'Probando...' : 'Probar Conexión'}</span>
            </button>
            
            {renderTestResult('crm')}
          </div>
        </div>

        {/* Web Scraping Configuration */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Globe className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">Web Scraping</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                User Agent
              </label>
              <input
                type="text"
                value={formData.webScraping.userAgent}
                onChange={(e) => handleInputChange('webScraping', 'userAgent', e.target.value)}
                placeholder="Mozilla/5.0 (compatible; FlowMaster/1.0)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timeout (seg)
                </label>
                <input
                  type="number"
                  value={formData.webScraping.timeout}
                  onChange={(e) => handleInputChange('webScraping', 'timeout', parseInt(e.target.value))}
                  placeholder="30"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Delay (ms)
                </label>
                <input
                  type="number"
                  value={formData.webScraping.delay}
                  onChange={(e) => handleInputChange('webScraping', 'delay', parseInt(e.target.value))}
                  placeholder="1000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                id="use-proxy" 
                checked={formData.webScraping.useProxy}
                onChange={(e) => handleInputChange('webScraping', 'useProxy', e.target.checked)}
                className="rounded" 
              />
              <label htmlFor="use-proxy" className="text-sm text-gray-700">
                Usar proxy para scraping
              </label>
            </div>

            <div className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                id="respect-robots" 
                checked={formData.webScraping.respectRobots}
                onChange={(e) => handleInputChange('webScraping', 'respectRobots', e.target.checked)}
                className="rounded" 
              />
              <label htmlFor="respect-robots" className="text-sm text-gray-700">
                Respetar robots.txt
              </label>
            </div>
          </div>
        </div>

        {/* AI Configuration */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Key className="w-5 h-5 text-orange-600" />
            <h2 className="font-semibold text-gray-900">Configuración IA</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Proveedor de IA
              </label>
              <select 
                value={formData.ai.provider}
                onChange={(e) => handleInputChange('ai', 'provider', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="OpenAI (GPT-4)">OpenAI (GPT-4)</option>
                <option value="Google Cloud AI">Google Cloud AI</option>
                <option value="Azure Cognitive Services">Azure Cognitive Services</option>
                <option value="Local (spaCy)">Local (spaCy)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showPasswords.ai ? 'text' : 'password'}
                  value={formData.ai.apiKey}
                  onChange={(e) => handleInputChange('ai', 'apiKey', e.target.value)}
                  placeholder="sk-••••••••••••••••••••••••••••"
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('ai')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPasswords.ai ? (
                    <EyeOff className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Eye className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Modelo
              </label>
              <select 
                value={formData.ai.model}
                onChange={(e) => handleInputChange('ai', 'model', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="gpt-4">gpt-4</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                <option value="text-davinci-003">text-davinci-003</option>
              </select>
            </div>

            <button 
              onClick={() => testConnection('ai')}
              disabled={isLoading.ai}
              className="flex items-center space-x-2 px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-orange-400 transition-colors"
            >
              <TestTube className={`w-4 h-4 ${isLoading.ai ? 'animate-spin' : ''}`} />
              <span>{isLoading.ai ? 'Probando...' : 'Probar IA'}</span>
            </button>
            
            {renderTestResult('ai')}
          </div>
        </div>
      </div>

      {/* Security & Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Shield className="w-5 h-5 text-red-600" />
            <h2 className="font-semibold text-gray-900">Seguridad</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Autenticación de dos factores</span>
              <div className="relative inline-block w-10 mr-2 align-middle select-none">
                <input type="checkbox" className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" />
                <label className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Encriptación de credenciales</span>
              <div className="relative inline-block w-10 mr-2 align-middle select-none">
                <input type="checkbox" defaultChecked className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" />
                <label className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Logs de auditoría</span>
              <div className="relative inline-block w-10 mr-2 align-middle select-none">
                <input type="checkbox" defaultChecked className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" />
                <label className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Bell className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Notificaciones</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Errores críticos</span>
              <div className="relative inline-block w-10 mr-2 align-middle select-none">
                <input type="checkbox" defaultChecked className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" />
                <label className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Flujos completados</span>
              <div className="relative inline-block w-10 mr-2 align-middle select-none">
                <input type="checkbox" className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" />
                <label className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email de notificaciones
              </label>
              <input
                type="email"
                placeholder="admin@empresa.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2">
          {saveStatus && (
            <div className="flex items-center space-x-1 text-green-600">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm">{saveStatus}</span>
            </div>
          )}
        </div>
        
        <div className="flex space-x-3">
          <button 
            onClick={() => {
              localStorage.removeItem('flowmaster-settings');
              window.location.reload();
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            <span>Restablecer</span>
          </button>
          
          <button 
            onClick={() => {
              localStorage.setItem('flowmaster-settings', JSON.stringify(formData));
              setSaveStatus('✅ Configuración guardada manualmente');
              setTimeout(() => setSaveStatus(''), 3000);
            }}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Save className="w-5 h-5" />
            <span>Guardar Configuración</span>
          </button>
        </div>
      </div>
    </div>
  );
}