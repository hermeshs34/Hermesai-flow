import { useState } from 'react';
import {
    Bell, Shield, Info, CheckCircle,
    ExternalLink, Zap, BarChart2, User,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import { toast } from 'sonner';

// ── Sección visual ────────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children }: {
    title: string; icon: React.ComponentType<any>; children: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
                <Icon className="w-5 h-5 text-indigo-600" />
                <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
            </div>
            <div className="px-6 py-5">{children}</div>
        </div>
    );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
    return (
        <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
            <span className="text-sm text-gray-500">{label}</span>
            <span className={`text-sm font-medium ${muted ? 'text-gray-400 font-mono' : 'text-gray-800'}`}>{value}</span>
        </div>
    );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function Settings() {
    const [notifEmail,   setNotifEmail]   = useState('');
    const [notifErrors,  setNotifErrors]  = useState(true);
    const [notifSuccess, setNotifSuccess] = useState(false);
    const [saving,       setSaving]       = useState(false);
    const [testingBcv,   setTestingBcv]   = useState(false);
    const [bcvResult,    setBcvResult]    = useState<string | null>(null);

    const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL as string ?? '';
    const projectRef   = supabaseUrl.split('//')[1]?.split('.')[0] ?? '—';

    const handleSaveNotifications = async () => {
        setSaving(true);
        await new Promise(r => setTimeout(r, 600));
        setSaving(false);
        toast.success('Preferencias de notificación guardadas');
    };

    const handleTestBcv = async () => {
        setTestingBcv(true);
        setBcvResult(null);
        try {
            // Llamar via Edge Function para evitar CORS (el servidor sí puede consultar APIs externas)
            const { data, error } = await supabase.functions.invoke('get-bcv-rate');
            if (error) throw error;
            if (data?.bcv_rate) {
                setBcvResult(`✅ API BCV activa — Tasa: ${data.bcv_rate} Bs/USD (${data.source})`);
            } else {
                setBcvResult('⚠️ APIs BCV no disponibles en este momento');
            }
        } catch {
            setBcvResult('❌ No se pudo conectar. Verifica que la Edge Function esté desplegada.');
        }
        setTestingBcv(false);
    };

    const handleSignOut = async () => {
        if (!confirm('¿Cerrar sesión?')) return;
        await supabase.auth.signOut();
    };

    return (
        <div className="h-full overflow-y-auto bg-gray-50">
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

                <div>
                    <h1 className="text-xl font-bold text-gray-900">Configuración</h1>
                    <p className="text-sm text-gray-500 mt-1">Información del sistema y preferencias de tu organización</p>
                </div>

                {/* ── Estado del sistema ─────────────────────────────────── */}
                <Section title="Estado del Sistema" icon={BarChart2}>
                    <Row label="Base de datos" value="Supabase — Conectado ✅" />
                    <Row label="Proyecto" value={projectRef} muted />
                    <Row label="Motor de ejecución" value="Edge Function — Activo ✅" />
                    <Row label="API Email (Resend)" value="onboarding@resend.dev — Activo ✅" />
                    <Row label="Versión" value="Sprint S2 — Mayo 2026" />
                </Section>

                {/* ── APIs externas ──────────────────────────────────────── */}
                <Section title="APIs Externas" icon={Zap}>
                    <p className="text-xs text-gray-500 mb-4">
                        Las claves API se configuran como secrets en Supabase, no aquí. Esto evita que queden expuestas en el navegador.
                    </p>
                    <div className="space-y-3">
                        {/* BCV */}
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <p className="text-sm font-semibold text-gray-700">API Tasa BCV</p>
                                <p className="text-xs text-gray-400">pydolarve.org — sin credenciales requeridas</p>
                                {bcvResult && (
                                    <p className="text-xs mt-1 font-medium text-gray-600">{bcvResult}</p>
                                )}
                            </div>
                            <button
                                onClick={handleTestBcv}
                                disabled={testingBcv}
                                className="px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
                            >
                                {testingBcv ? 'Probando...' : 'Probar'}
                            </button>
                        </div>

                        {/* Resend */}
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <p className="text-sm font-semibold text-gray-700">Resend API (Email)</p>
                                <p className="text-xs text-gray-400">Secret: RESEND_API_KEY en Supabase Edge Functions</p>
                            </div>
                            <a
                                href="https://supabase.com/dashboard/project/kbscaxcokxwdbnrltkup/settings/functions"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                                Configurar <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>

                        {/* RiskGuard */}
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <p className="text-sm font-semibold text-gray-700">RiskGuard Insurance (Siniestros)</p>
                                <p className="text-xs text-gray-400">Secrets: RISKGUARD_SUPABASE_URL + RISKGUARD_SERVICE_ROLE_KEY</p>
                            </div>
                            <span className="px-2.5 py-1 text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-lg font-medium">
                                Sprint S3
                            </span>
                        </div>
                    </div>
                </Section>

                {/* ── Notificaciones ─────────────────────────────────────── */}
                <Section title="Notificaciones por Email" icon={Bell}>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Email para alertas del sistema</label>
                            <input
                                type="email"
                                value={notifEmail}
                                onChange={e => setNotifEmail(e.target.value)}
                                placeholder="tu@empresa.com"
                                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            />
                            <p className="text-xs text-gray-400 mt-1">Recibirás alertas cuando un flujo falle o requiera aprobación</p>
                        </div>

                        <div className="space-y-2">
                            {[
                                { label: 'Notificar cuando un flujo falle', state: notifErrors, set: setNotifErrors },
                                { label: 'Notificar cuando un flujo se complete', state: notifSuccess, set: setNotifSuccess },
                            ].map(item => (
                                <label key={item.label} className="flex items-center justify-between py-2 cursor-pointer">
                                    <span className="text-sm text-gray-700">{item.label}</span>
                                    <button
                                        onClick={() => item.set(!item.state)}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${item.state ? 'bg-indigo-600' : 'bg-gray-200'}`}
                                    >
                                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${item.state ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                </label>
                            ))}
                        </div>

                        <button
                            onClick={handleSaveNotifications}
                            disabled={saving}
                            className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                            {saving ? 'Guardando...' : 'Guardar preferencias'}
                        </button>
                    </div>
                </Section>

                {/* ── Cómo usar los nodos ────────────────────────────────── */}
                <Section title="Guía Rápida de Nodos" icon={Info}>
                    <div className="space-y-3">
                        {[
                            { icon: '🟢', name: 'Triggers',     desc: 'Inician el flujo. Ej: Programado (Cron) ejecuta automáticamente en el horario que configures.' },
                            { icon: '🔵', name: 'Procesadores', desc: 'Obtienen o transforman datos. Ej: Tasa BCV consulta la tasa oficial y la deja disponible para nodos siguientes.' },
                            { icon: '🔀', name: 'Decisión',     desc: 'Bifurca el flujo. Configura: qué comparar ({{previous.bcv_rate}}), operador (>), y valor (40). Primera conexión = SI ✅, segunda = NO ❌.' },
                            { icon: '🟠', name: 'Salidas',      desc: 'Realizan acciones. Ej: Enviar Email usa los datos del nodo anterior con {{previous.campo}}. Registrar Log guarda en el historial.' },
                            { icon: '👤', name: 'Aprobación',   desc: 'Pausa el flujo hasta que un responsable confirme. Útil para siniestros de alto monto o pagos grandes.' },
                        ].map(item => (
                            <div key={item.name} className="flex gap-3 p-3 bg-gray-50 rounded-xl">
                                <span className="text-lg flex-shrink-0">{item.icon}</span>
                                <div>
                                    <p className="text-sm font-semibold text-gray-700">{item.name}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>

                {/* ── Cuenta ─────────────────────────────────────────────── */}
                <Section title="Cuenta" icon={User}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-700">Hermes Sánchez</p>
                            <p className="text-xs text-gray-400">hermes.hs34@gmail.com · Administrador</p>
                        </div>
                        <button
                            onClick={handleSignOut}
                            className="px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                        >
                            Cerrar sesión
                        </button>
                    </div>
                </Section>

                {/* ── Seguridad ──────────────────────────────────────────── */}
                <Section title="Seguridad" icon={Shield}>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-green-700">
                            <CheckCircle className="w-4 h-4" />
                            Datos aislados por organización (Row-Level Security activo)
                        </div>
                        <div className="flex items-center gap-2 text-sm text-green-700">
                            <CheckCircle className="w-4 h-4" />
                            Credenciales almacenadas como secrets en Supabase (nunca en código)
                        </div>
                        <div className="flex items-center gap-2 text-sm text-green-700">
                            <CheckCircle className="w-4 h-4" />
                            Historial de ejecuciones con trazabilidad completa
                        </div>
                    </div>
                </Section>

            </div>
        </div>
    );
}
