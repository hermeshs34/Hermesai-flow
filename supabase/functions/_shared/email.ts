// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Único punto de salida de correo
//
// Elige canal solo, por los secrets que encuentre, y en este orden:
//
//   1. GMAIL_USER + GMAIL_APP_PASSWORD  → SMTP de Gmail, smtp.gmail.com:465
//   2. RESEND_API_KEY                   → API de Resend (el camino original)
//   3. ninguno                          → error explícito, nunca silencio
//
// Por qué existe este orden: `onboarding@resend.dev` es un remitente de pruebas
// que dejó de entregar nada en esta cuenta, y verificar un dominio en Resend
// cuesta dinero. El día que se compre el dominio, se borran los dos secrets de
// Gmail y todo vuelve a Resend sin tocar una línea de código.
//
// Puerto: Supabase bloquea el 25 y el 587. El 465 (TLS implícito) sí sale
// — comprobado el 30/07/2026.
//
// Remitente: Gmail solo deja enviar como la cuenta autenticada. Se conserva el
// nombre visible que pida quien llama (incluido el `from` que el usuario
// configure en un nodo Email), pero la dirección pasa a ser GMAIL_USER y la
// original queda como Reply-To.
//
// Librería: se probó denomailer y se descartó. Con un asunto que lleve emoji o
// guion largo —y aquí los asuntos llevan emoji— escribe el encoded-word de RFC
// 2047 con espacios literales dentro y luego parte la cabecera con un salto
// blando de quoted-printable, que en una cabecera no es válido: el bloque de
// cabeceras termina ahí y el From, el To y el Content-Type acaban impresos
// dentro del cuerpo. nodemailer codifica y pliega bien. No volver a denomailer
// sin enviar antes un asunto con acentos y comprobar cómo llega.
// ═══════════════════════════════════════════════════════════════════════════
import nodemailer from 'npm:nodemailer@6.9.16';

const GMAIL_USER         = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? '';
const RESEND_API_KEY     = Deno.env.get('RESEND_API_KEY') ?? '';

const REMITENTE_POR_DEFECTO = 'HermesAI Flow <onboarding@resend.dev>';

export type CanalEmail = 'smtp' | 'resend' | 'ninguno';

/** Qué canal se usaría ahora mismo. Para el health-check y los diagnósticos. */
export function canalEmail(): CanalEmail {
    if (GMAIL_USER && GMAIL_APP_PASSWORD) return 'smtp';
    if (RESEND_API_KEY) return 'resend';
    return 'ninguno';
}

/** Dirección desde la que se envía de verdad, para poder enseñarla en pantalla. */
export function direccionRemitente(): string {
    const canal = canalEmail();
    if (canal === 'smtp')   return GMAIL_USER;
    if (canal === 'resend') return 'onboarding@resend.dev';
    return '';
}

function partirRemitente(from: string): { nombre: string; direccion: string } {
    const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (m) return { nombre: (m[1] ?? '').trim() || 'HermesAI Flow', direccion: (m[2] ?? '').trim() };
    return { nombre: 'HermesAI Flow', direccion: from.trim() };
}

// Se crea una vez y se reutiliza: sin `pool`, nodemailer abre una conexión por
// cada sendMail, así que no queda nada colgando entre invocaciones.
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function obtenerTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host:   'smtp.gmail.com',
            port:   465,
            secure: true, // TLS implícito
            auth:   { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
        });
    }
    return transporter;
}

async function enviarPorSMTP(
    destinatarios: string[], subject: string, html: string, from: string,
): Promise<string> {
    const { nombre, direccion } = partirRemitente(from);

    const info = await obtenerTransporter().sendMail({
        from: `${nombre} <${GMAIL_USER}>`,
        // Si quien llama pidió otro remitente y era una dirección real, al menos
        // que la respuesta le llegue a él y no a la cuenta de servicio.
        ...(direccion && direccion !== GMAIL_USER && !direccion.endsWith('@resend.dev')
            ? { replyTo: direccion }
            : {}),
        to: destinatarios,
        subject,
        html,
    });

    // Se prefija el canal: distingue de un vistazo qué salió por SMTP y qué por
    // Resend, sin tener que mirar la fecha.
    return `smtp:${info.messageId ?? new Date().toISOString()}`;
}

async function enviarPorResend(
    destinatarios: string[], subject: string, html: string, from: string,
): Promise<string | null> {
    const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ from, to: destinatarios, subject, html }),
    });

    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);

    const data = await res.json() as { id?: string };
    return data.id ?? null;
}

/**
 * Envía un correo por el canal disponible.
 * Lanza si no hay canal o si el envío falla: quien llama decide si eso rompe el
 * flujo (un nodo Email) o solo se traga (un aviso de cortesía del cron).
 */
export async function enviarEmail(
    to: string | string[],
    subject: string,
    html: string,
    from: string = REMITENTE_POR_DEFECTO,
): Promise<string | null> {
    const destinatarios = (Array.isArray(to) ? to : [to]).filter(d => d && d.includes('@'));
    if (destinatarios.length === 0) throw new Error('Sin destinatarios válidos.');

    switch (canalEmail()) {
        case 'smtp':
            return await enviarPorSMTP(destinatarios, subject, html, from);
        case 'resend':
            return await enviarPorResend(destinatarios, subject, html, from);
        default:
            throw new Error(
                'No hay canal de correo configurado: faltan GMAIL_USER + GMAIL_APP_PASSWORD y también RESEND_API_KEY.',
            );
    }
}
