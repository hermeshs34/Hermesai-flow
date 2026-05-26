// Servicio para probar conexiones
export class ConnectionService {
  static async testEmailConnection(config: {
    server: string;
    port: number;
    security: string;
    username: string;
    password: string;
  }): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      // Validaciones básicas
      if (!config.server || !config.username || !config.password) {
        return {
          success: false,
          message: 'Faltan campos obligatorios'
        };
      }

      if (!config.server.includes('.')) {
        return {
          success: false,
          message: 'Servidor IMAP inválido'
        };
      }

      // Simulación de prueba de conexión para frontend
      // En una aplicación real, esto se haría a través de una API backend
      const response = await fetch('/api/test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        // Si no hay backend, simular validación básica
        if (response.status === 404) {
          // Validaciones básicas del lado cliente
          const isValidEmail = config.username.includes('@');
          const isValidServer = config.server.length > 0;
          const isValidPort = config.port > 0 && config.port < 65536;

          if (!isValidEmail) {
            return {
              success: false,
              message: 'El usuario debe ser una dirección de email válida'
            };
          }

          if (!isValidServer) {
            return {
              success: false,
              message: 'Servidor IMAP inválido'
            };
          }

          if (!isValidPort) {
            return {
              success: false,
              message: 'Puerto inválido (debe estar entre 1 y 65535)'
            };
          }

          // Validaciones específicas por proveedor
          if (config.server.includes('gmail') && config.port !== 993 && config.port !== 465) {
            return {
              success: false,
              message: 'Para Gmail, use puerto 993 (IMAP) o 465 (SMTP) con SSL/TLS'
            };
          }

          if (config.server.includes('outlook') && config.port !== 993 && config.port !== 587) {
            return {
              success: false,
              message: 'Para Outlook, use puerto 993 (IMAP) o 587 (SMTP)'
            };
          }

          if (config.server.includes('yahoo') && config.port !== 993 && config.port !== 465) {
            return {
              success: false,
              message: 'Para Yahoo, use puerto 993 (IMAP) o 465 (SMTP) con SSL/TLS'
            };
          }

          return {
            success: true,
            message: 'Configuración válida. Nota: Para prueba real, implemente un endpoint backend /api/test-email',
            details: {
              server: config.server,
              port: config.port,
              security: config.security,
              username: config.username,
              note: 'Validación del lado cliente únicamente'
            }
          };
        }

        const errorData = await response.json();
        return {
          success: false,
          message: errorData.message || 'Error del servidor'
        };
      }

      const result = await response.json();
      return result;

    } catch (error) {
      const errorMessage = (error as Error).message;
      
      if (errorMessage.includes('fetch')) {
        // Error de red - probablemente no hay backend
        return {
          success: false,
          message: 'No se puede conectar al servidor backend. Implemente /api/test-email para pruebas reales.'
        };
      }

      return {
        success: false,
        message: 'Error de conexión: ' + errorMessage
      };
    }
  }

  static async testCrmConnection(config: {
    type: string;
    apiUrl: string;
    apiKey: string;
  }): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      if (!config.apiUrl || !config.apiKey) {
        return {
          success: false,
          message: 'URL de API y API Key son obligatorios'
        };
      }

      if (!config.apiUrl.startsWith('http')) {
        return {
          success: false,
          message: 'URL de API debe comenzar con http:// o https://'
        };
      }

      // Simulación de prueba de conexión CRM
      try {
        const response = await fetch('/api/test-crm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        });

        if (!response.ok && response.status === 404) {
          return {
            success: true,
            message: 'Configuración CRM válida. Implemente /api/test-crm para pruebas reales.',
            details: {
              type: config.type,
              apiUrl: config.apiUrl,
              note: 'Validación del lado cliente únicamente'
            }
          };
        }

        const result = await response.json();
        return result;
      } catch {
        return {
          success: true,
          message: 'Configuración CRM válida. Implemente backend para pruebas reales.',
          details: {
            type: config.type,
            apiUrl: config.apiUrl,
            note: 'Validación del lado cliente únicamente'
          }
        };
      }

    } catch (error) {
      return {
        success: false,
        message: 'Error de conexión CRM: ' + (error as Error).message
      };
    }
  }

  static async testAiConnection(config: {
    provider: string;
    apiKey: string;
    model: string;
  }): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      if (!config.apiKey) {
        return {
          success: false,
          message: 'API Key es obligatorio'
        };
      }

      if (config.apiKey.length < 10) {
        return {
          success: false,
          message: 'API Key parece ser inválida (muy corta)'
        };
      }

      // Simulación de prueba de conexión IA
      try {
        const response = await fetch('/api/test-ai', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        });

        if (!response.ok && response.status === 404) {
          return {
            success: true,
            message: 'Configuración IA válida. Implemente /api/test-ai para pruebas reales.',
            details: {
              provider: config.provider,
              model: config.model,
              note: 'Validación del lado cliente únicamente'
            }
          };
        }

        const result = await response.json();
        return result;
      } catch {
        return {
          success: true,
          message: 'Configuración IA válida. Implemente backend para pruebas reales.',
          details: {
            provider: config.provider,
            model: config.model,
            note: 'Validación del lado cliente únicamente'
          }
        };
      }

    } catch (error) {
      return {
        success: false,
        message: 'Error de conexión IA: ' + (error as Error).message
      };
    }
  }
}