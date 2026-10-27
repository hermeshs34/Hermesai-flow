import { supabase } from '../core/supabase';

/**
 * Política de seguridad de la plataforma (27/10/2026, 20261027b).
 *
 * Una sola fila en `politicas_seguridad`, sin `organization_id` a propósito: no
 * es dato de ninguna organización, es la política de toda la plataforma (la
 * excepción deliberada a la regla de §5 de CLAUDE.md). La lee cualquier
 * usuario con sesión; la cambia solo quien tiene la marca
 * `app_metadata.admin_plataforma` y pasó su segundo factor (RLS). El rol
 * `admin` de una organización NO basta.
 *
 * `exigirMfa` NO es control de acceso. La barrera es `mfa_satisfecho()` y mira
 * el factor del usuario: quien lo tiene necesita el código siempre. Lo único
 * que decide esta fila es si el navegador obliga a dar de alta el factor a
 * quien no lo tiene.
 */

export interface PoliticaSeguridad {
    exigirMfa:   boolean;
    actualizada: string;
}

export const politicasSeguridadService = {
    async leer(): Promise<PoliticaSeguridad> {
        const { data, error } = await supabase
            .from('politicas_seguridad')
            .select('exigir_mfa, updated_at')
            .maybeSingle();
        if (error) {
            console.error('[Política de seguridad] leer:', error.message);
            throw new Error('No se pudo leer la política de seguridad.');
        }
        if (!data) throw new Error('La política de seguridad no tiene fila.');
        return { exigirMfa: data.exigir_mfa === true, actualizada: data.updated_at };
    },

    /**
     * ¿Hay que obligar a dar de alta el segundo factor? Si no se puede leer, sí:
     * ante la duda se exige.
     */
    async exigeMfa(): Promise<boolean> {
        try {
            return (await this.leer()).exigirMfa;
        } catch {
            return true;
        }
    },

    /**
     * Cambia el interruptor. La RLS devuelve 0 filas, sin error, a quien no
     * puede: eso se convierte en error aquí para no dar por hecho lo que no se hizo.
     */
    async cambiarExigirMfa(exigir: boolean): Promise<void> {
        const { data, error } = await supabase
            .from('politicas_seguridad')
            .update({ exigir_mfa: exigir })
            .eq('id', true)
            .select('exigir_mfa');
        if (error) {
            console.error('[Política de seguridad] cambiar:', error.code, error.message);
            throw new Error('No se pudo cambiar la política de seguridad.');
        }
        if (!data || data.length === 0) {
            throw new Error('Solo el administrador de la plataforma, con la verificación en dos pasos hecha en esta sesión, puede cambiarla.');
        }
    },

    /**
     * ¿La sesión trae la marca de administrador de la plataforma? Solo decide
     * si se enseña el interruptor: quien decide si se puede cambiar es la RLS.
     * La marca viaja en el JWT: tras ponerla, cuenta desde el siguiente inicio
     * de sesión.
     */
    async esAdminPlataforma(): Promise<boolean> {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.user.app_metadata?.admin_plataforma === true;
    },
};
