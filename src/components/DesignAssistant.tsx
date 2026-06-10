import { useState, useRef, useEffect } from 'react';
import { BrainCircuit, X, Send, Loader2, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../core/supabase';
import type { WorkflowNodeData, WorkflowConnection } from '../types/workflow';

interface Message {
    role:    'user' | 'assistant';
    content: string;
}

interface Props {
    nodes:       WorkflowNodeData[];
    connections: WorkflowConnection[];
    onClose:     () => void;
}

const SUGERENCIAS = [
    '¿Cómo defino las ramas SI y NO del nodo Decisión?',
    'Quiero crear un flujo de verificación OFAC con aprobación. ¿Qué nodos necesito?',
    'Explica cuándo usar el Agente IA en modo Decisión vs modo Análisis.',
    '¿Cómo paso datos entre nodos con {{previous.campo}}?',
    'Mi flujo tiene un loop, ¿cómo lo detecto?',
];

function buildCanvasContext(nodes: WorkflowNodeData[], connections: WorkflowConnection[]): string {
    if (nodes.length === 0) return 'El canvas está vacío — no hay nodos aún.';
    const nodeDesc = nodes.map(n => {
        const configKeys = Object.entries(n.config ?? {})
            .filter(([, v]) => v !== '' && v !== null && v !== undefined)
            .map(([k, v]) => `    ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join('\n');
        return `• [${n.id.slice(0, 6)}] ${n.title} (categoría: ${n.category})${configKeys ? '\n' + configKeys : ''}`;
    }).join('\n');
    const connDesc = connections.length > 0
        ? connections.map(c => {
            const src = nodes.find(n => n.id === c.sourceId)?.title ?? c.sourceId.slice(0, 6);
            const tgt = nodes.find(n => n.id === c.targetId)?.title ?? c.targetId.slice(0, 6);
            const branch = c.branch === 'true' ? ' [→ SI]' : c.branch === 'false' ? ' [→ NO]' : '';
            return `  ${src} → ${tgt}${branch}`;
        }).join('\n')
        : '  (sin conexiones)';
    return `Nodos en el canvas (${nodes.length}):\n${nodeDesc}\n\nConexiones:\n${connDesc}`;
}

const SYSTEM = `Eres el Asistente de Diseño de HermesAI Flow, un sistema de flujos de trabajo para el sector de seguros y finanzas venezolano.

Tu función es ayudar al usuario a diseñar flujos de trabajo claros y correctos. Conoces todos los tipos de nodos disponibles:
- **Triggers**: Inicio Manual, Programado (Cron), Webhook Entrante, Alerta Siniestro, Alerta KPI Crítico, Alerta por Umbral
- **Procesadores**: Decisión SI/NO, Agente IA (análisis o decisión), Aprobación Humana, Verificar OFAC/ONU, Score AML, Tasa BCV, Calcular Reserva IBNR, Escalar Reaseguro, Semáforo de Gestión, Datos EE.FF., Espera, Control de Calidad
- **Procesadores**: Decisión SI/NO, Agente IA (análisis o decisión), Aprobación Humana, Verificar OFAC/ONU, Score AML, Tasa BCV, Calcular Reserva IBNR, Escalar Reaseguro, Semáforo de Gestión, Datos EE.FF., Espera, Control de Calidad, Congelar Operación (procesador — puede encadenar hacia Email u otras salidas)
- **Salidas**: Enviar Email, Registrar Log, Reporte SUDEASEG, Reporte SUDEBAN, Reporte Gerencial, Notificar Ajustador, Actualizar ERP/WMS

Reglas de diseño importantes:
1. Todo flujo debe tener exactamente 1 nodo Trigger al inicio.
2. El nodo Decisión siempre tiene 2 salidas: rama SI y rama NO — ambas deben estar conectadas.
3. El nodo Agente IA en modo Decisión también produce 2 ramas como el nodo Decisión.
4. El nodo Aprobación Humana pausa el flujo hasta que un usuario con el rol configurado aprueba o rechaza.
5. Los datos fluyen entre nodos con {{previous.campo}} — el nodo siguiente puede acceder a todo lo que devolvió el anterior.
6. Para OFAC/AML: el patrón correcto es → Verificar OFAC → Decisión (en_lista==true) → SI: Aprobación Humana → Email alerta / NO: Email sin observaciones.

Cuando el usuario te muestre el estado de su canvas, analízalo y da sugerencias concretas de mejora.
Sé conciso, usa listas cuando sea útil, y propón el siguiente paso concreto siempre.`;

export function DesignAssistant({ nodes, connections, onClose }: Props) {
    const [messages,    setMessages]    = useState<Message[]>([]);
    const [input,       setInput]       = useState('');
    const [loading,     setLoading]     = useState(false);
    const [showSuggest, setShowSuggest] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const send = async (text: string) => {
        if (!text.trim() || loading) return;
        const userMsg: Message = { role: 'user', content: text.trim() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setShowSuggest(false);
        setLoading(true);

        try {
            const canvasCtx  = buildCanvasContext(nodes, connections);
            const history    = [...messages, userMsg];
            const apiMessages = history.map(m => ({ role: m.role, content: m.content }));

            // Inyectar contexto del canvas como primer mensaje del sistema en el historial
            apiMessages[0] = {
                role:    'user',
                content: `[Contexto actual del canvas]\n${canvasCtx}\n\n${apiMessages[0].content}`,
            };

            const { data, error } = await supabase.functions.invoke('design-assistant', {
                body: { messages: apiMessages, system: SYSTEM },
            });

            if (error) throw error;
            const reply = data?.content ?? 'Sin respuesta del asistente.';
            setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
        } catch (e: any) {
            setMessages(prev => [...prev, {
                role:    'assistant',
                content: `⚠️ Error: ${e.message ?? 'No se pudo conectar con el asistente.'}`,
            }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-80 flex flex-col bg-white border-l border-gray-200 flex-shrink-0 h-full">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-violet-600 to-indigo-600">
                <div className="flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-white" />
                    <span className="text-sm font-semibold text-white">Asistente de Diseño</span>
                </div>
                <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">

                {messages.length === 0 && (
                    <div className="text-center py-6">
                        <BrainCircuit className="w-10 h-10 mx-auto mb-2 text-violet-300" />
                        <p className="text-sm font-medium text-gray-700">¿Cómo puedo ayudarte?</p>
                        <p className="text-xs text-gray-400 mt-1">Pregúntame sobre diseño de flujos, nodos o conexiones.</p>
                    </div>
                )}

                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                            m.role === 'user'
                                ? 'bg-indigo-600 text-white rounded-br-sm'
                                : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                        }`}>
                            {m.content}
                        </div>
                    </div>
                ))}

                {loading && (
                    <div className="flex justify-start">
                        <div className="bg-gray-100 rounded-xl rounded-bl-sm px-3 py-2 flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin text-violet-500" />
                            <span className="text-xs text-gray-500">Analizando...</span>
                        </div>
                    </div>
                )}

                <div ref={bottomRef} />
            </div>

            {/* Sugerencias rápidas */}
            {showSuggest && messages.length === 0 && (
                <div className="px-3 pb-2">
                    <button
                        onClick={() => setShowSuggest(v => !v)}
                        className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 mb-1.5"
                    >
                        <Lightbulb className="w-3 h-3" />
                        Preguntas frecuentes
                        {showSuggest ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                    </button>
                    <div className="space-y-1">
                        {SUGERENCIAS.map(s => (
                            <button
                                key={s}
                                onClick={() => send(s)}
                                className="w-full text-left text-[11px] px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 transition-colors"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Botón analizar canvas */}
            {nodes.length > 0 && (
                <div className="px-3 pb-2">
                    <button
                        onClick={() => send(`Analiza mi flujo actual y dime qué mejorar:\n${buildCanvasContext(nodes, connections)}`)}
                        disabled={loading}
                        className="w-full text-xs py-1.5 px-3 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
                    >
                        <BrainCircuit className="w-3.5 h-3.5" />
                        Analizar mi flujo actual
                    </button>
                </div>
            )}

            {/* Input */}
            <div className="px-3 pb-3 border-t border-gray-100 pt-2">
                <div className="flex items-end gap-2">
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                        placeholder="Escribe tu pregunta... (Enter para enviar)"
                        rows={2}
                        className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
                    />
                    <button
                        onClick={() => send(input)}
                        disabled={!input.trim() || loading}
                        className="p-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-40 transition-colors flex-shrink-0"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
