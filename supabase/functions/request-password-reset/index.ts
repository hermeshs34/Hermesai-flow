// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Recuperar mi contraseña (autoservicio)
//
// Endpoint PÚBLICO: quien lo llama no puede iniciar sesión, ese es el problema
// que viene a resolver. Se despliega con --no-verify-jwt.
//
// El enlace lo fabrica Supabase Auth (generateLink) pero lo manda RESEND, por
// _shared/email.ts. No se usa `resetPasswordForEmail` a propósito: ese haría
// salir el correo por el mailer propio de Supabase, que sería un SEGUNDO canal
// de salida contra la regla de CLAUDE.md 9.1 («el correo sale por un solo
// sitio»), con otro remitente, otra plantilla y otra reputación de dominio que
// nadie vigila. Aquí solo se pide el enlace; el sobre lo pone el producto.
//
// Al ser público y mandar correo, tiene tres defensas:
//   - Respuesta SIEMPRE idéntica: no dice si el correo existe (enumeración).
//   - Cuentas desactivadas: no se les manda nada.
//   - Límite de 3 solicitudes por cuenta cada 15 minutos.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enviarEmail, escaparHtml } from '../_shared/email.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// A dónde vuelve la persona al pulsar el enlace. Va en Supabase Secrets porque
// cambia entre el sitio de Netlify y cualquier previsualización, y tiene que
// estar además en Authentication → URL Configuration → Redirect URLs, o Supabase
// descarta el redirectTo y devuelve al Site URL por defecto.
const APP_URL = Deno.env.get('APP_URL') ?? '';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_SOLICITUDES = 3;
const VENTANA_MINUTOS = 15;

// Lo que se responde pase lo que pase: exista el correo o no, esté la cuenta
// activa o no, se haya pasado del límite o no. Si la respuesta cambiara, este
// endpoint sería un comprobador de «¿trabaja fulano aquí?» abierto a internet.
const RESPUESTA_NEUTRA = {
    success: true,
    message: 'Si ese correo corresponde a una cuenta activa, recibirás un enlace para restablecer tu contraseña.',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        const { email } = await req.json();
        const cleanEmail = String(email ?? '').trim().toLowerCase();

        // Un correo vacío sí es un error de forma, no una pista sobre nadie.
        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return json({ error: 'Escribe un correo electrónico válido.' }, 400);
        }

        if (!APP_URL) {
            // Sin esto el enlace llevaría a cualquier parte. Falla ruidosamente:
            // un correo con un enlace roto es peor que un error en pantalla.
            console.error('[request-password-reset] Falta el secreto APP_URL');
            return json({ error: 'La recuperación de contraseña no está configurada. Avisa al administrador.' }, 500);
        }

        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        const { data: perfil, error: perfilErr } = await admin
            .from('profiles')
            .select('id, name, email, organization_id, is_active')
            .eq('email', cleanEmail)
            .maybeSingle();

        // Un fallo de lectura NO se disfraza de «ya está enviado»: sería el
        // patrón de siempre —un instrumento que dice «bien» sin haber medido—.
        if (perfilErr) {
            console.error('[request-password-reset] profiles:', perfilErr.message);
            return json({ error: 'No se pudo procesar la solicitud. Inténtalo de nuevo.' }, 500);
        }

        // Desde aquí abajo, todas las salidas son RESPUESTA_NEUTRA.
        if (!perfil)          return json(RESPUESTA_NEUTRA);
        if (!perfil.is_active) return json(RESPUESTA_NEUTRA);

        // Límite por cuenta. Se cuenta sobre la propia traza de auditoría, que
        // es donde ya queda registrada cada solicitud: sin tabla nueva y con el
        // recuento visible para quien audite.
        const desde = new Date(Date.now() - VENTANA_MINUTOS * 60_000).toISOString();
        const { count, error: countErr } = await admin
            .from('audit_log')
            .select('id', { count: 'exact', head: true })
            .eq('entidad', 'sesion')
            .eq('entidad_id', perfil.id)
            .gte('created_at', desde);

        if (countErr) {
            console.error('[request-password-reset] recuento:', countErr.message);
            return json({ error: 'No se pudo procesar la solicitud. Inténtalo de nuevo.' }, 500);
        }
        if ((count ?? 0) >= MAX_SOLICITUDES) {
            console.warn(`[request-password-reset] límite alcanzado para ${cleanEmail}`);
            return json(RESPUESTA_NEUTRA);
        }

        // Enlace de recuperación. Supabase lo firma y lo caduca (1 hora por
        // defecto); aquí solo se transporta.
        const { data: enlace, error: enlaceErr } = await admin.auth.admin.generateLink({
            type:  'recovery',
            email: cleanEmail,
            options: { redirectTo: APP_URL },
        });

        if (enlaceErr || !enlace?.properties?.action_link) {
            console.error('[request-password-reset] generateLink:', enlaceErr?.message ?? 'sin action_link');
            return json({ error: 'No se pudo generar el enlace. Inténtalo de nuevo.' }, 500);
        }

        const url = enlace.properties.action_link;
        const nombre = escaparHtml(perfil.name?.split(' ')[0] ?? '');

        await enviarEmail(
            cleanEmail,
            'Restablecer tu contraseña — HermesAI Flow',
            `
            <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
                <h2 style="color:#4f46e5;margin:0 0 16px">Restablecer tu contraseña</h2>
                <p style="font-size:15px;line-height:1.6">Hola${nombre ? ` ${nombre}` : ''}:</p>
                <p style="font-size:15px;line-height:1.6">
                    Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de
                    <strong>HermesAI Flow</strong>. Pulsa el botón y elige una contraseña nueva.
                </p>
                <p style="text-align:center;margin:28px 0">
                    <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">
                        Elegir contraseña nueva
                    </a>
                </p>
                <p style="font-size:13px;color:#64748b;line-height:1.6">
                    El enlace caduca en 1 hora y solo se puede usar una vez.
                </p>
                <p style="font-size:13px;color:#64748b;line-height:1.6">
                    <strong>Si no has sido tú</strong>, no hagas nada: tu contraseña actual sigue
                    funcionando y nadie ha entrado en tu cuenta. Avisa al administrador.
                </p>
                <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
                <p style="font-size:11px;color:#94a3b8">
                    HermesAI Flow — mensaje automático, no respondas a este correo.
                </p>
            </div>`,
        );

        // Traza. No se guarda el enlace: es una credencial de un solo uso.
        // usuario_id va NULL a propósito — quien pide un restablecimiento no ha
        // iniciado sesión, así que no sabemos quién es; solo sabemos a qué
        // cuenta apunta.
        const { error: auditErr } = await admin.from('audit_log').insert({
            organization_id: perfil.organization_id,
            usuario_id:      null,
            usuario_email:   cleanEmail,
            accion:          'modificar',
            entidad:         'sesion',
            entidad_id:      perfil.id,
            descripcion:     `Solicitud de recuperación de contraseña para ${perfil.email}`,
        });
        if (auditErr) console.error('[request-password-reset] audit_log:', auditErr.message);

        return json(RESPUESTA_NEUTRA);

    } catch (err) {
        console.error('[request-password-reset]', err);
        return json({ error: 'No se pudo procesar la solicitud. Inténtalo de nuevo.' }, 500);
    }
});

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });
}
