import { useEffect, useRef } from 'react';

// Captcha Cloudflare Turnstile (paso 7 del blindaje, 28/10/2026). Portado de
// RiskGuard (`3460c73`).
//
// Hay tres entradas por contraseña y las tres lo llevan:
//   - el login y la verificación de la clave actual al cambiarla
//     (`signInWithPassword`): el token lo valida GoTrue;
//   - «¿Olvidaste tu contraseña?», que va por `request-password-reset`
//     (`generateLink`, que GoTrue NO protege): el token lo valida esa función.
// La clave secreta vive solo en el panel de Supabase y en Edge Secrets.
//
// Cada token vale una vez: tras cada intento quien lo usa remonta el widget
// cambiando su `key`.

/**
 * Clave del SITIO (pública). Sin ella no se pinta el widget y se entra como
 * antes: así el código se publica antes de encender el interruptor del panel.
 */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let cargaScript: Promise<void> | null = null;

function cargarTurnstile(): Promise<void> {
    if (window.turnstile) return Promise.resolve();
    if (!cargaScript) {
        cargaScript = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = SCRIPT_URL;
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => { cargaScript = null; reject(new Error('No se pudo cargar el captcha')); };
            document.head.appendChild(s);
        });
    }
    return cargaScript;
}

interface TurnstileProps {
    siteKey: string;
    /** Token válido, o null si caducó, falló o aún no hay. */
    onToken: (token: string | null) => void;
    theme?: 'light' | 'dark';
}

export function Turnstile({ siteKey, onToken, theme = 'dark' }: TurnstileProps) {
    const contenedor = useRef<HTMLDivElement>(null);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useEffect(() => {
        let widgetId: string | null = null;
        let vivo = true;
        cargarTurnstile()
            .then(() => {
                if (!vivo || !contenedor.current || !window.turnstile) return;
                widgetId = window.turnstile.render(contenedor.current, {
                    sitekey: siteKey,
                    theme,
                    size: 'flexible',
                    language: 'es',
                    callback: token => onTokenRef.current(token),
                    'expired-callback': () => onTokenRef.current(null),
                    'error-callback': () => onTokenRef.current(null),
                });
            })
            .catch(() => onTokenRef.current(null));
        return () => {
            vivo = false;
            onTokenRef.current(null);
            if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
        };
    }, [siteKey, theme]);

    return <div ref={contenedor} style={{ minHeight: '65px' }} />;
}
