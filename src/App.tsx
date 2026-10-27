import { useState, useEffect, useCallback } from 'react';
import { Toaster } from 'sonner';
import { Sidebar } from './components/Sidebar';
import { WorkflowCanvas } from './components/WorkflowCanvas';
import { Dashboard } from './components/Dashboard';
import { Monitoring } from './components/Monitoring';
import { WorkQueue } from './components/WorkQueue';
import { Settings } from './components/Settings';
import { Governance } from './components/Governance';
import { GovernanceService } from './services/governance.service';
import { Tutorial } from './components/Tutorial';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { PanelSeguridad } from './components/PanelSeguridad';
import { PuertaSegundoFactor, type EstadoPuerta } from './components/SegundoFactor';
import { LoginView } from './modules/iam/LoginView';
import { ResetPasswordView } from './modules/iam/ResetPasswordView';
import { authService } from './core/auth.service';
import type { TokensDeRecuperacion } from './core/auth.service';
import { mfaService, avisarMfaCaducado, avisarSesionCerrada, tomarAvisoMfaCaducado } from './core/mfa';
import type { User } from './core/user.types';

export type ViewType = 'canvas' | 'dashboard' | 'monitoring' | 'settings' | 'governance' | 'workqueue';

// ── Qué traía la URL al arrancar ─────────────────────────────────────────────
//
// El enlace del correo de recuperación llega con sus tokens en el hash. Como el
// cliente arranca con `detectSessionInUrl: false` (src/core/supabase.ts), ese
// hash NO ha abierto ninguna sesión: es texto, y quien decide qué hacer con él
// es este bloque.
//
// Se lee una sola vez, en el cuerpo del módulo, y se BORRA de la barra de
// direcciones acto seguido: dentro va un refresh_token, y dejarlo en el
// historial del navegador es dejar una credencial escrita en la pared. Desde
// aquí los tokens solo viven en memoria — un refresco obliga a pedir un enlace
// nuevo, que es exactamente lo que debe pasar.
const HASH_ARRANQUE = typeof window !== 'undefined' ? window.location.hash : '';
const PARAMS_ARRANQUE = new URLSearchParams(HASH_ARRANQUE.replace(/^#/, ''));

const TOKENS_RECUPERACION: TokensDeRecuperacion | null = (() => {
  if (PARAMS_ARRANQUE.get('type') !== 'recovery') return null;
  const accessToken  = PARAMS_ARRANQUE.get('access_token');
  const refreshToken = PARAMS_ARRANQUE.get('refresh_token');
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
})();

const ERROR_EN_URL = (() => {
  const error = PARAMS_ARRANQUE.get('error');
  if (error) {
    // Un enlace caducado es el caso normal, no una anomalía: los de Supabase
    // duran una hora. Decirlo con su nombre y ofrecer la salida.
    if (PARAMS_ARRANQUE.get('error_code') === 'otp_expired') {
      return 'El enlace de recuperación ha caducado. Pide uno nuevo desde «¿Olvidaste tu contraseña?».';
    }
    return PARAMS_ARRANQUE.get('error_description') || 'El enlace de recuperación no es válido. Pide uno nuevo.';
  }
  // Venía marcado como recuperación pero sin tokens utilizables. No se cuela a
  // la aplicación en silencio: se dice y se manda a pedir otro enlace.
  if (PARAMS_ARRANQUE.get('type') === 'recovery' && !TOKENS_RECUPERACION) {
    return 'El enlace de recuperación está incompleto o ya se ha usado. Pide uno nuevo desde «¿Olvidaste tu contraseña?».';
  }
  return '';
})();

// Ya está leído: fuera de la URL antes de que nadie más pueda verlo.
if (typeof window !== 'undefined' && (TOKENS_RECUPERACION || ERROR_EN_URL)) {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [showTutorial, setShowTutorial] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [recuperando, setRecuperando] = useState(TOKENS_RECUPERACION !== null);
  const [showSeguridad, setShowSeguridad] = useState(false);
  // Segundo factor de la sesión abierta: `ok` deja pasar a la aplicación.
  const [estadoMfa, setEstadoMfa] = useState<EstadoPuerta | 'ok'>('cargando');
  // Lo que el login enseña al volver: un error del enlace o el motivo del cierre.
  const [avisoLogin, setAvisoLogin] = useState(() => ERROR_EN_URL || tomarAvisoMfaCaducado() || '');

  // Sincronizar sesión al arrancar
  useEffect(() => {
    // Con un enlace de recuperación abierto no se entra a la aplicación, ni
    // siquiera aunque hubiera una sesión válida de antes en este navegador:
    // aquí solo se viene a elegir contraseña nueva. Al terminar, el cierre de
    // sesión de la recuperación se lleva también aquella —cambiar la clave
    // debe echar a todas las sesiones abiertas—, así que después se entra por
    // el login como todo el mundo.
    // (La recuperación vive en `authService.abrirRecuperacion`, en un cliente
    // en memoria que no toca la sesión de este navegador.)
    if (TOKENS_RECUPERACION) { setAuthLoading(false); return; }

    authService.syncSession()
      .then(user => setCurrentUser(user))
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    GovernanceService.log(user, 'login', 'sesion', { descripcion: `Inicio de sesión — ${user.email}` });
  };

  const handleLogout = useCallback(async () => {
    await authService.logout();
    setShowSeguridad(false);
    setShowChangePassword(false);
    setAvisoLogin(tomarAvisoMfaCaducado() ?? '');
    setEstadoMfa('cargando');
    setCurrentUser(null);
  }, []);

  // ── Segundo factor (27/10/2026, portado de RiskGuard) ─────────────────────
  //
  // La puerta de la pantalla es onboarding, no control de acceso: lo que
  // protege los datos es `mfa_satisfecho()` en las políticas de la base.
  const comprobarMfa = useCallback(async () => {
    try {
      const estado = await mfaService.estado();
      if (estado === 'caducado') {
        avisarMfaCaducado();
        await handleLogout();
        return;
      }
      setEstadoMfa(estado);
    } catch {
      setEstadoMfa('error');
    }
  }, [handleLogout]);

  const usuarioId = currentUser?.id;
  useEffect(() => {
    if (usuarioId) void comprobarMfa();
  }, [usuarioId, comprobarMfa]);

  // Dentro de la aplicación: cada minuto y al volver a la ventana, ¿siguen
  // valiendo las 6 h y la sesión sigue viva en la base? Una sesión cerrada en
  // la base (cambio de clave, «Sesiones abiertas», el admin quitando el
  // factor) seguiría pintando la aplicación, pero vacía.
  const dentro = usuarioId !== undefined && estadoMfa === 'ok';
  useEffect(() => {
    if (!dentro) return;
    let comprobando = false;
    const comprobar = async () => {
      if (comprobando) return;
      comprobando = true;
      try {
        if (await mfaService.haCaducado()) {
          avisarMfaCaducado();
          await handleLogout();
          return;
        }
        // `null` = sin red: con eso no se decide nada.
        if ((await mfaService.sesionViva()) === false) {
          avisarSesionCerrada();
          await handleLogout();
        }
      } finally {
        comprobando = false;
      }
    };
    const alVolver = () => { if (document.visibilityState === 'visible') void comprobar(); };
    const intervalo = window.setInterval(() => void comprobar(), 60_000);
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [dentro, handleLogout]);

  const renderContent = () => {
    switch (currentView) {
      case 'canvas':     return <WorkflowCanvas currentUser={currentUser!} />;
      case 'monitoring': return <Monitoring />;
      case 'settings':   return <Settings />;
      case 'governance': return <Governance currentUser={currentUser!} />;
      case 'workqueue':  return <WorkQueue currentUser={currentUser!} />;
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
          <img src="/hermesai-logo-dark.svg" alt="HermesAI" style={{ height: '48px', marginBottom: '1.5rem', opacity: 0.8 }} />
          <div style={{ width: '32px', height: '32px', border: '3px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Enlace de recuperación abierto desde el correo
  if (recuperando && TOKENS_RECUPERACION) {
    return (
      <>
        <ResetPasswordView
          tokens={TOKENS_RECUPERACION}
          onDone={() => {
            setRecuperando(false);
            setCurrentUser(null);
          }}
        />
        <Toaster position="bottom-right" theme="dark" richColors closeButton />
      </>
    );
  }

  // Login
  if (!currentUser) {
    return (
      <>
        <LoginView onLogin={handleLogin} mensajeInicial={avisoLogin} />
        <Toaster position="bottom-right" theme="dark" richColors closeButton />
      </>
    );
  }

  // Segundo factor antes que nada: ni el cambio de clave obligatorio ni la
  // aplicación se pintan con la sesión a medias.
  if (estadoMfa !== 'ok') {
    return (
      <>
        <PuertaSegundoFactor estado={estadoMfa} onListo={comprobarMfa} onSalir={() => void handleLogout()} />
        <Toaster position="bottom-right" theme="dark" richColors closeButton />
      </>
    );
  }

  // Clave puesta por un administrador: no se usa el sistema hasta cambiarla.
  //
  // Se corta ANTES de pintar la aplicación, no encima de ella. Un modal sobre
  // el sistema ya cargado invita a buscarle la vuelta —y deja los datos a la
  // vista de quien conoce la clave temporal—; aquí sencillamente no hay
  // aplicación detrás todavía.
  if (currentUser.debeCambiarClave) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(180deg, #0f172a 0%, #0a0f1e 100%)',
      }}>
        <img src="/hermesai-logo-dark.svg" alt="HermesAI" style={{ height: '44px', opacity: 0.25 }} />
        <ChangePasswordModal
          user={currentUser}
          forced
          onLogout={handleLogout}
          onClose={() => setCurrentUser({ ...currentUser, debeCambiarClave: false })}
        />
        <Toaster position="bottom-right" theme="dark" richColors closeButton />
      </div>
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
        onShowSecurity={() => setShowSeguridad(true)}
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main className="flex-1 overflow-hidden">
        {renderContent()}
      </main>
      <Tutorial isOpen={showTutorial} onClose={() => setShowTutorial(false)} />
      {showChangePassword && (
        <ChangePasswordModal user={currentUser} onClose={() => setShowChangePassword(false)} onLogout={handleLogout} />
      )}
      {showSeguridad && <PanelSeguridad onClose={() => setShowSeguridad(false)} />}
      <Toaster position="bottom-right" theme="light" richColors closeButton />
    </div>
  );
}

export default App;