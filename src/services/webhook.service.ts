import { supabase } from '../core/supabase.ts';
import { mensajeDeRpc } from '../utils/errores.ts';
import type { WebhookConfig, RecepcionWebhook, EstadoRecepcion } from '../types/webhook.ts';

export class WebhookService {
    static urlDelFlujo(workflowId: string): string {
        return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-in/${workflowId}`;
    }

    static async getConfig(workflowId: string, organizationId: string): Promise<WebhookConfig | null> {
        // Columnas explícitas, NUNCA '*': secreto_hash no tiene GRANT de lectura
        // y un select('*') reventaría con «permission denied».
        const { data, error } = await supabase
            .from('workflow_webhooks')
            .select('permite_secreto_url, generado_email, generado_at')
            .eq('workflow_id', workflowId)
            .eq('organization_id', organizationId)
            .maybeSingle();
        if (error) throw new Error(`No se pudo leer la configuración del webhook: ${error.message}`);
        if (!data) return null;
        return {
            permiteSecretoUrl: data.permite_secreto_url as boolean,
            generadoEmail:     (data.generado_email as string | null) ?? null,
            generadoAt:        data.generado_at as string,
        };
    }

    /** Devuelve el secreto EN CLARO. Es la única vez que existe fuera de quien lo recibe. */
    static async generarSecreto(workflowId: string): Promise<string> {
        const { data, error } = await supabase.rpc('generar_secreto_webhook', { p_workflow_id: workflowId });
        if (error) throw new Error(mensajeDeRpc(error, 'los datos del webhook'));
        if (typeof data !== 'string' || !data.startsWith('hfw_')) {
            throw new Error('Se generó un secreto nuevo pero no llegó bien a la pantalla. El anterior ya no vale: vuelve a pulsar «Rotar secreto».');
        }
        return data;
    }

    static async configurarUrl(workflowId: string, permitir: boolean): Promise<void> {
        const { error } = await supabase.rpc('configurar_webhook_url', { p_workflow_id: workflowId, p_permitir: permitir });
        if (error) throw new Error(mensajeDeRpc(error, 'los datos del webhook'));
    }

    static async ultimasRecepciones(workflowId: string, organizationId: string, limite = 10): Promise<RecepcionWebhook[]> {
        const { data, error } = await supabase
            .from('webhook_recepciones')
            .select('id, recibido_at, estado, motivo, evento_id, execution_run_id')
            .eq('workflow_id', workflowId)
            .eq('organization_id', organizationId)
            .order('recibido_at', { ascending: false })
            .limit(limite);
        if (error) throw new Error(`No se pudieron leer las últimas llamadas: ${error.message}`);
        return (data ?? []).map(r => ({
            id:             r.id as string,
            recibidoAt:     r.recibido_at as string,
            estado:         r.estado as EstadoRecepcion,
            motivo:         (r.motivo as string | null) ?? null,
            eventoId:       (r.evento_id as string | null) ?? null,
            executionRunId: (r.execution_run_id as string | null) ?? null,
        }));
    }
}
