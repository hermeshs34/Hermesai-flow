// Webhook de entrada — ver docs/superpowers/specs/2026-09-28-webhook-entrada-design.md

export type EstadoRecepcion =
    | 'aceptada'
    | 'lanzada'
    | 'fallo_al_lanzar'
    | 'rechazada_inactivo'
    | 'frenada_limite'
    | 'duplicada';

/** Lo que la organización puede leer de `workflow_webhooks` (nunca la huella). */
export interface WebhookConfig {
    permiteSecretoUrl: boolean;
    generadoEmail:     string | null;
    generadoAt:        string;
}

export interface RecepcionWebhook {
    id:             string;
    recibidoAt:     string;
    estado:         EstadoRecepcion;
    motivo:         string | null;
    eventoId:       string | null;
    executionRunId: string | null;
}
