import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import { Sidebar } from './components/Sidebar';
import { WorkflowCanvas } from './components/WorkflowCanvas';
import { Dashboard } from './components/Dashboard';
import { Monitoring } from './components/Monitoring';
import { Settings } from './components/Settings';
import { Governance } from './components/Governance';
import { GovernanceService } from './services/governance.service';
import { Tutorial } from './components/Tutorial';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { LoginView } from './modules/iam/LoginView';
import { authService } from './core/auth.service';
import type { User } from './core/user.types';

export type ViewType = 'canvas' | 'dashboard' | 'monitoring' | 'settings' | 'governance';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [showTutorial, setShowTutorial] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Sincronizar sesión al arrancar
  useEffect(() => {
    authService.syncSession()
      .then(user => setCurrentUser(user))
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    GovernanceService.log(user, 'login', 'sesion', { descripcion: `Inicio de sesión — ${user.email}` });
  };

  const handleLogout = async () => {
    await authService.logout();
    setCurrentUser(null);
  };

  const renderContent = () => {
    switch (currentView) {
      case 'canvas':     return <WorkflowCanvas currentUser={currentUser!} />;
      case 'monitoring': return <Monitoring />;
      case 'settings':   return <Settings />;
      case 'governance': return <Governance currentUser={currentUser!} />;
      default:           return <Dashboard onNavigate={setCurrentView} currentUser={currentUser!} />;
    }
  };

  // Pantalla de carga inicial
  if (authLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', backgroundColor: '#0a0f1e',
      }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/hermesai-logo.svg" alt="HermesAI" style={{ height: '48px', marginBottom: '1.5rem', opacity: 0.8 }} />
          <div style={{ width: '32px', height: '32px', border: '3px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Login
  if (!currentUser) {
    return (
      <>
        <LoginView onLogin={handleLogin} />
        <Toaster position="bottom-right" theme="dark" richColors closeButton />
      </>
    );
  }

  // App principal
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        onShowTutorial={() => setShowTutorial(true)}
        onChangePassword={() => setShowChangePassword(true)}
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main className="flex-1 overflow-hidden">
        {renderContent()}
      </main>
      <Tutorial isOpen={showTutorial} onClose={() => setShowTutorial(false)} />
      {showChangePassword && (
        <ChangePasswordModal user={currentUser} onClose={() => setShowChangePassword(false)} />
      )}
      <Toaster position="bottom-right" theme="light" richColors closeButton />
    </div>
  );
}

export default App;