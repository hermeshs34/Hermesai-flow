// ── ConnectionService ─────────────────────────────────────────────────────
// Valida configuraciones de integración del lado cliente (formato/campos).
// Las pruebas de conexión reales deben hacerse a través de la Edge Function
// correspondiente — este servicio NO hace llamadas directas a APIs externas.
// ─────────────────────────────────────────────────────────────────────────────

export interface TestResult {
    success: boolean;
    message: string;
    details?: Record<string, unknown>;
}

// Aquí vivía `validateEmailConfig`, que pedía servidor, puerto, seguridad,
// usuario y contraseña, y sugería el puerto 993 o el 465 según fuera Gmail u
// Outlook. No lo llamaba nadie, y describía un correo que este producto ya no
// tiene: se envía por la API de Resend desde `_shared/email.ts`, sin servidor ni
// puerto ni credencial que el usuario pueda teclear. Su comentario remitía
// además a una Edge Function `node-email` que nunca se escribió (ver §4 del
// CLAUDE.md). Borrado el 07/08/2026 al migrar el correo a Resend.

export class ConnectionService {

    /**
     * Valida la configuración de una integración externa.
     * Las credenciales reales (API keys) deben estar en Supabase Secrets, no aquí.
     */
    static validateIntegrationConfig(config: {
        name: string;
        supabaseUrl?: string;
        apiUrl?: string;
    }): TestResult {
        if (!config.supabaseUrl && !config.apiUrl) {
            return { success: false, message: 'URL de la integración es obligatoria' };
        }

        const url = config.supabaseUrl ?? config.apiUrl ?? '';
        if (!url.startsWith('https://')) {
            return { success: false, message: 'La URL debe comenzar con https://' };
        }
        if (!url.includes('.supabase.co') && !url.startsWith('https://api.')) {
            return { success: false, message: 'URL no reconocida — verifica que sea la URL de Supabase del sistema origen' };
        }

        return {
            success: true,
            message: `Configuración de ${config.name} válida. La conexión real se verifica cuando el flujo se ejecuta.`,
            details: { url },
        };
    }

    /**
     * Valida que la configuración de un proveedor de IA tiene estructura correcta.
     * La API key real va en Supabase Secrets (ANTHROPIC_API_KEY), no en config_json.
     */
    static validateAiConfig(config: {
        provider: string;
        model: string;
    }): TestResult {
        if (!config.provider) {
            return { success: false, message: 'Proveedor de IA es obligatorio' };
        }
        if (!config.model) {
            return { success: false, message: 'Modelo es obligatorio' };
        }

        const supportedProviders = ['anthropic', 'openai'];
        if (!supportedProviders.includes(config.provider.toLowerCase())) {
            return {
                success: false,
                message: `Proveedor no soportado. Usar: ${supportedProviders.join(', ')}`,
            };
        }

        return {
            success: true,
            message: `Configuración de ${config.provider} válida. La API Key debe estar en Supabase Secrets como ANTHROPIC_API_KEY.`,
            details: { provider: config.provider, model: config.model },
        };
    }
}