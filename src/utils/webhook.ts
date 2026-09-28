import type { EstadoRecepcion } from '../types/webhook';

/** Una recepción 'aceptada' que el motor no ha anclado en este tiempo se enseña, no se calla. */
export const MINUTOS_SIN_CONFIRMAR = 5;

export type TonoRecepcion = 'verde' | 'ambar' | 'rojo' | 'gris';

export function etiquetaRecepcion(
    estado: EstadoRecepcion,
    recibidoAt: string,
    ahora: Date = new Date(),
): { texto: string; tono: TonoRecepcion } {
    switch (estado) {
        case 'lanzada':            return { texto: 'Lanzada', tono: 'verde' };
        case 'aceptada':
            return ahora.getTime() - new Date(recibidoAt).getTime() > MINUTOS_SIN_CONFIRMAR * 60_000
                ? { texto: 'Sin confirmar', tono: 'ambar' }
                : { texto: 'Recibida', tono: 'gris' };
        case 'fallo_al_lanzar':    return { texto: 'Falló al lanzar', tono: 'rojo' };
        case 'rechazada_inactivo': return { texto: 'Rechazada: flujo no apto', tono: 'ambar' };
        case 'frenada_limite':     return { texto: 'Frenada por límite', tono: 'ambar' };
        case 'duplicada':          return { texto: 'Duplicada', tono: 'gris' };
    }
}

export function ejemploCurl(url: string): string {
    return [
        `curl -X POST '${url}' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -H 'x-webhook-secret: hfw_TU_SECRETO' \\`,
        `  -H 'Idempotency-Key: pedido-12345' \\`,
        `  -d '{"nombre":"Ana Pérez","email":"ana@ejemplo.com"}'`,
    ].join('\n');
}
