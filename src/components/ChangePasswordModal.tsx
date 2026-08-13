import { useState } from 'react';
import { KeyRound, X, Loader2, Eye, EyeOff, CheckCircle, ShieldAlert } from 'lucide-react';
import { authService } from '../core/auth.service';
import { GovernanceService } from '../services/governance.service';
import type { User } from '../core/user.types';
import { toast } from 'sonner';

interface ChangePasswordModalProps {
    user:    User;
    onClose: () => void;
    /**
     * Cambio obligatorio: la clave vigente se la puso un administrador.
     *
     * Mientras siga puesta, la cuenta tiene dos dueños, así que el modal no se
     * puede cerrar ni esquivar — ni con la X, ni pulsando fuera, ni cancelando.
     * Quien no quiera cambiarla todavía tiene la salida honesta: cerrar sesión.
     */
    forced?: boolean;
    /** Salida en modo obligatorio: si no cambias la clave, sales. */
    onLogout?: () => void;
}

export function ChangePasswordModal({ user, onClose, forced = false, onLogout }: ChangePasswordModalProps) {
    const [current, setCurrent] = useState('');
    const [next,    setNext]    = useState('');
    const [confirm, setConfirm] = useState('');
    const [show,    setShow]    = useState(false);
    const [saving,  setSaving]  = useState(false);
    const [done,    setDone]    = useState(false);

    // Validaciones visuales
    const len8     = next.length >= 8;
    const hasNum   = /\d/.test(next);
    const hasUpper = /[A-Z]/.test(next);
    const match    = next.length > 0 && next === confirm;
    const valid    = len8 && hasNum && hasUpper && match && current.length > 0;

    const handleSave = async () => {
        if (!valid) return;
        setSaving(true);
        try {
            await authService.changePassword(user.email, current, next);
            await GovernanceService.log(user, 'modificar', 'usuario', {
                entidadId: user.id, descripcion: 'Cambió su propia contraseña',
            });
            setDone(true);
            toast.success('Contraseña actualizada correctamente');
        } catch (e) {
            toast.error((e as Error)?.message ?? 'No se pudo cambiar la contraseña');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => !saving && !forced && onClose()}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className={`px-5 py-4 border-b flex items-center justify-between ${forced ? 'border-amber-100 bg-amber-50/70' : 'border-gray-100 bg-gray-50/60'}`}>
                    <div className="flex items-center gap-2">
                        {forced
                            ? <ShieldAlert className="w-4 h-4 text-amber-600" />
                            : <KeyRound className="w-4 h-4 text-indigo-600" />}
                        <h3 className="font-semibold text-gray-800 text-sm">
                            {forced ? 'Debes cambiar tu contraseña' : 'Cambiar mi contraseña'}
                        </h3>
                    </div>
                    {/* Sin X en modo obligatorio: no hay forma de esquivarlo. */}
                    {!forced && (
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                    )}
                </div>

                {done ? (
                    <div className="p-6 text-center space-y-3">
                        <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto">
                            <CheckCircle className="w-6 h-6 text-emerald-500" />
                        </div>
                        <p className="text-sm font-semibold text-gray-800">Contraseña actualizada</p>
                        <p className="text-xs text-gray-500">
                            {forced
                                ? 'La clave que te dio el administrador ya no sirve. A partir de ahora solo la conoces tú.'
                                : 'Usa tu nueva contraseña la próxima vez que inicies sesión.'}
                        </p>
                        <button onClick={onClose} className="w-full mt-2 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                            {forced ? 'Continuar' : 'Listo'}
                        </button>
                    </div>
                ) : (
                    <div className="p-5 space-y-4">
                        {forced && (
                            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
                                Tu contraseña actual la generó un administrador porque la habías olvidado, así que
                                <strong> hay otra persona que la conoce</strong>. Elige una nueva para seguir.
                            </div>
                        )}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Contraseña actual</label>
                            <input type={show ? 'text' : 'password'} value={current} onChange={e => setCurrent(e.target.value)}
                                placeholder="Tu clave temporal o actual" autoComplete="current-password"
                                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Nueva contraseña</label>
                            <div className="relative">
                                <input type={show ? 'text' : 'password'} value={next} onChange={e => setNext(e.target.value)}
                                    placeholder="Mínimo 8 caracteres" autoComplete="new-password"
                                    className="w-full text-sm px-3 py-2 pr-9 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                                <button type="button" onClick={() => setShow(s => !s)}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Confirmar nueva contraseña</label>
                            <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                                placeholder="Repite la nueva contraseña" autoComplete="new-password"
                                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>

                        {/* Requisitos */}
                        <div className="bg-gray-50 rounded-lg px-3 py-2.5 space-y-1">
                            {[
                                { ok: len8,     label: 'Al menos 8 caracteres' },
                                { ok: hasUpper, label: 'Una letra mayúscula' },
                                { ok: hasNum,   label: 'Un número' },
                                { ok: match,    label: 'Las contraseñas coinciden' },
                            ].map(({ ok, label }) => (
                                <div key={label} className={`flex items-center gap-1.5 text-[11px] ${ok ? 'text-emerald-600' : 'text-gray-400'}`}>
                                    <CheckCircle className={`w-3 h-3 ${ok ? 'opacity-100' : 'opacity-30'}`} /> {label}
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-2 pt-1">
                            {/* En modo obligatorio no se cancela: la única salida es salir. */}
                            <button onClick={forced ? onLogout : onClose} disabled={saving}
                                className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                                {forced ? 'Cerrar sesión' : 'Cancelar'}
                            </button>
                            <button onClick={handleSave} disabled={!valid || saving}
                                className="flex-1 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center gap-2">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                                {saving ? 'Guardando...' : 'Cambiar'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
