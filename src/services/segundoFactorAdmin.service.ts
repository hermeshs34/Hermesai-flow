import { supabase } from '../core/supabase';
import { mensajeDeEdgeFunction } from '../utils/errores';

/**
 * Segundo factor de OTROS usuarios, visto por el admin (27/10/2026).
 *
 * Todo pasa por la Edge Function `segundo-factor-admin`: borrar un factor ajeno
 * exige la API de administración de Auth (clave de servicio), que no puede
 * vivir en el navegador. La función comprueba rol admin activo, misma
 * organización y que el admin pasó su propio segundo factor, y deja rastro en
 * `audit_log` ANTES de borrar.
 *
 * No hay «activar»: el alta la hace el propio usuario. Quitarlo le obliga a dar
 * de alta uno nuevo en su próximo inicio de sesión si la plataforma lo exige.
 */

/** Factores verificados por id de usuario. Un usuario ausente es «no se sabe», no cero. */
export type FactoresPorUsuario = Record<string, number>;

export interface EstadoFactores {
    factores:   FactoresPorUsuario;
    /**
     * Ids cuyo factor quien consulta NO puede quitar: los administradores de la
     * plataforma, salvo para otro administrador de la plataforma. Solo decide
     * qué se pinta; quien lo impide es la Edge Function.
     */
    protegidos: Set<string>;
}

export const segundoFactorAdminService = {
    async estado(): Promise<EstadoFactores> {
        const { data, error } = await supabase.functions.invoke('segundo-factor-admin', {
            body: { accion: 'estado' },
        });
        if (error) throw new Error(await mensajeDeEdgeFunction(error, 'No se pudo consultar el segundo factor de los usuarios.'));
        const d = data as { factores?: FactoresPorUsuario; protegidos?: string[] } | null;
        return { factores: d?.factores ?? {}, protegidos: new Set(d?.protegidos ?? []) };
    },

    /** Quita todos los factores del usuario. Devuelve cuántos quitó. */
    async quitar(userId: string): Promise<number> {
        const { data, error } = await supabase.functions.invoke('segundo-factor-admin', {
            body: { accion: 'quitar', auth_user_id: userId },
        });
        if (error) throw new Error(await mensajeDeEdgeFunction(error, 'No se pudo quitar el segundo factor.'));
        return Number((data as { quitados?: number } | null)?.quitados ?? 0);
    },
};
