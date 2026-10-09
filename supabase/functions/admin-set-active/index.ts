// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Admin: activar / desactivar un usuario
//
// Hasta el 09/10/2026 desactivar era un UPDATE de `profiles.is_active` desde el
// navegador. Supabase Auth no se enteraba: la persona seguía pudiendo iniciar
// sesión y sacar un token. La RLS ya no le deja hacer nada con él
// (20261009_inactivo_fuera_de_rls.sql), pero entrar, entraba.
//
// Aquí se hacen las dos cosas juntas, para que no se pueda hacer una y olvidar
// la otra:
//   desactivar → profiles.is_active = false  +  ban en Auth
//   activar    → quitar el ban               +  profiles.is_active = true
//
// El orden no es indiferente: en los dos sentidos se hace PRIMERO lo que deja
// a la persona fuera y DESPUÉS lo que la deja entrar. Si el segundo paso
// falla, la cuenta queda del lado seguro —bloqueada— y se dice.
//
// Y antes de dejar a un rol regulatorio sin nadie activo (§6.2: las tareas de
// AML no las resuelve ni un admin y al vencer cancelan el flujo) se pide una
// confirmación explícita, con el número de tareas que se quedarían sin dueño.
//
// Calcada de admin-reset-password: JWT validado con el cliente de servicio y
// la organización sale del perfil del llamante, nunca del cuerpo.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ⚠️ COPIA de `ROLES_REGULATORIOS` de src/core/user.types.ts y de
// resolve-approval/index.ts. Si cambias una, cambia las tres
// (verificar.mjs las compara).
const ROLES_REGULATORIOS = ['cumplimiento'];

// «Para siempre» a efectos prácticos: Auth no tiene un ban sin fecha.
const BAN_INDEFINIDO = '876000h';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        // 1. Identificar al llamante por su JWT
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json({ error: 'No autenticado' }, 401);

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (token === '') return json({ error: 'No autenticado' }, 401);

        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
        if (authErr || !caller) return json({ error: 'Sesión inválida' }, 401);

        // 2. Solo un admin activo, y su organización sale de aquí
        const { data: callerProfile, error: callerErr } = await admin
            .from('profiles')
            .select('role, organization_id, is_active')
            .eq('id', caller.id)
            .single();

        if (callerErr) return json({ error: 'No se pudo comprobar tu perfil' }, 500);
        if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.is_active !== true) {
            return json({ error: 'Solo un administrador puede activar o desactivar usuarios.' }, 403);
        }

        // 3. Validar la petición
        const { userId, active, confirmarSinReemplazo } = await req.json();
        if (!userId || typeof active !== 'boolean') {
            return json({ error: 'Faltan campos: userId y active (true/false)' }, 400);
        }
        if (userId === caller.id) {
            return json({ error: 'No puedes desactivarte ni reactivarte a ti mismo.' }, 400);
        }

        const { data: target, error: targetErr } = await admin
            .from('profiles')
            .select('id, email, name, role, organization_id, is_active')
            .eq('id', userId)
            .single();

        if (targetErr || !target) return json({ error: 'Ese usuario no existe.' }, 404);
        if (target.organization_id !== callerProfile.organization_id) {
            return json({ error: 'Ese usuario no pertenece a tu organización.' }, 403);
        }

        if (target.is_active === active) {
            return json({ success: true, sinCambios: true, is_active: active });
        }

        // 4. ¿Deja un rol regulatorio sin nadie? Se avisa y se pide confirmar.
        if (!active && ROLES_REGULATORIOS.includes(target.role) && confirmarSinReemplazo !== true) {
            const { count: otrosActivos, error: otrosErr } = await admin
                .from('profiles')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', target.organization_id)
                .eq('role', target.role)
                .eq('is_active', true)
                .neq('id', target.id);
            if (otrosErr) return json({ error: `No se pudo comprobar quién más tiene el rol: ${otrosErr.message}` }, 500);

            if ((otrosActivos ?? 0) === 0) {
                const { count: pendientes, error: pendErr } = await admin
                    .from('tareas_aprobacion')
                    .select('id', { count: 'exact', head: true })
                    .eq('organization_id', target.organization_id)
                    .eq('rol_aprobador', target.role)
                    .eq('estado', 'pendiente');
                if (pendErr) return json({ error: `No se pudieron contar las tareas pendientes: ${pendErr.message}` }, 500);

                const n = pendientes ?? 0;
                return json({
                    requiereConfirmacion: true,
                    error:
                        `${target.name} es la única persona activa con el rol de Cumplimiento. ` +
                        'Si la desactivas, nadie podrá aprobar las tareas de cumplimiento —ni un administrador— ' +
                        'y al vencer cancelarán sus flujos' +
                        (n > 0 ? `. Ahora mismo hay ${n} pendiente${n === 1 ? '' : 's'}.` : '.') +
                        ' Si es una ausencia temporal, usa una delegación en lugar de desactivarla.',
                    pendientes: n,
                }, 409);
            }
        }

        // 5. Primero lo que deja fuera; después lo que deja entrar.
        if (!active) {
            const { error: perfilErr } = await admin
                .from('profiles').update({ is_active: false }).eq('id', userId);
            if (perfilErr) return json({ error: `No se pudo desactivar: ${perfilErr.message}` }, 500);

            const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_INDEFINIDO });
            if (banErr) {
                // El perfil ya está inactivo y la RLS no le deja hacer nada:
                // se deja así (lado seguro) y se pide repetir.
                await auditar(admin, callerProfile.organization_id, caller, userId,
                    `Usuario desactivado: ${target.name} (${target.email}) — SIN bloqueo en Auth: ${banErr.message}`);
                return json({
                    error: `${target.name} quedó desactivado, pero no se pudo bloquear su inicio de sesión (${banErr.message}). Vuelve a intentarlo.`,
                }, 500);
            }
        } else {
            const { error: unbanErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
            if (unbanErr) {
                return json({ error: `No se pudo desbloquear el inicio de sesión: ${unbanErr.message}` }, 500);
            }

            const { error: perfilErr } = await admin
                .from('profiles').update({ is_active: true }).eq('id', userId);
            if (perfilErr) {
                // Volver a bloquear: un usuario desbloqueado en Auth con el
                // perfil inactivo es justo el desajuste que esta función evita.
                await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_INDEFINIDO });
                return json({ error: `No se pudo reactivar: ${perfilErr.message}` }, 500);
            }
        }

        // 6. Traza
        await auditar(admin, callerProfile.organization_id, caller, userId,
            `Usuario ${active ? 'activado' : 'desactivado'}: ${target.name} (${target.email})` +
            (active ? '' : ' — inicio de sesión bloqueado') +
            (!active && confirmarSinReemplazo === true ? ' — confirmado sin reemplazo en rol regulatorio' : ''));

        return json({ success: true, is_active: active });

    } catch (err) {
        return json({ error: String((err as Error)?.message ?? err) }, 500);
    }
});

async function auditar(
    // deno-lint-ignore no-explicit-any
    admin: any, organizationId: string, caller: { id: string; email?: string }, userId: string, descripcion: string,
): Promise<void> {
    const { error } = await admin.from('audit_log').insert({
        organization_id: organizationId,
        usuario_id:      caller.id,
        usuario_email:   caller.email,
        accion:          'modificar',
        entidad:         'usuario',
        entidad_id:      userId,
        descripcion,
    });
    if (error) console.error('[admin-set-active] audit_log:', error.message);
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });
}
