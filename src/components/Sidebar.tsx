
import {
  LayoutDashboard,
  Workflow,
  Activity,
  Settings as SettingsIcon,
  Zap,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import type { ViewType } from '../App';
import type { User } from '../core/user.types';

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  onShowTutorial?: () => void;
  currentUser?: User;
  onLogout?: () => void;
}

export function Sidebar({ currentView, onViewChange, onShowTutorial: _onShowTutorial, currentUser, onLogout }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard'  as ViewType, label: 'Dashboard',           icon: LayoutDashboard },
    { id: 'canvas'     as ViewType, label: 'Constructor de Flujos', icon: Workflow },
    { id: 'monitoring' as ViewType, label: 'Monitoreo',            icon: Activity },
    { id: 'settings'   as ViewType, label: 'Configuración',        icon: SettingsIcon },
  ];

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <img src="/hermesai-logo.svg" alt="HermesAI Flow" className="h-8 w-auto" />
        </div>
        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Hub de Automatización
        </p>
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
        {currentUser && (
          <div className="px-3 py-2">
            <p className="text-xs font-semibold text-gray-500 truncate">{currentUser.name}</p>
            <p className="text-xs text-gray-400 truncate">{currentUser.email}</p>
          </div>
        )}
        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors text-gray-700 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Cerrar Sesión</span>
          </button>
        )}
      </div>
    </div>
  );
}