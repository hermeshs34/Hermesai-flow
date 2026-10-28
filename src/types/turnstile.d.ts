// API mínima de Cloudflare Turnstile que usan el login y el cambio de clave (render explícito).
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/

interface TurnstileOpciones {
    sitekey: string
    theme?: 'light' | 'dark' | 'auto'
    size?: 'normal' | 'flexible' | 'compact'
    language?: string
    callback?: (token: string) => void
    'expired-callback'?: () => void
    'error-callback'?: () => void
}

interface TurnstileApi {
    render: (contenedor: HTMLElement, opciones: TurnstileOpciones) => string
    remove: (widgetId: string) => void
}

interface Window {
    turnstile?: TurnstileApi
}
