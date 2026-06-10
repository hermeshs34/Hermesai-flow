import { useState, useEffect } from 'react';
import {
    Bell, Shield, Info, CheckCircle,
    ExternalLink, Zap, BarChart2, User,
} from 'lucide-react';
import { supabase } from '../core/supabase';
import { authService } from '../core/auth.service';
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
    const [savingKpi,    setSavingKpi]    = useState(false);
    const [testingBcv,   setTestingBcv]   = useState(false);
    const [bcvResult,    setBcvResult]    = useState<string | null>(null);

    // KPI params
    const [kpiSlaMs,        setKpiSlaMs]       = useState(30000);
    const [kpiMinTarea,     setKpiMinTarea]     = useState(15);
    const [kpiCostoHora,    setKpiCostoHora]    = useState(25);

    const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL as string ?? '';
    const projectRef   = supabaseUrl.split('//')[1]?.split('.')[0] ?? '—';

    // Cargar preferencias al montar
    useEffect(() => {
        const user = authService.getCurrentUser();
        if (!user?.organizationId) return;
        supabase
            .from('organizations')
            .select('notif_email, notif_errors, notif_success, kpi_sla_ms, kpi_min_por_tarea, kpi_costo_hora_usd')
            .eq('id', user.organizationId)
            .single()
            .then(({ data }) => {
                if (data) {
                    setNotifEmail(data.notif_email ?? '');
                    setNotifErrors(data.notif_errors ?? true);
                    setNotifSuccess(data.notif_success ?? false);
                    setKpiSlaMs(data.kpi_sla_ms ?? 30000);
                    setKpiMinTarea(data.kpi_min_por_tarea ?? 15);
                    setKpiCostoHora(data.kpi_costo_hora_usd ?? 25);
                }
            });
    }, []);

    const handleSaveNotifications = async () => {
        setSaving(true);
        try {
            const user = authService.getCurrentUser();
            if (!user?.organizationId) throw new Error('Sin organización');
            const { error } = await supabase
                .from('organizations')
                .update({
                    notif_email:   notifEmail || null,
                    notif_errors:  notifErrors,
                    notif_success: notifSuccess,
                })
                .eq('id', user.organizationId);
            if (error) throw new Error(error.message);
            toast.success('Preferencias de notificación guardadas');
        } catch (err: any) {
            toast.error(`Error al guardar: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveKpi = async () => {
        setSavingKpi(true);
        try {
            const user = authService.getCurrentUser();
            if (!user?.organizationId) throw new Error('Sin organización');
            const { error } = await supabase
                .from('organizations')
                .update({
                    kpi_sla_ms:          kpiSlaMs,
                    kpi_min_por_tarea:   kpiMinTarea,
                    kpi_costo_hora_usd:  kpiCostoHora,
                })
                .eq('id', user.organizationId);
            if (error) throw new Error(error.message);
            toast.success('Parámetros KPI guardados');
        } catch (err: any) {
            toast.error(`Error al guardar: ${err.message}`);
        } finally {
            setSavingKpi(false);
        }
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

                        {/* Indicadores */}
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <p className="text-sm font-semibold text-gray-700">Sistema de Indicadores de Gestión</p>
                                <p className="text-xs text-gray-400 mb-1">Proyecto: koxjkebnjusgazsdeokc.supabase.co</p>
                                <p className="text-xs font-mono text-indigo-600">INDICADORES_SUPABASE_URL</p>
                                <p className="text-xs font-mono text-indigo-600">INDICADORES_SERVICE_ROLE_KEY</p>
                            </div>
                            <a
                                href="https://supabase.com/dashboard/project/kbscaxcokxwdbnrltkup/settings/functions"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                            >
                                Configurar <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>

                        {/* EE.FF. */}
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <p className="text-sm font-semibold text-gray-700">Estados Financieros (EE.FF.)</p>
                                <p className="text-xs text-gray-400 mb-1">Conectar cuando el sistema tenga Supabase propio</p>
                                <p className="text-xs font-mono text-green-600">EEFF_SUPABASE_URL</p>
                                <p className="text-xs font-mono text-green-600">EEFF_SERVICE_ROLE_KEY</p>
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
                                <p className="text-xs text-gray-400 mb-1">Conectar para flujos de siniestros y fraude</p>
                                <p className="text-xs font-mono text-red-500">RISKGUARD_SUPABASE_URL</p>
                                <p className="text-xs font-mono text-red-500">RISKGUARD_SERVICE_ROLE_KEY</p>
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

                {/* ── Parámetros KPI ──────────────────────────────────────── */}
                <Section title="Parámetros KPI del Dashboard" icon={BarChart2}>
                    <div className="space-y-5">
                        <p className="text-xs text-gray-400">Estos valores afectan los KPIs del Centro de Comando: SLA, Ahorro Estimado y semáforos de rendimiento.</p>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Umbral SLA (segundos)
                                </label>
                                <input
                                    type="number" min={1} max={300}
                                    value={Math.round(kpiSlaMs / 1000)}
                                    onChange={e => setKpiSlaMs(Number(e.target.value) * 1000)}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                />
                                <p className="text-xs text-gray-400 mt-1">Ejecuciones bajo este tiempo cuentan como SLA cumplido</p>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Minutos ahorrados / tarea
                                </label>
                                <input
                                    type="number" min={1} max={480}
                                    value={kpiMinTarea}
                                    onChange={e => setKpiMinTarea(Number(e.target.value))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                />
                                <p className="text-xs text-gray-400 mt-1">Tiempo manual estimado que reemplaza cada ejecución exitosa</p>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Costo hora-hombre (USD)
                                </label>
                                <input
                                    type="number" min={1} max={500}
                                    value={kpiCostoHora}
                                    onChange={e => setKpiCostoHora(Number(e.target.value))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                />
                                <p className="text-xs text-gray-400 mt-1">Tarifa base para calcular el ahorro en USD</p>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                            <p className="text-xs text-gray-500">
                                Preview: <span className="font-semibold text-indigo-600">
                                    100 tareas exitosas = ${Math.round(100 * kpiMinTarea / 60 * kpiCostoHora).toLocaleString()} USD ahorrados
                                </span>
                            </p>
                            <button
                                onClick={handleSaveKpi}
                                disabled={savingKpi}
                                className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                                {savingKpi ? 'Guardando...' : 'Guardar parámetros'}
                            </button>
                        </div>
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
