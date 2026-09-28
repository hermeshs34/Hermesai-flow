import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, RefreshCw, AlertTriangle, Lock } from 'lucide-react';
import { WebhookService } from '../services/webhook.service';
import type { WebhookConfig, RecepcionWebhook } from '../types/webhook';
import { etiquetaRecepcion, ejemploCurl, type TonoRecepcion } from '../utils/webhook';
import { fechaHoraVE } from '../utils/fecha';
import { rolesQuePueden } from '../utils/errores';
import { showError, showSuccess } from '../utils/toast';

interface Props {
    workflowId:     string | null;
    organizationId: string;
    puedeEditar:    boolean;
}

const TONO: Record<TonoRecepcion, string> = {
    verde: 'bg-green-100 text-green-700',
    ambar: 'bg-amber-100 text-amber-800',
    rojo:  'bg-red-100 text-red-700',
    gris:  'bg-gray-100 text-gray-600',
};

async function copiar(texto: string, que: string) {
    try {
        await navigator.clipboard.writeText(texto);
        showSuccess(`${que} copiado`);
    } catch {
        showError(`No se pudo copiar: selecciona el texto y cópialo a mano.`);
    }
}

export default function WebhookSection({ workflowId, organizationId, puedeEditar }: Props) {
    const [config, setConfig]           = useState<WebhookConfig | null>(null);
    const [recepciones, setRecepciones] = useState<RecepcionWebhook[]>([]);
    const [cargando, setCargando]       = useState(true);
    const [errorCarga, setErrorCarga]   = useState<string | null>(null);
    const [ocupado, setOcupado]         = useState(false);
    const [secretoNuevo, setSecretoNuevo] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        if (!workflowId) return;
        setCargando(true);
        setErrorCarga(null);
        try {
            const [c, r] = await Promise.all([
                WebhookService.getConfig(workflowId, organizationId),
                WebhookService.ultimasRecepciones(workflowId, organizationId),
            ]);
            setConfig(c);
            setRecepciones(r);
        } catch (e) {
            setErrorCarga((e as Error).message);
        } finally {
            setCargando(false);
        }
    }, [workflowId, organizationId]);

    useEffect(() => { void cargar(); }, [cargar]);

    if (!workflowId) {
        return (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
                Primero hay que guardar el flujo: el secreto del webhook se genera para un flujo que ya existe.
            </div>
        );
    }

    const url = WebhookService.urlDelFlujo(workflowId);

    const generar = async () => {
        if (config && !window.confirm(
            'Rotar el secreto invalida el actual EN EL ACTO: el sistema que llama dejará de funcionar ' +
            'hasta que le pongas el nuevo. ¿Seguir?')) return;
        setOcupado(true);
        try {
            setSecretoNuevo(await WebhookService.generarSecreto(workflowId));
            await cargar();
        } catch (e) {
            showError((e as Error).message);
        } finally {
            setOcupado(false);
        }
    };

    const cambiarUrl = async (permitir: boolean) => {
        if (permitir && !window.confirm(
            'Con esto el secreto podrá ir en la dirección (?secreto=…). Las direcciones quedan en historiales, ' +
            'registros de servidores y proxys del sistema que llama. Úsalo solo si ese sistema no permite ' +
            'poner cabeceras. ¿Permitirlo?')) return;
        setOcupado(true);
        try {
            await WebhookService.configurarUrl(workflowId, permitir);
            await cargar();
            showSuccess(permitir ? 'Secreto en la URL permitido' : 'Secreto en la URL retirado');
        } catch (e) {
            showError((e as Error).message);
        } finally {
            setOcupado(false);
        }
    };

    const ambar = config?.permiteSecretoUrl === true;

    return (
        <div className={`mt-2 rounded-xl border p-4 space-y-4 ${ambar ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">Entrada por webhook</h3>
                {!puedeEditar && (
                    <span className="flex items-center gap-1 text-[10px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">
                        <Lock className="w-3 h-3" /> Solo lectura
                    </span>
                )}
            </div>

            {/* 1. Dirección */}
            <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Dirección del flujo</label>
                <div className="flex gap-2">
                    <code className="flex-1 text-[11px] bg-gray-100 rounded px-2 py-1.5 break-all">{url}</code>
                    <button onClick={() => copiar(url, 'Dirección')} className="px-2 text-gray-500 hover:text-gray-800" title="Copiar">
                        <Copy className="w-4 h-4" />
                    </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Solo acepta llamadas si el flujo está <strong>publicado y activo</strong>.</p>
            </div>

            {/* 2. Estado */}
            {cargando ? (
                <p className="text-xs text-gray-400">Cargando…</p>
            ) : errorCarga ? (
                <p className="text-xs text-red-600">{errorCarga}</p>
            ) : config ? (
                <p className="text-xs text-green-700">
                    Activo · generado por {config.generadoEmail ?? 'alguien'} el {fechaHoraVE(config.generadoAt)} (hora de Venezuela)
                </p>
            ) : (
                <p className="text-xs text-gray-600">Sin secreto — el flujo no acepta llamadas.</p>
            )}

            {/* 3. Generar / rotar */}
            {puedeEditar ? (
                <button
                    onClick={generar}
                    disabled={ocupado || cargando}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                    {config ? <RefreshCw className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
                    {config ? 'Rotar secreto' : 'Generar secreto'}
                </button>
            ) : (
                <p className="text-[11px] text-gray-500">
                    Generar o rotar el secreto es de {rolesQuePueden('manage_workflows')}.
                </p>
            )}

            {/* 4. Secreto en la URL */}
            {config && (
                <label className={`flex items-start gap-2 text-xs ${puedeEditar ? 'cursor-pointer' : 'opacity-60'}`}>
                    <input
                        type="checkbox"
                        checked={config.permiteSecretoUrl}
                        disabled={!puedeEditar || ocupado}
                        onChange={e => cambiarUrl(e.target.checked)}
                        className="mt-0.5"
                    />
                    <span>
                        Permitir el secreto en la URL (<code>?secreto=…</code>)
                        {ambar && (
                            <span className="flex items-center gap-1 text-amber-800 mt-1">
                                <AlertTriangle className="w-3.5 h-3.5" /> Encendido: la dirección con el secreto puede quedar en registros ajenos.
                            </span>
                        )}
                    </span>
                </label>
            )}

            {/* 5. Ejemplo */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-600">Ejemplo de llamada</label>
                    <button onClick={() => copiar(ejemploCurl(url), 'Ejemplo')} className="text-gray-500 hover:text-gray-800" title="Copiar">
                        <Copy className="w-3.5 h-3.5" />
                    </button>
                </div>
                <pre className="text-[10px] bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto whitespace-pre">{ejemploCurl(url)}</pre>
                <p className="text-[11px] text-gray-500 mt-1">
                    Manda siempre <code>Idempotency-Key</code> con un valor único por evento: si la llamada se repite, el flujo no se ejecuta dos veces.
                    En los nodos siguientes, lo enviado se usa como <code>{'{{webhook.nombre}}'}</code>.
                </p>
            </div>

            {/* 6. Últimas llamadas */}
            <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Últimas llamadas</label>
                {recepciones.length === 0 ? (
                    <p className="text-[11px] text-gray-400">Ninguna todavía.</p>
                ) : (
                    <ul className="space-y-1">
                        {recepciones.map(r => {
                            const et = etiquetaRecepcion(r.estado, r.recibidoAt);
                            return (
                                <li key={r.id} className="text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <span className="text-gray-500">{fechaHoraVE(r.recibidoAt)}</span>
                                    <span className={`px-1.5 py-0.5 rounded-full ${TONO[et.tono]}`}>{et.texto}</span>
                                    {r.executionRunId && (
                                        <span className="text-gray-500" title="Búscala en Monitoreo por este código">
                                            ejecución <code>{r.executionRunId.slice(0, 8)}</code>
                                        </span>
                                    )}
                                    {r.motivo && <span className="w-full text-gray-600">{r.motivo}</span>}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Ventana del secreto: se enseña UNA vez */}
            {secretoNuevo && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3">
                        <h4 className="font-bold text-gray-900 text-sm">Secreto del webhook</h4>
                        <p className="text-xs text-red-700 font-semibold">Guárdalo ahora; no se volverá a mostrar.</p>
                        <code className="block text-[11px] bg-gray-100 rounded px-2 py-2 break-all select-all">{secretoNuevo}</code>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => copiar(secretoNuevo, 'Secreto')} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                                Copiar
                            </button>
                            <button onClick={() => setSecretoNuevo(null)} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                                Ya lo he guardado
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
