import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../core/supabase.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Delegaciones vigentes (frontend)
//
// ⚠️ GEMELO de `supabase/functions/_shared/delegaciones.ts`. **Manda el de
// Deno**: es el que deja aprobar de verdad y el que elige destinatarios de
// correo. Este solo pinta botones y contadores. Si cambias uno, cambia el otro.
// Misma familia que `fecha.ts` (§9.3) y `matriz.ts` (§6.5).
//
// Y tienen que decir lo mismo por el motivo de §12.2: una pantalla que ofrece
// «Aprobar» y luego se come un 403 no es un fallo de permisos, es un fallo de
// la pantalla. Al revés —esconder el botón a quien SÍ puede— deja la suplencia
// sin servir para nada, que es justo lo que hay que arreglar.
// ═══════════════════════════════════════════════════════════════════════════

export interface DelegacionVigente {
    delegacionId:  string;
    titularId:     string;
    titularNombre: string;
    titularEmail:  string;
    rol:           string;   // el rol del titular HOY, no una copia congelada
    hasta:         string;
}

/**
 * Roles que este usuario puede ejercer ahora mismo por delegación.
 *
 * No es recursivo a propósito: si A delega en B y B delega en C, C no hereda
 * el rol de A. Una cadena de suplencias es una autorización que no tomó nadie.
 */
export async function delegacionesVigentes(
    usuarioId: string,
    organizationId: string,
): Promise<DelegacionVigente[]> {
    const ahora = new Date().toISOString();

    const { data, error } = await supabase
        .from('delegaciones')
        .select('id, usuario_id, hasta, titular:usuario_id(name, email, role, is_active)')
        .eq('organization_id', organizationId)
        .eq('suplente_id', usuarioId)
        .lte('desde', ahora)
        .gte('hasta', ahora);

    // supabase-js devuelve el error, no lo lanza. Aquí sí se traga —a propósito—
    // devolviendo lista vacía: el peor caso es que el botón no se pinte y la
    // persona vea la tarea como ajena, nunca que se pinte de más. La puerta la
    // guarda `resolve-approval`, no esto.
    if (error) {
        console.error('No se pudieron leer las delegaciones vigentes:', error.message);
        return [];
    }

    type Fila = {
        id: string;
        usuario_id: string;
        hasta: string;
        titular: { name?: string; email?: string; role?: string; is_active?: boolean } | null;
    };

    return ((data ?? []) as unknown as Fila[])
        .filter(d => d.titular?.is_active === true && !!d.titular?.role)
        .map(d => ({
            delegacionId:  d.id,
            titularId:     d.usuario_id,
            titularNombre: d.titular!.name ?? d.titular!.email ?? 'sin nombre',
            titularEmail:  d.titular!.email ?? '',
            rol:           d.titular!.role!,
            hasta:         d.hasta,
        }));
}

/** Atajo: solo los roles, que es lo que necesita `puedeResolverTarea`. */
export async function rolesDelegados(usuarioId: string, organizationId: string): Promise<string[]> {
    const vigentes = await delegacionesVigentes(usuarioId, organizationId);
    return [...new Set(vigentes.map(d => d.rol))];
}

// ─── Lo que sigue NO es parte del gemelo ─────────────────────────────────────
// Un hook de React no tiene equivalente en Deno. Se queda aquí para que todo lo
// que sabe de delegaciones en el navegador esté en un archivo, y no repartido
// por las cuatro pantallas que lo necesitan — que es exactamente como se pudrió
// `puedeResolverTarea` antes del 14/08.

/**
 * Los roles que este usuario ejerce por suplencia, para las cuatro pantallas que
 * pintan botones o contadores de aprobación.
 *
 * Se recarga al cambiar `delegaciones`: si un titular deja una suplencia mientras
 * el suplente tiene la Cola de Trabajo abierta, el botón debe aparecer sin que
 * haga falta refrescar. La alternativa —leerlo una vez al montar— deja la
 * pantalla contando algo que dejó de ser cierto, que es el fallo de §12.2.
 */
export function useRolesDelegados(
    usuarioId: string | undefined,
    organizationId: string | undefined,
): string[] {
    const [roles, setRoles] = useState<string[]>([]);

    const cargar = useCallback(async () => {
        if (!usuarioId || !organizationId) { setRoles([]); return; }
        setRoles(await rolesDelegados(usuarioId, organizationId));
    }, [usuarioId, organizationId]);

    useEffect(() => {
        cargar();
        const ch = supabase
            .channel(`delegaciones-${usuarioId ?? 'anon'}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'delegaciones' }, cargar)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [cargar, usuarioId]);

    return roles;
}
