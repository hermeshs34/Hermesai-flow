// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Único punto de salida de correo
//
// Canal único: Resend, sobre el dominio de plataforma avisos.hermesaitech.com,
// verificado en eu-west-1 y compartido con TurnoGuard, RiskGuard y Estados
// Financieros. No hay respaldo: si Resend falla, se lanza.
//
// Antes de 07/08/2026 había dos canales y elegía el primero que encontrara:
// SMTP de Gmail con nodemailer, y Resend detrás con `onboarding@resend.dev`.
// Ese apaño existía porque el remitente de pruebas de Resend había dejado de
// repartir y no había dominio propio. Ya lo hay, así que fuera nodemailer,
// fuera el SMTP y fuera los secretos GMAIL_USER y GMAIL_APP_PASSWORD.
//
// EL REMITENTE VA EN EL CÓDIGO, NO EN UN SECRETO. Es la lección del punto 2
// del orden de trabajo de la plataforma: NOTIF_EMAIL_FROM pertenece a
// TurnoGuard y ya se coló en dos proyectos ajenos —RiskGuard el 04/08 y este,
// donde no lo leía nadie— antes de que alguien lo mirara.
// Ver: C:\Desarrollos Sistema IA\Sistema de Horarios y Turnos\docs\PLATAFORMA_HERMESAI.md
// ═══════════════════════════════════════════════════════════════════════════

import { fechaHoraVE } from './fecha.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

/** Remitente único del producto. La dirección es la de plataforma; solo cambia el nombre visible. */
const REMITENTE = 'HermesAI Flow <no-responder@avisos.hermesaitech.com>';
const DIRECCION_REMITENTE = 'no-responder@avisos.hermesaitech.com';

/** Dominio verificado en la cuenta de Resend de la plataforma. Lo comprueba el health-check. */
export const DOMINIO_ENVIO = 'avisos.hermesaitech.com';

const API = 'https://api.resend.com';

// Límites de la API de lote. El lote es ATÓMICO: si un mensaje no valida, se
// cae entero, por eso se valida todo antes de salir.
const MAX_POR_LOTE       = 100;  // mensajes en una petición
const MAX_DESTINATARIOS  = 50;   // direcciones en un mismo mensaje

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CanalEmail = 'resend' | 'ninguno';

/** Mensaje con cuerpo propio para cada destinatario. Ver `enviarEmailPersonalizado`. */
export interface MensajeEmail {
    to:      string | string[];
    subject: string;
    html:    string;
}

/** Qué canal se usaría ahora mismo. Para el health-check y los diagnósticos. */
export function canalEmail(): CanalEmail {
    return RESEND_API_KEY ? 'resend' : 'ninguno';
}

/** Dirección desde la que se envía de verdad, para poder enseñarla en pantalla. */
export function direccionRemitente(): string {
    return canalEmail() === 'resend' ? DIRECCION_REMITENTE : '';
}

/**
 * Direcciones que pide quien llama → lista limpia de correos.
 *
 * Acepta separadores porque el nodo Email guarda un campo de texto libre y el
 * usuario escribe «uno@x.com, otro@y.com». Con nodemailer daba igual —aceptaba
 * la cadena entera y la partía él—, pero Resend trata cada elemento como una
 * dirección y una cadena con comas la rechaza como inválida.
 */
function normalizarDestinatarios(to: string | string[]): string[] {
    const bruto = Array.isArray(to) ? to : [to];
    const lista = bruto
        .flatMap(d => String(d ?? '').split(/[,;]/))
        .map(d => d.trim())
        .filter(Boolean);
    return [...new Set(lista)];
}

/**
 * El remitente que pida quien llama NO gobierna el From.
 *
 * `avisos.hermesaitech.com` es un subdominio compartido por los cuatro
 * productos: si el campo «De:» de un nodo Email llegara tal cual a la API,
 * cualquiera con permiso para editar un flujo podría enviar como
 * facturacion@avisos.hermesaitech.com. El From es siempre REMITENTE y lo que
 * pidieran se degrada a Reply-To, que es exactamente lo que hacía la rama SMTP
 * (Gmail solo deja enviar como la cuenta autenticada, así que reescribía el
 * From igual). Ningún flujo existente cambia de comportamiento.
 */
function replyToDe(from?: string): string | undefined {
    if (!from) return undefined;
    const m = String(from).match(/<([^>]+)>/);
    const direccion = (m ? m[1] : String(from)).trim();

    if (!RE_EMAIL.test(direccion))            return undefined;
    if (direccion === DIRECCION_REMITENTE)    return undefined;
    if (direccion.endsWith('@resend.dev'))    return undefined;  // resto del apaño viejo
    return direccion;
}

/**
 * Escapa un valor para meterlo dentro del HTML de un correo.
 *
 * Las plantillas de este producto (aprobación pendiente, escalamiento,
 * vencimiento, rechazo) interpolan texto que no escribimos nosotros: nombres de
 * flujo, nombres de persona, descripciones de la matriz de aprobación, el
 * comentario que teclea quien rechaza y los datos que llegan de los cuatro
 * sistemas conectados. Un `<` suelto en cualquiera de ellos descuadra el correo,
 * y un `<script>` o un `<a>` lo convierte en algo que no habíamos escrito.
 *
 * NO se usa con el cuerpo de un nodo Email ni de un nodo Reporte: ahí el HTML lo
 * pone el autor del flujo a propósito y escaparlo enseñaría las etiquetas en
 * pantalla. La frontera es esa: se escapa el dato, nunca la plantilla.
 */
export function escaparHtml(valor: unknown): string {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')   // primero, o reescaparía los de abajo
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── Marco corporativo ───────────────────────────────────────────────────────
// Hasta el 05/10/2026 cada función pintaba su propio HTML —seis cabeceras, tres
// tipografías, colores distintos— y el nodo Email salía sin marco ninguno: un
// correo de un flujo no se parecía en nada a los de RiskGuard o Estados
// Financieros. Este es el único marco, calcado del `templateBase` de RiskGuard
// (`_shared/alertas.ts`) para que los productos se reconozcan como uno.
//
// El logotipo es TEXTO con colores, no una imagen: Gmail y Outlook no pintan
// SVG, y una imagen externa sale bloqueada hasta que el lector pulsa «mostrar».
// Todo va con estilos en línea y tablas, que es lo único que respetan todos, y
// la tipografía se repite en la tabla porque Gmail descarta los de <body>.

const APP_URL = (Deno.env.get('APP_URL') ?? '').trim().replace(/\/$/, '');

export type TonoCorreo = 'info' | 'aviso' | 'peligro' | 'ok';

const COLOR_TONO: Record<TonoCorreo, string> = {
    info:    '#2563eb',
    aviso:   '#d97706',
    peligro: '#dc2626',
    ok:      '#059669',
};

export interface OpcionesPlantilla {
    /** Título visible dentro de la tarjeta. Es TEXTO: se escapa aquí. */
    titulo:  string;
    /** HTML del cuerpo. NO se escapa: quien llama escapa los datos que mete. */
    cuerpo:  string;
    /** Nombre del flujo para la franja superior. Texto: se escapa aquí. */
    flujo?:  string;
    /** Momento que se enseña en la franja; por defecto, ahora. */
    fecha?:  Date | string;
    /** Color del filete bajo la cabecera. Por defecto `info`. */
    tono?:   TonoCorreo;
}

/**
 * Envuelve un cuerpo en el marco corporativo de HermesAI Flow: cabecera con el
 * logotipo, franja con flujo y hora de Venezuela, tarjeta blanca y pie.
 *
 * La hora pasa por `fechaHoraVE` (§9.3): un correo sale del sistema y lo lee
 * gente en otros husos, y la Edge Function corre en UTC.
 */
export function plantillaCorreo(o: OpcionesPlantilla): string {
    const tono  = COLOR_TONO[o.tono ?? 'info'];
    const fecha = fechaHoraVE(o.fecha ?? new Date());
    const etiquetaFranja = o.flujo ? 'Flujo' : 'Aviso del sistema';
    const valorFranja    = o.flujo ? escaparHtml(o.flujo) : 'HermesAI Flow';
    const enlaceApp = APP_URL
        ? ` · <a href="${escaparHtml(APP_URL)}" style="color:#64748b;text-decoration:underline">Abrir HermesAI Flow</a>`
        : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escaparHtml(o.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;font-family:Arial,Helvetica,sans-serif;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,.08)">
  <tr><td style="background:#0a0f1e;padding:22px 32px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:40px;height:40px;background:#0f3460;background-image:linear-gradient(135deg,#0f3460,#1a5276);border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-weight:900;font-size:15px;letter-spacing:.5px">HF</td>
      <td style="padding-left:12px;vertical-align:middle">
        <div style="color:#ffffff;font-weight:900;font-size:15px;letter-spacing:1px">HermesAI <span style="color:#60a5fa">Flow</span></div>
        <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:2px;margin-top:2px">Automatización de procesos</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${tono};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
  <tr><td style="background:#0f172a;padding:10px 32px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="color:#94a3b8;font-size:11px"><span style="text-transform:uppercase;letter-spacing:1.5px">${etiquetaFranja}</span>&nbsp; <strong style="color:#e2e8f0">${valorFranja}</strong></td>
      <td align="right" style="color:#94a3b8;font-size:11px;white-space:nowrap">${escaparHtml(fecha)} (hora VE)</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 32px 8px">
    <h1 style="margin:0;color:#0f172a;font-size:21px;font-weight:900;line-height:1.3">${escaparHtml(o.titulo)}</h1>
  </td></tr>
  <tr><td style="padding:12px 32px 32px;color:#374151;font-size:14px;line-height:1.7">
${o.cuerpo}
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;color:#94a3b8;font-size:11px;line-height:1.6">
    Mensaje automático de HermesAI Flow, no respondas a este correo${enlaceApp}<br>
    © 2026 HermesAI Tech — Confidencial
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * ¿El HTML ya es un documento completo? Entonces el autor puso su propio
 * marco y no se le mete otro alrededor: un `<html>` dentro de otro lo pinta
 * cada cliente a su manera.
 */
export function esDocumentoCompleto(html: string): boolean {
    return /^\s*(<!doctype\b|<html\b)/i.test(String(html ?? ''));
}

/** Versión en texto del HTML: los clientes sin HTML y los filtros antispam lo agradecen. */
function aTextoPlano(html: string): string {
    return String(html ?? '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')   // el <title> del marco repetiría el título
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|table)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

interface Payload {
    from:       string;
    to:         string[];
    subject:    string;
    html:       string;
    text:       string;
    reply_to?:  string;
}

function construirPayload(msg: MensajeEmail, replyTo?: string): Payload {
    const destinatarios = normalizarDestinatarios(msg.to);

    if (destinatarios.length === 0) {
        throw new Error('Sin destinatarios válidos.');
    }
    if (destinatarios.length > MAX_DESTINATARIOS) {
        throw new Error(`Demasiados destinatarios en un mismo correo (${destinatarios.length}, máximo ${MAX_DESTINATARIOS}).`);
    }
    const invalidos = destinatarios.filter(d => !RE_EMAIL.test(d));
    if (invalidos.length > 0) {
        throw new Error(`Dirección de correo no válida: ${invalidos[0]}`);
    }
    if (!msg.subject?.trim()) {
        throw new Error('El asunto es obligatorio.');
    }
    if (!msg.html?.trim()) {
        throw new Error('El correo no tiene contenido.');
    }

    return {
        from:    REMITENTE,
        to:      destinatarios,
        subject: msg.subject.trim(),
        html:    msg.html,
        text:    aTextoPlano(msg.html),
        ...(replyTo ? { reply_to: replyTo } : {}),
    };
}

/**
 * Una petición a la API. Devuelve los ids de los correos aceptados.
 *
 * Se usa fetch en vez del SDK para no arrastrar un paquete npm dentro de una
 * Edge Function por cuatro cabeceras. A cambio hay que mirar `res.ok` a mano:
 * la API responde 4xx/5xx con el detalle en el cuerpo y sin lanzar nada.
 */
async function pedir(ruta: string, cuerpo: unknown): Promise<string[]> {
    if (!RESEND_API_KEY) {
        throw new Error('No hay canal de correo configurado: falta RESEND_API_KEY en Supabase Secrets.');
    }

    const res = await fetch(`${API}${ruta}`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(cuerpo),
    });

    if (!res.ok) {
        // 403 aquí casi siempre es el dominio: o la clave es de otra cuenta de
        // Resend, o el From no coincide con un dominio verificado en ella.
        throw new Error(`Resend ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { id?: string; data?: { id?: string }[] };
    if (Array.isArray(data.data)) return data.data.map(d => d.id ?? '').filter(Boolean);
    return data.id ? [data.id] : [];
}

/** Parte una lista en trozos de como mucho `tam` elementos. */
function trocear<T>(lista: T[], tam: number): T[][] {
    const trozos: T[][] = [];
    for (let i = 0; i < lista.length; i += tam) trozos.push(lista.slice(i, i + tam));
    return trozos;
}

/**
 * Envía un correo.
 *
 * Con un destinatario hace un envío simple. Con varios usa el LOTE, que manda
 * un correo separado a cada uno en UNA sola petición: así nadie ve las
 * direcciones de los demás —antes iban todos en el mismo `to`— y no se agota
 * el límite de 2 peticiones por segundo de Resend.
 *
 * Lanza si no hay canal o si el envío falla: quien llama decide si eso rompe
 * el flujo (un nodo Email) o solo se traga (un aviso de cortesía del cron).
 */
export async function enviarEmail(
    to: string | string[],
    subject: string,
    html: string,
    from?: string,
): Promise<string | null> {
    const destinatarios = normalizarDestinatarios(to);
    if (destinatarios.length === 0) throw new Error('Sin destinatarios válidos.');

    const replyTo = replyToDe(from);

    if (destinatarios.length === 1) {
        const ids = await pedir('/emails', construirPayload({ to: destinatarios, subject, html }, replyTo));
        return ids[0] ?? null;
    }

    const ids: string[] = [];
    for (const trozo of trocear(destinatarios, MAX_POR_LOTE)) {
        const lote = trozo.map(d => construirPayload({ to: d, subject, html }, replyTo));
        ids.push(...await pedir('/emails/batch', lote));
    }
    return ids.length > 0 ? ids.join(',') : null;
}

/**
 * Envía correos con cuerpo distinto para cada destinatario, en una sola
 * petición por cada 100.
 *
 * Existe para los avisos que saludan por el nombre («Hola, Ana»), que antes se
 * mandaban en un bucle con una petición por persona: un rol con cinco
 * aprobadores se comía el límite de 2 peticiones/s de Resend y empezaba a
 * recibir 429.
 *
 * El lote es atómico: `construirPayload` valida los mensajes uno a uno antes
 * de salir, porque un solo destinatario mal escrito tumbaría el envío entero.
 */
export async function enviarEmailPersonalizado(
    mensajes: MensajeEmail[],
    from?: string,
): Promise<string[]> {
    if (mensajes.length === 0) return [];

    const replyTo = replyToDe(from);
    const payloads = mensajes.map(m => construirPayload(m, replyTo));

    const ids: string[] = [];
    for (const trozo of trocear(payloads, MAX_POR_LOTE)) {
        ids.push(...await pedir('/emails/batch', trozo));
    }
    return ids;
}
