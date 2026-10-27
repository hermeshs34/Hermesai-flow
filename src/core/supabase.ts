import { createClient } from '@supabase/supabase-js';

const url  = import.meta.env.VITE_SUPABASE_URL  as string;
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
    throw new Error('[HermesAI Flow] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local');
}

export const supabase = createClient(url, key, {
    auth: {
        // ── Un enlace de correo NO es un inicio de sesión ──────────────────
        //
        // Con la opción por defecto (`true`), supabase-js encuentra los tokens
        // que el enlace de recuperación trae en el hash, los canjea y guarda la
        // sesión ANTES de que corra una sola línea de esta aplicación. A partir
        // de ahí la persona está dentro: cierra la pestaña, vuelve a abrir la
        // aplicación y sigue dentro, sin haber recordado nunca su contraseña.
        // Un enlace que hace eso vale tanto como la propia clave, y entonces
        // olvidarla deja de importar.
        //
        // Apagado, ese hash es texto inerte. Los tokens se leen a mano en
        // App.tsx y solo se convierten en sesión durante los segundos que dura
        // el cambio de contraseña (auth.service.abrirRecuperacion, en un cliente en memoria), que termina
        // cerrándola pase lo que pase.
        //
        // Este producto entra SOLO con usuario y contraseña: no hay OAuth ni
        // enlaces mágicos, así que no queda nada más que dependa de esto.
        detectSessionInUrl: false,
    },
});

/**
 * Cliente de un solo uso, con la sesión SOLO en memoria (27/10/2026).
 *
 * Para dos cosas que no deben tocar la sesión de la aplicación:
 *  1. La recuperación de contraseña con segundo factor: la sesión del enlace
 *     tiene que vivir varios pasos (código, clave nueva) y, si la persona
 *     cierra la pestaña a medias, no puede quedar guardada en el navegador —
 *     al volver estaría dentro sin saber la contraseña (§6.4).
 *  2. Comprobar la contraseña actual al cambiarla: un `signInWithPassword`
 *     sobre el cliente principal bajaría la sesión de `aal2` a `aal1`, y el
 *     cambio de clave de quien tiene factor se rechazaría.
 *
 * Sigue siendo el mismo proyecto y la misma clave publicable: no es «otro
 * cliente de Supabase» en el sentido de §4, es otro almacén de sesión.
 */
export function crearClienteEfimero() {
    return createClient(url, key, {
        auth: {
            persistSession:     false,
            autoRefreshToken:   false,
            detectSessionInUrl: false,
            storageKey:         'hf-efimero',
        },
    });
}
