import React, { useState, useEffect, useRef } from 'react';
import { Zap, Shield, GitBranch, Bell, Activity } from 'lucide-react';
import { authService } from '../../core/auth.service.ts';
import type { User } from '../../core/user.types.ts';

interface LoginViewProps {
    onLogin: (user: User) => void;
}


export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
    const [email, setEmail]           = useState('');
    const [password, setPassword]     = useState('');
    const [error, setError]           = useState('');
    const [isLoading, setIsLoading]   = useState(false);
    const [lockoutSecs, setLockoutSecs] = useState(0);
    const [attempts, setAttempts]     = useState(0);
    const lockoutInterval             = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => { if (lockoutInterval.current) clearInterval(lockoutInterval.current); }, []);

    const formatTime = (secs: number) => {
        if (secs < 60) return `${secs}s`;
        const m = Math.floor(secs / 60), s = secs % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}min`;
    };

    const startLockoutTimer = (secs: number) => {
        setLockoutSecs(secs);
        if (lockoutInterval.current) clearInterval(lockoutInterval.current);
        lockoutInterval.current = setInterval(() => {
            setLockoutSecs(prev => {
                if (prev <= 1) { clearInterval(lockoutInterval.current!); return 0; }
                return prev - 1;
            });
        }, 1000);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) { setError('Ingrese correo y contraseña'); return; }
        if (lockoutSecs > 0) return;
        setIsLoading(true); setError('');
        try {
            const user = await authService.login(email, password);
            onLogin(user);
        } catch (err: any) {
            const msg: string = err.message || '';
            if (msg.startsWith('LOCKOUT:')) {
                const secs = parseInt(msg.split(':')[1], 10);
                startLockoutTimer(secs);
                setError(`Demasiados intentos. Espere ${formatTime(secs)}.`);
            } else {
                setAttempts(authService.getAttempts(email.trim().toLowerCase()));
                setError(msg);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const isLocked = lockoutSecs > 0;

    return (
        <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0a0f1e', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

            {/* Panel izquierdo — branding */}
            <div style={{
                display: 'none', flex: 1, flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                padding: '3rem', position: 'relative', overflow: 'hidden',
                background: 'linear-gradient(135deg, #0a0f1e 0%, #0f172a 50%, #1e1b4b 100%)',
            }} className="lg-left-panel">
                {/* Grid pattern */}
                <div style={{
                    position: 'absolute', inset: 0, opacity: 0.03,
                    backgroundImage: 'linear-gradient(#6366f1 1px, transparent 1px), linear-gradient(90deg, #6366f1 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                }} />
                {/* Glow */}
                <div style={{
                    position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
                    width: '400px', height: '400px', borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
                }} />

                <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '420px' }}>
                    <img src="/hermesai-logo.svg" alt="HermesAI" style={{ height: '56px', width: 'auto', marginBottom: '2.5rem', filter: 'drop-shadow(0 0 20px rgba(99,102,241,0.4))' }} />

                    <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.75rem', letterSpacing: '-0.025em' }}>
                        HermesAI Flow
                    </h1>
                    <p style={{ fontSize: '1rem', color: '#94a3b8', marginBottom: '3rem', lineHeight: 1.6 }}>
                        Hub central de automatización del ecosistema HermesAI
                    </p>

                    {/* Feature badges */}
                    {[
                        { icon: <GitBranch size={16} />, label: 'Flujos Visuales', desc: 'Diseño drag & drop' },
                        { icon: <Zap size={16} />,       label: 'Ejecución Automática', desc: 'Edge Functions + Cron' },
                        { icon: <Activity size={16} />,  label: '4 Sistemas Conectados', desc: 'RiskGuard · EE.FF. · Indicadores · LegalTech' },
                        { icon: <Bell size={16} />,      label: 'Alertas Inteligentes', desc: 'Email · WhatsApp · Umbrales' },
                    ].map(({ icon, label, desc }) => (
                        <div key={label} style={{
                            display: 'flex', alignItems: 'center', gap: '0.875rem',
                            padding: '0.875rem 1rem', marginBottom: '0.75rem',
                            background: 'rgba(255,255,255,0.04)', borderRadius: '12px',
                            border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left',
                        }}>
                            <div style={{ color: '#6366f1', flexShrink: 0 }}>{icon}</div>
                            <div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{desc}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Panel derecho — formulario */}
            <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                justifyContent: 'center', alignItems: 'center',
                padding: '2rem', minWidth: 0,
                background: 'linear-gradient(180deg, #0f172a 0%, #0a0f1e 100%)',
            }}>
                {/* Logo mobile */}
                <div style={{ marginBottom: '2rem', textAlign: 'center' }} className="lg-logo-hide">
                    <img src="/hermesai-logo.svg" alt="HermesAI" style={{ height: '44px', width: 'auto' }} />
                </div>

                <div style={{ width: '100%', maxWidth: '400px' }}>
                    <div style={{ marginBottom: '2rem' }}>
                        <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.4rem', letterSpacing: '-0.02em' }}>
                            Iniciar Sesión
                        </h2>
                        <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
                            Accede a tu hub de automatización
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                        {/* Email */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                                Correo electrónico
                            </label>
                            <input
                                type="email" value={email} onChange={e => setEmail(e.target.value)}
                                placeholder="usuario@empresa.com" disabled={isLoading || isLocked}
                                style={{
                                    width: '100%', padding: '0.875rem 1rem', borderRadius: '10px',
                                    border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.9rem',
                                    color: '#f1f5f9', backgroundColor: 'rgba(255,255,255,0.05)',
                                    outline: 'none', boxSizing: 'border-box',
                                }}
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                                Contraseña
                            </label>
                            <input
                                type="password" value={password} onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••" disabled={isLoading || isLocked}
                                style={{
                                    width: '100%', padding: '0.875rem 1rem', borderRadius: '10px',
                                    border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.9rem',
                                    color: '#f1f5f9', backgroundColor: 'rgba(255,255,255,0.05)',
                                    outline: 'none', boxSizing: 'border-box',
                                }}
                            />
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{
                                padding: '0.75rem 1rem', borderRadius: '10px',
                                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                                fontSize: '0.85rem', color: '#fca5a5',
                            }}>
                                {error}
                                {attempts > 0 && !isLocked && (
                                    <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '4px' }}>
                                        Intentos: {attempts}/{5}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Lockout */}
                        {isLocked && (
                            <div style={{
                                padding: '0.875rem 1rem', borderRadius: '10px', textAlign: 'center',
                                background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
                                fontSize: '0.9rem', fontWeight: 700, color: '#fcd34d',
                            }}>
                                Bloqueado — {formatTime(lockoutSecs)}
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit" disabled={isLoading || isLocked}
                            style={{
                                width: '100%', padding: '0.9rem', borderRadius: '10px', border: 'none',
                                background: isLocked ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                color: isLocked ? '#475569' : '#fff',
                                fontSize: '0.95rem', fontWeight: 700, cursor: isLoading || isLocked ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                transition: 'all 0.2s',
                                boxShadow: isLocked ? 'none' : '0 4px 15px rgba(99,102,241,0.3)',
                            }}
                        >
                            <Shield size={18} />
                            {isLoading ? 'Verificando...' : 'Ingresar al Sistema'}
                        </button>
                    </form>

                    <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: '#334155', textAlign: 'center' }}>
                        HermesAI Flow v1.0 — Acceso restringido a usuarios autorizados
                    </p>
                </div>
            </div>

            <style>{`
                @media (min-width: 1024px) {
                    .lg-left-panel { display: flex !important; }
                    .lg-logo-hide  { display: none !important; }
                }
            `}</style>
        </div>
    );
};
