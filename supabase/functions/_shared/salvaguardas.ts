// ═══════════════════════════════════════════════════════════════════════════
// Salvaguardas de las Edge Functions que actúan con la clave de servicio.
//
// Portado de RiskGuard y Estados Financieros (27/10/2026, /blindar-seguridad).
// La clave de servicio se salta la RLS, así que las políticas `_aal2` no
// protegen lo que una función hace con ella: la función tiene que preguntar
// ella misma si quien la llama pasó el segundo factor.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type ResultadoMfa = { ok: true } | { ok: false; status: number; error: string };

/**
 * ¿La sesión de quien llama pasó el segundo factor y sigue dentro de plazo?
 *
 * Lo contesta `public.mfa_satisfecho()` (20261027b) ejecutada CON EL JWT DE
 * QUIEN LLAMA, no con la clave de servicio: con esta, `auth.jwt()` sería el del
 * servicio y la respuesta no diría nada del usuario.
 *
 * La clave pública sale SOLO de la cabecera `apikey` que manda supabase-js. No
 * se cae a `SUPABASE_ANON_KEY`: la plataforma inyecta ahí la anon legacy, que
 * está apagada desde el 08/08/2026, y el fallo se leería como «sin factor».
 *
 * Falla cerrado: un error al preguntar no deja pasar.
 */
export async function exigirMfa(req: Request, jwt: string): Promise<ResultadoMfa> {
    const apikey = (req.headers.get('apikey') ?? '').trim();
    if (apikey === '') return { ok: false, status: 401, error: 'Falta la cabecera apikey.' };

    const comoUsuario = createClient(Deno.env.get('SUPABASE_URL') ?? '', apikey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth:   { persistSession: false },
    });

    const { data, error } = await comoUsuario.rpc('mfa_satisfecho');
    if (error) {
        console.error('[salvaguardas] mfa_satisfecho:', error.code, error.message);
        return { ok: false, status: 500, error: 'No se pudo comprobar el segundo factor.' };
    }
    if (data !== true) {
        return {
            ok: false,
            status: 403,
            error: 'Falta el segundo factor o tu sesión caducó. Cierra sesión y vuelve a entrar.',
        };
    }
    return { ok: true };
}
