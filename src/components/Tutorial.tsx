import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Zap, GitBranch, Play, Settings, TrendingUp, BarChart2 } from 'lucide-react';

interface TutorialProps {
    isOpen:   boolean;
    onClose:  () => void;
}

const STEPS = [
    {
        title:   '¡Bienvenido a HermesAI Flow!',
        content: 'El hub central de automatización de procesos para tu ecosistema empresarial. Conecta tus sistemas, automatiza flujos y recibe alertas sin escribir código.',
        icon:    <Zap className="w-10 h-10 text-indigo-500" />,
        tip:     null,
    },
    {
        title:   '1. Elige un Trigger',
        content: 'Todo flujo comienza con un trigger. Usa "Inicio Manual" para probar, "Programado (Cron)" para ejecuciones automáticas o "Webhook" para eventos externos.',
        icon:    <Play className="w-10 h-10 text-emerald-500" />,
        tip:     'Ejemplo: "0 9 * * 1-5" ejecuta el flujo de lunes a viernes a las 9am automáticamente.',
    },
    {
        title:   '2. Agrega Procesadores',
        content: 'Los nodos procesadores obtienen y transforman datos. Disponibles: Tasa BCV, Leer Indicadores, Datos EE.FF., Score AML, Semáforo de Gestión y más.',
        icon:    <TrendingUp className="w-10 h-10 text-blue-500" />,
        tip:     'Los datos de cada nodo quedan disponibles para el siguiente con {{previous.campo}}.',
    },
    {
        title:   '3. Bifurca con Decisiones',
        content: 'El nodo Decisión evalúa condiciones y bifurca el flujo. La primera conexión es la rama SI (verde ✅) y la segunda es NO (rojo ❌). Ideal para alertas condicionales.',
        icon:    <GitBranch className="w-10 h-10 text-violet-500" />,
        tip:     'Clic en el → del nodo origen → clic en el nodo destino. Clic en la flecha para eliminarla.',
    },
    {
        title:   '4. Define las Salidas',
        content: 'Los nodos de salida ejecutan acciones: Enviar Email (con plantillas HTML), Reporte Gerencial, Registrar Log o Notificar Ajustador. Usa {{previous.campo}} para incluir datos reales.',
        icon:    <BarChart2 className="w-10 h-10 text-orange-500" />,
        tip:     'El botón "📊 Usar plantilla gerencial" genera automáticamente un email ejecutivo profesional.',
    },
    {
        title:   '5. Monitorea en Tiempo Real',
        content: 'Cada ejecución queda registrada en Monitoreo con logs expandibles por nodo. Verás qué rama tomó cada Decisión, cuánto tardó y qué datos procesó.',
        icon:    <Settings className="w-10 h-10 text-gray-500" />,
        tip:     'En Configuración → Sistemas conecta Indicadores, EE.FF. y RiskGuard con sus secrets de Supabase.',
    },
];

export function Tutorial({ isOpen, onClose }: TutorialProps) {
    const [step, setStep] = useState(0);
    if (!isOpen) return null;

    const s    = STEPS[step];
    const last = step === STEPS.length - 1;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-white" />
                        <span className="text-white font-semibold text-sm">HermesAI Flow — Guía de inicio</span>
                    </div>
                    <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Contenido */}
                <div className="px-8 py-7 text-center">
                    <div className="flex justify-center mb-5 w-20 h-20 bg-gray-50 rounded-2xl mx-auto items-center">
                        {s.icon}
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{s.title}</h3>
                    <p className="text-gray-600 leading-relaxed text-sm">{s.content}</p>

                    {s.tip && (
                        <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-left">
                            <p className="text-xs text-indigo-700"><span className="font-bold">💡 Tip:</span> {s.tip}</p>
                        </div>
                    )}
                </div>

                {/* Progress dots */}
                <div className="flex justify-center gap-1.5 mb-2">
                    {STEPS.map((_, i) => (
                        <button
                            key={i}
                            onClick={() => setStep(i)}
                            className={`rounded-full transition-all ${i === step ? 'w-6 h-2 bg-indigo-600' : 'w-2 h-2 bg-gray-200 hover:bg-gray-300'}`}
                        />
                    ))}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
                    <button
                        onClick={() => setStep(s => Math.max(0, s - 1))}
                        disabled={step === 0}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" /> Anterior
                    </button>

                    <span className="text-xs text-gray-400">{step + 1} / {STEPS.length}</span>

                    {last ? (
                        <button
                            onClick={onClose}
                            className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                            ¡Comenzar! <Zap className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            onClick={() => setStep(s => s + 1)}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                            Siguiente <ChevronRight className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
