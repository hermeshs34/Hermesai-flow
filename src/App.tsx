import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import { Sidebar } from './components/Sidebar';
import { WorkflowCanvas } from './components/WorkflowCanvas';
import { Dashboard } from './components/Dashboard';
import { Monitoring } from './components/Monitoring';
import { Settings } from './components/Settings';
import { DatabaseMigration } from './components/DatabaseMigration';
import { Tutorial } from './components/Tutorial';

export type ViewType = 'canvas' | 'dashboard' | 'monitoring' | 'settings' | 'migration';

function App() {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [showTutorial, setShowTutorial] = useState(false);

  // Mostrar tutorial en la primera visita
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('flowmaster-tutorial-seen');
    if (!hasSeenTutorial) {
      setShowTutorial(true);
    }
  }, []);

  const handleCloseTutorial = () => {
    setShowTutorial(false);
    localStorage.setItem('flowmaster-tutorial-seen', 'true');
  };

  const renderContent = () => {
    switch (currentView) {
      case 'canvas':
        return <WorkflowCanvas />;
      case 'dashboard':
        return <Dashboard />;
      case 'monitoring':
        return <Monitoring />;
      case 'settings':
        return <Settings />;
      case 'migration':
        return <DatabaseMigration />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar 
        currentView={currentView} 
        onViewChange={setCurrentView}
        onShowTutorial={() => setShowTutorial(true)}
      />
      <main className="flex-1 overflow-hidden">
        {renderContent()}
      </main>
      
      <Tutorial 
        isOpen={showTutorial} 
        onClose={handleCloseTutorial} 
      />
      
      {/* Proveedor de notificaciones toast */}
      <Toaster 
        position="bottom-right"
        theme="light"
        richColors
        closeButton
      />
    </div>
  );
}

export default App;