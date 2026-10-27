import { useState, type ReactNode } from 'react';
import { ShieldCheck, AlertCircle, Loader2, Copy, Check } from 'lucide-react';
import { mfaService, type AltaMfa } from '../core/mfa';

// ============================================================================
// Puerta del segundo factor — 27/10/2026 (/blindar-seguridad, paso 3)
// ============================================================================
//
// Portada de RiskGuard (`src/components/SegundoFactor.tsx`). App.tsx la pinta
// en lugar de la aplicación mientras la sesión no esté en `aal2` (o sin factor
// con la exigencia apagada). Es onboarding, no control de acceso: lo que
// protege los datos es `mfa_satisfecho()` en la base. Mismo estilo oscuro que
// el login.

const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' };
const botonStyle = { background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#ffffff' };

export function Marco({ titulo, subtitulo, children }: { titulo: string; subtitulo: ReactNode; children: ReactNode }) {
    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0a0f1e' }}>
            <div className="w-full max-w-sm">
                <div className="flex flex-col items-center mb-8">
                    <img src="/hermesai-logo-dark.svg" alt="HermesAI" className="h-10 w-auto object-contain" />
                    <p className="text-slate-500 text-[9px] font-bold uppercase tracking-[0.2em] mt-1">HermesAI Flow</p>
                </div>
                <div className="mb-6">
                    <h1 className="text-2xl font-black text-white mb-1 flex items-center gap-2">
                        <ShieldCheck size={22} className="text-indigo-400" /> {titulo}
                    </h1>
                    <p className="text-slate-500 text-sm leading-relaxed">{subtitulo}</p>
                </div>
                {children}
            </div>
        </div>
    );
}

function MensajeError({ mensaje }: { mensaje: string }) {
    return (
        <div className="flex items-start gap-3 p-4 rounded-xl"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="text-rose-400 flex-shrink-0 mt-0.5" size={16} />
            <p className="text-rose-400 text-xs font-medium leading-relaxed">{mensaje}</p>
        </div>
    );
}

interface FormularioCodigoProps {
    /** Comprueba el código; si lanza, el mensaje se enseña bajo el campo. */
    onVerificar: (codigo: string) => Promise<void>;
    textoBoton:  string;
    onSalir:     () => void;
    textoSalir:  string;
}

/** Campo de 6 dígitos de la aplicación autenticadora. También lo usa la recuperación de contraseña. */
export function FormularioCodigo({ onVerificar, textoBoton, onSalir, textoSalir }: FormularioCodigoProps) {
    const [codigo, setCodigo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(codigo)) { setError('Escribe los 6 dígitos que muestra tu aplicación.'); return; }
        setEnviando(true);
        setError('');
        try {
            await onVerificar(codigo);
        } catch (err) {
            setCodigo('');
            setError(err instanceof Error && err.message ? err.message : 'No se pudo verificar el código.');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Código de 6 dígitos</label>
                <input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={codigo}
                    onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-3.5 rounded-xl text-white placeholder-slate-600 text-center text-xl font-black tracking-[0.5em] outline-none"
                    style={inputStyle}
                    placeholder="000000"
                />
            </div>

            {error && <MensajeError mensaje={error} />}

            <button
                type="submit"
                disabled={enviando}
                className="w-full py-4 font-black rounded-xl text-sm uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-60"
                style={botonStyle}
            >
                {enviando ? <><Loader2 className="animate-spin" size={16} /> Verificando...</> : textoBoton}
            </button>

            <p className="text-center text-xs">
                <button type="button" onClick={onSalir} disabled={enviando}
                    className="text-slate-400 hover:text-indigo-400 font-bold">
                    {textoSalir}
                </button>
            </p>
        </form>
    );
}

interface PasoProps {
    onListo: () => Promise<void>;
    onSalir: () => void;
}

function VerificarSegundoFactor({ onListo, onSalir }: PasoProps) {
    return (
        <Marco
            titulo="Verificación en dos pasos"
            subtitulo="Abre tu aplicación autenticadora y escribe el código de HermesAI Flow."
        >
            <FormularioCodigo
                onVerificar={async codigo => { await mfaService.verificar(codigo); await onListo(); }}
                textoBoton="Entrar"
                onSalir={onSalir}
                textoSalir="Volver al inicio de sesión"
            />
            <p className="text-slate-600 text-[11px] leading-relaxed mt-6 text-center">
                Si perdiste el dispositivo, avisa a un administrador de HermesAI Flow: puede quitarte el anterior para que des de alta uno nuevo.
            </p>
        </Marco>
    );
}

function AltaSegundoFactor({ onListo, onSalir }: PasoProps) {
    const [nombre, setNombre] = useState('Teléfono');
    const [alta, setAlta] = useState<AltaMfa | null>(null);
    const [preparando, setPreparando] = useState(false);
    const [error, setError] = useState('');
    const [copiado, setCopiado] = useState(false);

    const empezar = async (e: React.FormEvent) => {
        e.preventDefault();
        setPreparando(true);
        setError('');
        try {
            setAlta(await mfaService.iniciarAlta(nombre));
        } catch (err) {
            setError(err instanceof Error && err.message ? err.message : 'No se pudo iniciar el alta.');
        } finally {
            setPreparando(false);
        }
    };

    // Un alta a medias se descarta: si no, se queda en auth.mfa_factors y el
    // siguiente intento choca por el nombre del dispositivo.
    const abandonar = async () => {
        if (alta) await mfaService.descartarAlta(alta.factorId);
        onSalir();
    };

    const copiar = async () => {
        if (!alta) return;
        try {
            await navigator.clipboard.writeText(alta.secreto);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
        } catch { /* sin portapapeles: el secreto está a la vista */ }
    };

    if (!alta) {
        return (
            <Marco
                titulo="Activa la verificación en dos pasos"
                subtitulo={<>HermesAI Flow la exige a todos los usuarios. Necesitas una aplicación autenticadora en el teléfono (Google Authenticator, Microsoft Authenticator, Authy…).</>}
            >
                <form onSubmit={empezar} className="space-y-5">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nombre del dispositivo</label>
                        <input
                            value={nombre}
                            onChange={e => setNombre(e.target.value)}
                            maxLength={40}
                            className="w-full px-4 py-3.5 rounded-xl text-white placeholder-slate-600 text-sm font-medium outline-none"
                            style={inputStyle}
                            placeholder="Teléfono"
                        />
                    </div>
                    {error && <MensajeError mensaje={error} />}
                    <button
                        type="submit"
                        disabled={preparando}
                        className="w-full py-4 font-black rounded-xl text-sm uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-60"
                        style={botonStyle}
                    >
                        {preparando ? <><Loader2 className="animate-spin" size={16} /> Preparando...</> : 'Continuar'}
                    </button>
                    <p className="text-center text-xs">
                        <button type="button" onClick={onSalir} disabled={preparando}
                            className="text-slate-400 hover:text-indigo-400 font-bold">
                            Cerrar sesión
                        </button>
                    </p>
                </form>
            </Marco>
        );
    }

    return (
        <Marco
            titulo="Escanea el código"
            subtitulo="Con la aplicación autenticadora, escanea el QR y escribe el código que te muestre."
        >
            <div className="flex justify-center mb-4">
                <img src={alta.qr} alt="Código QR para la aplicación autenticadora" className="w-44 h-44 bg-white rounded-xl p-2" />
            </div>
            <div className="mb-6">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">¿No puedes escanear? Escribe esta clave</p>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={inputStyle}>
                    <code className="flex-1 text-xs text-slate-300 break-all font-mono">{alta.secreto}</code>
                    <button type="button" onClick={copiar} className="text-slate-500 hover:text-indigo-400 shrink-0" title="Copiar">
                        {copiado ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                </div>
            </div>
            <FormularioCodigo
                onVerificar={async codigo => { await mfaService.confirmarAlta(alta.factorId, codigo); await onListo(); }}
                textoBoton="Activar y entrar"
                onSalir={abandonar}
                textoSalir="Cancelar y cerrar sesión"
            />
        </Marco>
    );
}

/** `cargando` = aún se está preguntando; `error` = no se pudo preguntar. */
export type EstadoPuerta = 'alta' | 'verificar' | 'cargando' | 'error';

interface PuertaSegundoFactorProps {
    estado:  EstadoPuerta;
    /** Vuelve a calcular el estado; se llama tras verificar o al reintentar. */
    onListo: () => Promise<void>;
    onSalir: () => void;
}

export function PuertaSegundoFactor({ estado, onListo, onSalir }: PuertaSegundoFactorProps) {
    if (estado === 'alta') return <AltaSegundoFactor onListo={onListo} onSalir={onSalir} />;
    if (estado === 'verificar') return <VerificarSegundoFactor onListo={onListo} onSalir={onSalir} />;
    if (estado === 'error') {
        return (
            <Marco titulo="Verificación en dos pasos" subtitulo="No se pudo comprobar el estado de tu segundo factor.">
                <div className="space-y-3">
                    <button type="button" onClick={() => void onListo()}
                        className="w-full py-4 font-black rounded-xl text-sm uppercase tracking-widest" style={botonStyle}>
                        Reintentar
                    </button>
                    <p className="text-center text-xs">
                        <button type="button" onClick={onSalir} className="text-slate-400 hover:text-indigo-400 font-bold">
                            Volver al inicio de sesión
                        </button>
                    </p>
                </div>
            </Marco>
        );
    }
    return (
        <div className="flex items-center justify-center min-h-screen" style={{ background: '#0a0f1e' }}>
            <Loader2 className="animate-spin text-indigo-400" size={28} />
        </div>
    );
}
