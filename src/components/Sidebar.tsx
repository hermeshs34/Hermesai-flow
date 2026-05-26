
import { 
  LayoutDashboard, 
  Workflow, 
  Activity, 
  Settings as SettingsIcon,
  Database,
  Zap,
  ChevronRight,
  HelpCircle
} from 'lucide-react';
import type { ViewType } from '../App';

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  onShowTutorial?: () => void;
}

export function Sidebar({ currentView, onViewChange, onShowTutorial }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard' as ViewType, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'canvas' as ViewType, label: 'Constructor de Flujos', icon: Workflow },
    { id: 'monitoring' as ViewType, label: 'Monitoreo', icon: Activity },
    { id: 'migration' as ViewType, label: 'Migración DB', icon: Database },
    { id: 'settings' as ViewType, label: 'Configuración', icon: SettingsIcon },
  ];

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">FlowMaster</h1>
            <p className="text-xs text-gray-500">Automatización IA</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            
            return (
              <li key={item.id}>
                <button
                  onClick={() => onViewChange(item.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive 
                      ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-gray-200 space-y-3">
        {onShowTutorial && (
          <button
            onClick={onShowTutorial}
            className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors text-gray-700 hover:bg-gray-100 border border-gray-200"
          >
            <HelpCircle className="w-5 h-5" />
            <span className="font-medium">Tutorial</span>
          </button>
        )}
        
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-3 rounded-lg border border-blue-200">
          <p className="text-sm font-medium text-gray-800">Flujos Activos</p>
          <p className="text-2xl font-bold text-blue-600">12</p>
          <p className="text-xs text-gray-600">ejecutándose ahora</p>
        </div>
      </div>
    </div>
  );
}