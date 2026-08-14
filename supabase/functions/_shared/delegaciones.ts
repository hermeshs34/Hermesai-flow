// ═══════════════════════════════════════════════════════════════════════════
// Delegaciones vigentes — resolución de suplencias
//
// ⚠️ GEMELO de `src/utils/delegaciones.ts`, porque Deno no alcanza `src/`.
// Misma familia que `fecha.ts` (§9.3) y `matriz.ts` (§6.5). **Manda ESTE**: es
// el que usa `resolve-approval` para dejar aprobar, y el que elige a quién se
// le manda el correo. El de `src/` solo pinta botones y contadores.
// Si cambias uno, cambia el otro.
//
// Qué resuelve esta tabla, que llevaba desde F1 sin que la leyera una sola
// línea: hoy hay UN `cumplimiento` y las aprobaciones de AML no las puede
// resolver nadie más —ni un admin, §6.2— ni escalan al vencer. Sin suplencia,
// una baja médica para TODAS las aprobaciones regulatorias.
//
// El rol delegado se lee de `profiles.role` del titular EN EL MOMENTO, no se
// guarda en `delegaciones`. Si al titular le cambian el rol, la suplencia pasa
// a valer lo que vale hoy: una copia del rol convertiría la delegación en un
// permiso congelado que sobrevive al cambio.
// ═══════════════════════════════════════════════════════════════════════════

export interface DelegacionVigente {
    delegacionId:   string;
    titularId:      string;
    titularNombre:  string;
    titularEmail:   string;
    rol:            string;   // el rol del titular HOY
    hasta:          string;
}

/**
 * Roles que `usuarioId` puede ejercer ahora mismo por delegación de otra
 * persona.
 *
 * **No es recursivo a propósito.** Si A delega en B y B delega en C, C NO
 * hereda el rol de A: una cadena de suplencias es imposible de auditar y
 * convierte dos decisiones acotadas en una tercera que nadie tomó.
 */
export async function delegacionesVigentes(
    // deno-lint-ignore no-explicit-any
    supabase: any,
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

    // ⚠️ supabase-js NO lanza: devuelve `{ error }`. Un error que nadie lee aquí
    // se convertiría en «no tienes ninguna delegación», que es un 403 contando
    // una mentira. Se propaga para que el llamante decida.
    if (error) throw new Error(`No se pudieron leer las delegaciones: ${error.message}`);

    return (data ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((d: any) => d.titular?.is_active === true && d.titular?.role)
        // deno-lint-ignore no-explicit-any
        .map((d: any) => ({
            delegacionId:  d.id,
            titularId:     d.usuario_id,
            titularNombre: d.titular.name ?? d.titular.email ?? 'sin nombre',
            titularEmail:  d.titular.email ?? '',
            rol:           d.titular.role,
            hasta:         d.hasta,
        }));
}

/**
 * A quién hay que avisar de una tarea que pide `rol`: los que TIENEN ese rol
 * más los suplentes con una delegación vigente de alguno de ellos.
 *
 * Sin esto, la delegación dejaría entrar al suplente pero no le diría que hay
 * algo que aprobar — la persona a la que se le delegó sería la única del
 * sistema que no se entera. Los dos sitios que mandaban estos correos
 * (`execute-workflow` al pausar y `cron-runner` al escalar) filtraban por
 * `.eq('role', …)` a secas.
 */
export async function destinatariosDelRol(
    // deno-lint-ignore no-explicit-any
    supabase: any,
    organizationId: string,
    rol: string,
): Promise<{ name: string; email: string; porDelegacionDe?: string }[]> {
    const { data: titulares, error: errT } = await supabase
        .from('profiles')
        .select('id, name, email')
        .eq('organization_id', organizationId)
        .eq('role', rol)
        .eq('is_active', true);

    if (errT) throw new Error(`No se pudieron leer los aprobadores del rol: ${errT.message}`);

    const lista = (titulares ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((p: any) => p.email)
        // deno-lint-ignore no-explicit-any
        .map((p: any) => ({ name: p.name ?? p.email, email: p.email as string }));

    const ids = (titulares ?? []).map((p: { id: string }) => p.id);
    if (ids.length === 0) return lista;

    const ahora = new Date().toISOString();
    const { data: delegs, error: errD } = await supabase
        .from('delegaciones')
        .select('usuario_id, suplente:suplente_id(name, email, is_active), titular:usuario_id(name)')
        .eq('organization_id', organizationId)
        .in('usuario_id', ids)
        .lte('desde', ahora)
        .gte('hasta', ahora);

    if (errD) throw new Error(`No se pudieron leer las delegaciones: ${errD.message}`);

    const yaEsta = new Set(lista.map((p: { email: string }) => p.email.toLowerCase()));

    // deno-lint-ignore no-explicit-any
    for (const d of (delegs ?? []) as any[]) {
        const email = d.suplente?.email;
        if (!email || d.suplente?.is_active !== true) continue;
        if (yaEsta.has(email.toLowerCase())) continue;
        yaEsta.add(email.toLowerCase());
        lista.push({
            name:            d.suplente.name ?? email,
            email,
            porDelegacionDe: d.titular?.name ?? 'otra persona',
        });
    }

    return lista;
}
