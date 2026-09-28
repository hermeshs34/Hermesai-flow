// ═══════════════════════════════════════════════════════════════════════════
// Webhook de entrada — piezas puras (las usan webhook-in y execute-workflow)
// Diseño: docs/superpowers/specs/2026-09-28-webhook-entrada-design.md
//
// ⚠️ Este módulo se prueba con Vitest desde la raíz (`npm test`). Por eso no
// puede tocar `Deno.*` al cargarse, ni importar nada que lo haga — en concreto
// NO importa `email.ts`, que lee RESEND_API_KEY en el cuerpo del módulo. El
// escape HTML lo aplica el motor, que sí tiene `escaparHtml` a mano.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_BYTES         = 256 * 1024;
export const LIMITE_POR_MINUTO = 60;
export const MAX_EVENTO_ID     = 200;
export const PREFIJO_SECRETO   = 'hfw_';

export type Veredicto<T> =
    | { ok: true; valor: T }
    | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/…/webhook-in/<uuid>[/]` → uuid en minúsculas. Cualquier otra forma → null. */
export function extraerIdFlujo(pathname: string): string | null {
    const partes = pathname.split('/').filter(Boolean);
    const i = partes.lastIndexOf('webhook-in');
    if (i === -1 || partes.length !== i + 2) return null;
    const id = partes[i + 1];
    return UUID.test(id) ? id.toLowerCase() : null;
}

/** jsonb no admite U+0000 en cadenas ni en claves: se rechaza antes de llegar a la base. */
function contieneNulo(v: unknown): boolean {
    if (typeof v === 'string') return v.includes('\u0000');
    if (Array.isArray(v)) return v.some(contieneNulo);
    if (v !== null && typeof v === 'object') {
        return Object.entries(v).some(([k, x]) => k.includes('\u0000') || contieneNulo(x));
    }
    return false;
}

export function validarEntrada(
    metodo: string,
    contentType: string | null,
    cuerpo: Uint8Array,
): Veredicto<Record<string, unknown>> {
    if (metodo !== 'POST') {
        return { ok: false, status: 405, error: 'Solo se admite POST.' };
    }
    const tipo = (contentType ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== 'application/json') {
        return { ok: false, status: 415, error: 'El cuerpo tiene que ser JSON (Content-Type: application/json).' };
    }
    if (cuerpo.byteLength > MAX_BYTES) {
        return { ok: false, status: 413, error: `El cuerpo supera el máximo de ${MAX_BYTES / 1024} KB.` };
    }
    let texto: string;
    try {
        texto = new TextDecoder('utf-8', { fatal: true }).decode(cuerpo);
    } catch {
        return { ok: false, status: 400, error: 'El cuerpo no es texto UTF-8 válido.' };
    }
    let dato: unknown;
    try {
        dato = JSON.parse(texto);
    } catch {
        return { ok: false, status: 400, error: 'El cuerpo no es JSON válido.' };
    }
    if (dato === null || typeof dato !== 'object' || Array.isArray(dato)) {
        return { ok: false, status: 400, error: 'El cuerpo tiene que ser un objeto JSON ({ … }), no una lista ni un valor suelto.' };
    }
    if (contieneNulo(dato)) {
        return { ok: false, status: 400, error: 'El cuerpo contiene el carácter nulo (\\u0000), que no se puede guardar.' };
    }
    return { ok: true, valor: dato as Record<string, unknown> };
}

export function validarIdempotencyKey(v: string | null): Veredicto<string | null> {
    const t = (v ?? '').trim();
    if (t === '') return { ok: true, valor: null };
    if (t.length > MAX_EVENTO_ID) {
        return { ok: false, status: 400, error: `Idempotency-Key no puede pasar de ${MAX_EVENTO_ID} caracteres.` };
    }
    // deno-lint-ignore no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(t)) {
        return { ok: false, status: 400, error: 'Idempotency-Key contiene caracteres de control.' };
    }
    return { ok: true, valor: t };
}

/** La cabecera manda. La URL solo cuenta si el flujo lo permite (`permite_secreto_url`). */
export function elegirSecreto(cabecera: string | null, deUrl: string | null, permiteUrl: boolean): string | null {
    const c = (cabecera ?? '').trim();
    if (c !== '') return c;
    const u = (deUrl ?? '').trim();
    return permiteUrl && u !== '' ? u : null;
}

/** Misma huella que `encode(sha256(convert_to(x,'UTF8')),'hex')` en la base. */
export async function sha256Hex(texto: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/** Se usa con dos huellas hex de 64: la longitud no es secreta, el contenido sí. */
export function igualesTiempoConstante(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let dif = 0;
    for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return dif === 0;
}

/**
 * Lee `a.b.0.c` recorriendo SOLO propiedades propias. `{{webhook.constructor}}`
 * o `{{webhook.__proto__}}` no pueden devolver nada del prototipo: el dato
 * viene de fuera y la ruta la escribe el diseñador, pero el objeto no.
 */
export function leerRuta(obj: unknown, ruta: string): unknown {
    if (ruta === '') return obj;
    let val: unknown = obj;
    for (const seg of ruta.split('.')) {
        if (val === null || typeof val !== 'object') return undefined;
        if (!Object.prototype.hasOwnProperty.call(val, seg)) return undefined;
        val = (val as Record<string, unknown>)[seg];
    }
    return val;
}

export function textoDeValor(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

/** Motivo legible de una respuesta no-2xx: el campo `error` del JSON, o el sobre recortado. */
export function motivoDeCuerpo(status: number, texto: string): string {
    try {
        const j = JSON.parse(texto);
        if (j && typeof j.error === 'string' && j.error.trim() !== '') return j.error;
    } catch { /* no era JSON */ }
    return `HTTP ${status} — ${texto.slice(0, 300)}`;
}
