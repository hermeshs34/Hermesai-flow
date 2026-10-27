import { supabase } from '../core/supabase';

/**
 * Sesiones abiertas del usuario: verlas y cerrar las demás (27/10/2026).
 *
 * `auth.sessions` no se expone. Se lee y se borra a través de `mis_sesiones()`
 * y `cerrar_sesiones(ids)` (20261027b), `SECURITY DEFINER`, que solo tocan las
 * sesiones de quien llama —filtran por `auth.uid()`, no por `organization_id`:
 * una sesión es de una persona, no de una organización— y exigen
 * `mfa_satisfecho()`.
 *
 * Cerrar corta al momento en cuanto haya políticas `_aal2`: `mfa_satisfecho()`
 * exige que la sesión del JWT siga existiendo. Hasta entonces, la sesión
 * cerrada conserva su access token ~1 h.
 *
 * La sesión actual no se cierra desde aquí: para eso está «Cerrar sesión».
 */

export interface SesionAbierta {
    id:        string;
    creada:    string;
    ultimoUso: string;
    /** `aal1` = solo contraseña; `aal2` = pasó el segundo factor. */
    nivel:     string;
    navegador: string;
    ip:        string | null;
    actual:    boolean;
}

interface FilaSesion {
    id:         string;
    creada:     string;
    ultimo_uso: string;
    nivel:      string;
    navegador:  string | null;
    ip:         string | null;
    actual:     boolean;
}

const NAVEGADORES: [RegExp, string][] = [
    [/Edg\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/Firefox\//, 'Firefox'],
    [/Chrome\//, 'Chrome'],
    [/Safari\//, 'Safari'],
];

const SISTEMAS: [RegExp, string][] = [
    [/iPhone/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/Linux/, 'Linux'],
];

/**
 * «Firefox en Windows» a partir del user agent. El orden de las listas importa:
 * Edge y Opera se anuncian también como Chrome, y Android como Linux.
 */
export function describirNavegador(userAgent: string | null): string {
    if (!userAgent) return 'Navegador desconocido';
    const navegador = NAVEGADORES.find(([re]) => re.test(userAgent))?.[1];
    if (!navegador) return 'Navegador desconocido';
    const sistema = SISTEMAS.find(([re]) => re.test(userAgent))?.[1];
    return sistema ? `${navegador} en ${sistema}` : navegador;
}

export const sesionesService = {
    /** Las sesiones abiertas del usuario, la actual primero y luego por último uso. */
    async listar(): Promise<SesionAbierta[]> {
        const { data, error } = await supabase.rpc('mis_sesiones');
        if (error) {
            console.error('[Sesiones] mis_sesiones:', error.message);
            throw new Error('No se pudieron cargar las sesiones abiertas.');
        }
        return ((data ?? []) as FilaSesion[])
            .map(f => ({
                id:        f.id,
                creada:    f.creada,
                ultimoUso: f.ultimo_uso,
                nivel:     f.nivel,
                navegador: describirNavegador(f.navegador),
                ip:        f.ip,
                actual:    f.actual,
            }))
            .sort((a, b) => Number(b.actual) - Number(a.actual) || b.ultimoUso.localeCompare(a.ultimoUso));
    },

    /** Cierra las sesiones indicadas o, sin ids, todas menos la actual. Devuelve cuántas cerró. */
    async cerrar(ids?: string[]): Promise<number> {
        const { data, error } = await supabase.rpc('cerrar_sesiones', ids ? { ids } : {});
        if (error) {
            console.error('[Sesiones] cerrar_sesiones:', error.code, error.message);
            throw new Error(
                error.code === '42501'
                    ? 'Para cerrar sesiones tienes que haber verificado tu segundo factor.'
                    : 'No se pudieron cerrar las sesiones.'
            );
        }
        return Number(data ?? 0);
    },
};
