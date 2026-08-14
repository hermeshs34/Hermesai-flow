import { ROLE_PERMISSIONS, ROL_META } from '../core/user.types.ts';
import type { Permission, Role } from '../core/user.types.ts';

// ─── Roles legacy ────────────────────────────────────────────────────────────
// No se ofrecen en la UI (CLAUDE.md §6), así que tampoco se nombran cuando hay
// que explicarle a alguien quién sí puede hacer algo: citar "Editor" a un
// Oficial de Cumplimiento no le ayuda a resolver nada.
const ROLES_LEGACY: Role[] = ['editor', 'operator', 'viewer'];

/**
 * Los roles vigentes que tienen `permiso`, con su etiqueta visible, en una
 * frase: «Administrador, Dueño de Proceso o Autorizador Máximo».
 *
 * Se deriva de ROLE_PERMISSIONS en vez de escribirse a mano para que un cambio
 * en la matriz de permisos no deje el mensaje mintiendo. Es el mismo motivo por
 * el que este proyecto arrastra listas duplicadas señalizadas: aquí no hace
 * falta duplicar nada, así que no se duplica.
 */
export function rolesQuePueden(permiso: Permission): string {
    const etiquetas = (Object.keys(ROLE_PERMISSIONS) as Role[])
        .filter(r => !ROLES_LEGACY.includes(r) && ROLE_PERMISSIONS[r].includes(permiso))
        .map(r => ROL_META[r].label);

    if (etiquetas.length === 0) return 'ningún rol';
    if (etiquetas.length === 1) return etiquetas[0];
    return `${etiquetas.slice(0, -1).join(', ')} o ${etiquetas[etiquetas.length - 1]}`;
}

/**
 * ¿Es un rechazo de RLS de Postgres?
 *
 * `42501` es `insufficient_privilege`. El texto se comprueba además porque no
 * todas las capas conservan el código: si algún punto intermedio ya envolvió el
 * error en `new Error(error.message)`, lo único que queda es el mensaje.
 */
export function esRechazoDePermiso(err: unknown): boolean {
    if (!err) return false;
    const e = err as { code?: string; message?: string };
    return e.code === '42501' || /row-level security/i.test(e.message ?? '');
}

/**
 * Traduce el fallo de una escritura a Supabase.
 *
 * «new row violates row-level security policy for table "workflow_nodes"» es
 * exacto y es inútil: no dice qué hacer ni quién puede hacerlo. El usuario que
 * lo vio era un Oficial de Cumplimiento, que no tiene `manage_workflows` y por
 * tanto no puede editar flujos — un "no" perfectamente legítimo, mal contado.
 *
 * @param que  qué se estaba escribiendo, para la frase: 'los nodos', 'las conexiones'
 */
export function mensajeDeEscritura(err: unknown, que: string): string {
    if (esRechazoDePermiso(err)) {
        return `No tienes permiso para editar flujos, así que no se guardaron ${que}. ` +
               `Editar flujos es de ${rolesQuePueden('manage_workflows')}.`;
    }
    const mensaje = (err as { message?: string })?.message;
    return `No se pudieron guardar ${que}${mensaje ? `: ${mensaje}` : ''}.`;
}

/**
 * Traduce el fallo de un `supabase.rpc(...)`.
 *
 * Una función de la base puede fallar por dos motivos muy distintos, y no se
 * cuentan igual:
 *
 *   · `P0001` (raise_exception) — lo levantó un `RAISE EXCEPTION` NUESTRO, y
 *     ese texto está escrito para quien está editando un flujo. Pasarlo tal
 *     cual: envolverlo en «No se pudieron guardar…: » solo lo empeora.
 *   · cualquier otro — se cuenta como una escritura fallida normal, incluido
 *     el 42501 de la RLS, que `mensajeDeEscritura` sí sabe explicar.
 */
export function mensajeDeRpc(err: unknown, que: string): string {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'P0001' && e.message?.trim()) return e.message;
    return mensajeDeEscritura(err, que);
}

/**
 * Saca el mensaje REAL del error de una Edge Function.
 *
 * `supabase.functions.invoke` no mira el cuerpo de la respuesta: ante cualquier
 * status fuera de 2xx devuelve un `FunctionsHttpError` cuyo `.message` es
 * siempre «Edge Function returned a non-2xx status code». El motivo de verdad
 * viaja en el cuerpo JSON, accesible por `.context`, que es la Response.
 *
 * Es decir: la función SÍ explicaba el problema —`execute-workflow` responde
 * 403 con `{ error: 'El rol "cumplimiento" no puede ejecutar flujos' }`— y el
 * navegador tiraba esa explicación a la basura. Leerla es todo el arreglo.
 */
export async function mensajeDeEdgeFunction(err: unknown, respaldo: string): Promise<string> {
    const contexto = (err as { context?: Response })?.context;

    if (contexto && typeof contexto.json === 'function') {
        try {
            const cuerpo = await contexto.clone().json();
            if (typeof cuerpo?.error === 'string' && cuerpo.error.trim() !== '') {
                return cuerpo.error;
            }
        } catch {
            // Cuerpo vacío o no-JSON (un 500 del gateway, por ejemplo): se cae al
            // respaldo. Tragarse esto es correcto — el error que importa es el de
            // fuera, no el de no haber podido leerlo.
        }
    }

    const mensaje = (err as { message?: string })?.message;
    if (mensaje && !/non-2xx status code/i.test(mensaje)) return mensaje;
    return respaldo;
}
