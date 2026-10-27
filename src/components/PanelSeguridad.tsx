import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, X, Monitor, LogOut, Loader2, Smartphone } from 'lucide-react';
import { mfaService, CADUCIDAD_MFA_HORAS, type FactorMfa } from '../core/mfa';
import { sesionesService, type SesionAbierta } from '../services/sesiones.service';
import { politicasSeguridadService, type PoliticaSeguridad } from '../services/politicasSeguridad.service';
import { fechaHoraVE, horaVE } from '../utils/fecha';

const fecha = (iso: string) => fechaHoraVE(iso, { dateStyle: 'short', timeStyle: 'short' });
const hora  = (ms: number)  => horaVE(ms, { hour: '2-digit', minute: '2-digit' });

/**
 * Seguridad de la cuenta (27/10/2026, portado de RiskGuard): el dispositivo del
 * segundo factor y las sesiones abiertas, con la actual marcada, para cerrar
 * las que no se reconozcan. Al administrador de la plataforma le enseña además
 * el interruptor que decide si el alta del segundo factor es obligatoria.
 * Se abre desde el Sidebar. Las horas, en hora de Venezuela (§9.3).
 */
export function PanelSeguridad({ onClose }: { onClose: () => void }) {
    const [factores, setFactores] = useState<FactorMfa[]>([]);
    const [caduca, setCaduca] = useState<number | null>(null);
    const [sesiones, setSesiones] = useState<SesionAbierta[]>([]);
    const [politica, setPolitica] = useState<PoliticaSeguridad | null>(null);
    const [cargando, setCargando] = useState(true);
    const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

    useEffect(() => {
        const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', alPulsar);
        return () => window.removeEventListener('keydown', alPulsar);
    }, [onClose]);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const [f, c, s] = await Promise.all([
                mfaService.factoresVerificados(),
                mfaService.caducaA(),
                sesionesService.listar(),
            ]);
            setFactores(f);
            setCaduca(c);
            setSesiones(s);
        } catch (err) {
            setMsg({ ok: false, texto: err instanceof Error ? err.message : 'No se pudo cargar la seguridad de la cuenta.' });
        } finally {
            setCargando(false);
        }
    }, []);

    // Aparte: si falla, el resto del panel se ve igual.
    const cargarPolitica = useCallback(async () => {
        if (!(await politicasSeguridadService.esAdminPlataforma())) return;
        try {
            setPolitica(await politicasSeguridadService.leer());
        } catch (err) {
            setMsg({ ok: false, texto: err instanceof Error ? err.message : 'No se pudo leer la política de seguridad.' });
        }
    }, []);

    useEffect(() => { void cargar(); void cargarPolitica(); }, [cargar, cargarPolitica]);

    const cambiarExigirMfa = async () => {
        if (!politica) return;
        const exigir = !politica.exigirMfa;
        if (!exigir && !confirm(
            '¿Dejar de exigir la verificación en dos pasos en toda la plataforma?\n\n' +
            'Quien no tenga dispositivo entrará solo con la contraseña y verá los datos de su organización. ' +
            'Quien ya lo tenga seguirá pidiéndolo.'
        )) return;
        setMsg(null);
        setCargando(true);
        try {
            await politicasSeguridadService.cambiarExigirMfa(exigir);
            setPolitica(await politicasSeguridadService.leer());
            setMsg({
                ok: true,
                texto: exigir
                    ? 'Exigida. Quien no tenga dispositivo tendrá que darlo de alta al volver a entrar.'
                    : 'Ya no se exige. Cuenta desde el próximo inicio de sesión de cada usuario.',
            });
        } catch (err) {
            setMsg({ ok: false, texto: err instanceof Error ? err.message : 'No se pudo cambiar la política de seguridad.' });
        } finally {
            setCargando(false);
        }
    };

    const cerrar = async (ids?: string[]) => {
        setMsg(null);
        setCargando(true);
        try {
            const n = await sesionesService.cerrar(ids);
            setMsg({ ok: true, texto: n === 1 ? 'Sesión cerrada.' : `${n} sesiones cerradas.` });
            await cargar();
        } catch (err) {
            setMsg({ ok: false, texto: err instanceof Error ? err.message : 'No se pudieron cerrar las sesiones.' });
            setCargando(false);
        }
    };

    const otras = sesiones.filter(s => !s.actual).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
                            <ShieldCheck size={18} className="text-indigo-600" />
                        </div>
                        <h2 className="text-lg font-black text-slate-900">Seguridad de la cuenta</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={18} />
                    </button>
                </div>

                <section className="mb-6">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Verificación en dos pasos</h3>
                    {factores.map(f => (
                        <div key={f.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl mb-2">
                            <Smartphone size={16} className="text-slate-400" />
                            <div>
                                <p className="text-sm font-bold text-slate-900">{f.nombre}</p>
                                <p className="text-xs text-slate-500">Activo desde {fecha(f.creado)}</p>
                            </div>
                        </div>
                    ))}
                    {!cargando && factores.length === 0 ? (
                        <p className="text-xs text-slate-500">
                            No tienes la verificación en dos pasos activada: entras solo con la contraseña.
                        </p>
                    ) : (
                        <p className="text-xs text-slate-500">
                            La verificación vale {CADUCIDAD_MFA_HORAS} horas
                            {caduca !== null && <> — en esta sesión, hasta las <strong>{hora(caduca)}</strong> (hora de Venezuela)</>}.
                            Después se vuelve a pedir la contraseña y el código.
                        </p>
                    )}
                </section>

                {politica && (
                    <section className="mb-6">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Política de la plataforma</h3>
                        <div className="flex items-center justify-between gap-3 p-3 border border-slate-200 rounded-xl">
                            <div>
                                <p className="text-sm font-bold text-slate-900">Exigir la verificación en dos pasos</p>
                                <p className="text-xs text-slate-500">
                                    {politica.exigirMfa
                                        ? 'Quien no tiene dispositivo no entra hasta darlo de alta.'
                                        : 'Quien no tiene dispositivo entra solo con la contraseña.'}
                                    {' '}Cambiada el {fecha(politica.actualizada)}.
                                </p>
                            </div>
                            <button
                                role="switch"
                                aria-checked={politica.exigirMfa}
                                onClick={cambiarExigirMfa}
                                disabled={cargando}
                                className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-60 ${politica.exigirMfa ? 'bg-emerald-500' : 'bg-slate-300'}`}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${politica.exigirMfa ? 'translate-x-5' : ''}`} />
                            </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                            Vale para todas las organizaciones. Quien ya tiene dispositivo sigue pidiéndolo siempre.
                        </p>
                    </section>
                )}

                <section>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sesiones abiertas</h3>
                        {otras > 0 && (
                            <button
                                onClick={() => cerrar()}
                                disabled={cargando}
                                className="flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg disabled:opacity-60"
                            >
                                <LogOut size={13} /> Cerrar todas las demás
                            </button>
                        )}
                    </div>

                    {cargando && sesiones.length === 0 ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="animate-spin text-slate-400" size={22} />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {sesiones.map(s => (
                                <div key={s.id} className="flex items-center justify-between gap-3 p-3 border border-slate-200 rounded-xl">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Monitor size={16} className="text-slate-400 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-slate-900">
                                                {s.navegador}
                                                {s.actual && (
                                                    <span className="ml-2 text-[10px] font-black text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">
                                                        Esta sesión
                                                    </span>
                                                )}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                {s.ip ?? 'IP desconocida'} · desde {fecha(s.creada)} · último uso {fecha(s.ultimoUso)}
                                                {s.nivel !== 'aal2' && ' · sin segundo factor'}
                                            </p>
                                        </div>
                                    </div>
                                    {!s.actual && (
                                        <button
                                            onClick={() => cerrar([s.id])}
                                            disabled={cargando}
                                            className="text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg shrink-0 disabled:opacity-60"
                                        >
                                            Cerrar
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {otras > 0 && (
                        <p className="text-xs text-slate-500 mt-3">
                            Si no reconoces una sesión, ciérrala y cambia tu contraseña.
                        </p>
                    )}
                </section>

                {msg && (
                    <p className={`text-xs font-semibold px-3 py-2 rounded-lg mt-4 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                        {msg.texto}
                    </p>
                )}
            </div>
        </div>
    );
}
