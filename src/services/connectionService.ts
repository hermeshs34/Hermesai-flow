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

export class ConnectionService {

    /**
     * Valida la estructura de la configuración de email.
     * Para una prueba de envío real, usar la Edge Function `node-email`.
     */
    static validateEmailConfig(config: {
        server: string;
        port: number;
        security: string;
        username: string;
        password: string;
    }): TestResult {
        if (!config.server || !config.username || !config.password) {
            return { success: false, message: 'Faltan campos obligatorios (servidor, usuario, contraseña)' };
        }
        if (!config.server.includes('.')) {
            return { success: false, message: 'Servidor IMAP inválido — debe ser un hostname (ej: imap.gmail.com)' };
        }
        if (!config.username.includes('@')) {
            return { success: false, message: 'El usuario debe ser una dirección de email válida' };
        }
        if (config.port <= 0 || config.port > 65535) {
            return { success: false, message: 'Puerto inválido — debe estar entre 1 y 65535' };
        }

        // Sugerencias por proveedor
        if (config.server.includes('gmail') && config.port !== 993 && config.port !== 465) {
            return { success: false, message: 'Para Gmail usa puerto 993 (IMAP) o 465 (SMTP) con SSL/TLS' };
        }
        if (config.server.includes('outlook') && config.port !== 993 && config.port !== 587) {
            return { success: false, message: 'Para Outlook usa puerto 993 (IMAP) o 587 (SMTP)' };
        }

        return {
            success: true,
            message: 'Configuración de email válida. Los emails se enviarán a través de Resend (configurado en Supabase Secrets).',
            details: { server: config.server, port: config.port, security: config.security },
        };
    }

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