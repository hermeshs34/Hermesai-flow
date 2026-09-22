import { supabase } from '../core/supabase';

/**
 * Salud del planificador (pg_cron + pg_net + cron-runner).
 *
 * El Dashboard no puede medir esto por su cuenta: `cron.job`,
 * `cron.job_run_details` y `net._http_response` no los expone PostgREST.
 * Lo hace la RPC `salud_cron()` (20260922_salud_cron.sql), que devuelve un
 * veredicto y nunca el `command` del job — ahí va CRON_SECRET.
 */

export type VeredictoCron =
    | 'ok'             // el reloj late y cron-runner responde 200
    | 'sin_reloj'      // no hay job: nada se ejecuta solo (lo del 10/09/2026)
    | 'reloj_apagado'  // el job existe pero active = false
    | 'reloj_parado'   // el job existe y no se dispara
    | 'sin_respuesta'  // late, pero la llamada HTTP no llega o la rechazan
    | 'desconocido';   // no se pudo comprobar

export interface FalloHttpCron {
    status:  number | null;
    cuando:  string | null;
    timeout: boolean | null;
    error:   string | null;
    cuerpo:  string | null;
}

export interface SaludCron {
    veredicto:             VeredictoCron;
    grave:                 boolean;
    motivo:                string;
    job_existe:            boolean;
    job_nombre:            string | null;
    job_schedule:          string | null;
    job_activo:            boolean | null;
    ultimo_tick:           string | null;
    respuestas_10min:      number;
    respuestas_ok_10min:   number;
    ultimo_fallo_http:     FalloHttpCron | null;
    ultima_ejecucion_cron: string | null;
    medido_at:             string | null;
}

/**
 * `desconocido` NO es `ok`.
 *
 * Si la RPC falla —no está desplegada, la red se cae, el perfil no está
 * activo— lo honesto es decir que no se pudo comprobar. Misma familia que el
 * `NULL` de la huella (§9.5) y el `token !== ''` de §6.1: la comprobación que
 * no se pudo hacer no puede acabar diciendo que sí.
 */
function desconocido(motivo: string): SaludCron {
    return {
        veredicto: 'desconocido', grave: false, motivo,
        job_existe: false, job_nombre: null, job_schedule: null, job_activo: null,
        ultimo_tick: null, respuestas_10min: 0, respuestas_ok_10min: 0,
        ultimo_fallo_http: null, ultima_ejecucion_cron: null, medido_at: null,
    };
}

export const SaludService = {
    async cron(): Promise<SaludCron> {
        // supabase-js no lanza: devuelve el error. Un `{ error }` que nadie lee
        // convierte un fallo en silencio (§5.1, regla 2).
        const { data, error } = await supabase.rpc('salud_cron');
        if (error) {
            return desconocido(`No se pudo comprobar el planificador: ${error.message}`);
        }
        if (!data || typeof data !== 'object') {
            return desconocido('El planificador no devolvió un estado legible.');
        }
        return data as SaludCron;
    },
};
