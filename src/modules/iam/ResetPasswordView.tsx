import React, { useState } from 'react';
import { KeyRound, Loader2, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { authService, type TokensDeRecuperacion } from '../../core/auth.service.ts';

interface ResetPasswordViewProps {
    /** Los del hash del enlace. Solo en memoria: ver App.tsx. */
    tokens: TokensDeRecuperacion;
    /** Se llama al terminar, para volver al login. */
    onDone: () => void;
}

/**
 * Pantalla a la que llega quien pulsa el enlace del correo de recuperación.
 *
 * **El enlace no inicia sesión.** Llega con unos tokens en la URL que esta
 * aplicación no canjea al abrirse (`detectSessionInUrl: false`): se quedan en
 * memoria y solo valen para lo que se hace aquí. Al guardar la contraseña se
 * abre la sesión, se cambia la clave y se cierra en el mismo acto — se salga
 * bien o mal—, así que de este enlace nadie sale dentro del sistema.
 *
 * Es el punto entero de la función: si pulsar un enlace de correo bastara para
 * entrar, haber olvidado la contraseña dejaría de tener importancia y el correo
 * pasaría a ser la contraseña de todo el mundo.
 */
export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({ tokens, onDone }) => {
    const [next,    setNext]    = useState('');
    const [confirm, setConfirm] = useState('');
    const [show,    setShow]    = useState(false);
    const [saving,  setSaving]  = useState(false);
    const [done,    setDone]    = useState(false);
    const [error,   setError]   = useState('');

    const len8     = next.length >= 8;
    const hasNum   = /\d/.test(next);
    const hasUpper = /[A-Z]/.test(next);
    const match    = next.length > 0 && next === confirm;
    const valid    = len8 && hasNum && hasUpper && match;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid || saving) return;
        setSaving(true); setError('');
        try {
            // Abre la sesión con los tokens, cambia la clave y la cierra. El
            // cierre va dentro, en un `finally`: no puede depender de que esta
            // pantalla se acuerde de hacerlo.
            await authService.setNewPassword(tokens, next);
            setDone(true);
        } catch (err) {
            setError((err as Error)?.message ?? 'No se pudo establecer la contraseña.');
        } finally {
            setSaving(false);
        }
    };

    const campo: React.CSSProperties = {
        width: '100%', padding: '0.875rem 1rem', borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.9rem',
        color: '#f1f5f9', backgroundColor: 'rgba(255,255,255,0.05)',
        outline: 'none', boxSizing: 'border-box',
    };

    return (
        <div style={{
            display: 'flex', minHeight: '100vh', justifyContent: 'center', alignItems: 'center',
            padding: '2rem', fontFamily: 'system-ui, -apple-system, sans-serif',
            background: 'linear-gradient(180deg, #0f172a 0%, #0a0f1e 100%)',
        }}>
            <div style={{ width: '100%', maxWidth: '400px' }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <img src="/hermesai-logo-dark.svg" alt="HermesAI" style={{ height: '44px', width: 'auto' }} />
                </div>

                {done ? (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{
                            width: '56px', height: '56px', borderRadius: '16px', margin: '0 auto 1.25rem',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)',
                        }}>
                            <CheckCircle size={26} color="#34d399" />
                        </div>
                        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.5rem' }}>
                            Contraseña actualizada
                        </h2>
                        <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.75rem', lineHeight: 1.6 }}>
                            Ya puedes iniciar sesión con tu contraseña nueva.
                        </p>
                        <button
                            onClick={onDone}
                            style={{
                                width: '100%', padding: '0.9rem', borderRadius: '10px', border: 'none',
                                background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#fff',
                                fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
                                boxShadow: '0 4px 15px rgba(99,102,241,0.3)',
                            }}
                        >
                            Ir a iniciar sesión
                        </button>
                    </div>
                ) : (
                    <>
                        <div style={{ marginBottom: '1.75rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.4rem', letterSpacing: '-0.02em' }}>
                                Elige tu contraseña nueva
                            </h2>
                            <p style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.6 }}>
                                Este enlace solo sirve una vez. Al terminar, entrarás con la contraseña que definas aquí.
                            </p>
                        </div>

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                                    Nueva contraseña
                                </label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={show ? 'text' : 'password'} value={next} onChange={e => setNext(e.target.value)}
                                        placeholder="Mínimo 8 caracteres" autoComplete="new-password" disabled={saving}
                                        style={{ ...campo, paddingRight: '2.5rem' }}
                                    />
                                    <button type="button" onClick={() => setShow(s => !s)}
                                        style={{
                                            position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                                            background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0,
                                            display: 'flex',
                                        }}>
                                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                                    Confirmar contraseña
                                </label>
                                <input
                                    type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                                    placeholder="Repite la contraseña" autoComplete="new-password" disabled={saving}
                                    style={campo}
                                />
                            </div>

                            <div style={{
                                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                                borderRadius: '10px', padding: '0.75rem 1rem',
                            }}>
                                {[
                                    { ok: len8,     label: 'Al menos 8 caracteres' },
                                    { ok: hasUpper, label: 'Una letra mayúscula' },
                                    { ok: hasNum,   label: 'Un número' },
                                    { ok: match,    label: 'Las contraseñas coinciden' },
                                ].map(({ ok, label }) => (
                                    <div key={label} style={{
                                        display: 'flex', alignItems: 'center', gap: '6px',
                                        fontSize: '0.72rem', marginBottom: '3px',
                                        color: ok ? '#34d399' : '#475569',
                                    }}>
                                        <CheckCircle size={11} style={{ opacity: ok ? 1 : 0.35 }} /> {label}
                                    </div>
                                ))}
                            </div>

                            {error && (
                                <div style={{
                                    padding: '0.75rem 1rem', borderRadius: '10px',
                                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                                    fontSize: '0.85rem', color: '#fca5a5',
                                }}>
                                    {error}
                                    <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '4px' }}>
                                        Si el enlace ha caducado, pide uno nuevo desde «¿Olvidaste tu contraseña?».
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit" disabled={!valid || saving}
                                style={{
                                    width: '100%', padding: '0.9rem', borderRadius: '10px', border: 'none',
                                    background: !valid || saving ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                    color: !valid || saving ? '#475569' : '#fff',
                                    fontSize: '0.95rem', fontWeight: 700,
                                    cursor: !valid || saving ? 'default' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                    boxShadow: !valid || saving ? 'none' : '0 4px 15px rgba(99,102,241,0.3)',
                                }}
                            >
                                {saving ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                                {saving ? 'Guardando...' : 'Guardar contraseña'}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};
