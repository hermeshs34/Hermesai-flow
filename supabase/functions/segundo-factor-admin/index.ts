// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Admin: segundo factor de los usuarios de SU organización
//
// Portada de RiskGuard (27/10/2026, /blindar-seguridad). Dos acciones:
//   · { accion: 'estado' }                 → cuántos factores verificados tiene
//                                            cada usuario de la organización
//   · { accion: 'quitar', auth_user_id }   → borra todos los factores de uno
//
// Quitar un factor ajeno exige la API de administración de Auth (clave de
// servicio), que no puede vivir en el navegador. Para quien perdió el teléfono:
// sin códigos de recuperación (decisión deliberada), esta es la única vuelta.
//
// Solo un admin ACTIVO, con su propio segundo factor pasado en esta sesión
// (`exigirMfa`), y la organización sale del perfil del llamante — nunca del
// cuerpo. Se despliega SIN --no-verify-jwt, como las otras `admin-*`.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { exigirMfa } from '../_shared/salvaguardas.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

        // 2. Solo un admin activo; su organización sale de aquí
        const { data: callerProfile, error: callerErr } = await admin
            .from('profiles')
            .select('role, organization_id, name, is_active')
            .eq('id', caller.id)
            .single();

        if (callerErr) return json({ error: 'No se pudo comprobar tu perfil' }, 500);
        if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.is_active !== true) {
            return json({ error: 'Solo un administrador puede gestionar el segundo factor de otros usuarios.' }, 403);
        }

        // 3. Y con su propio segundo factor hecho en esta sesión
        const mfa = await exigirMfa(req, token);
        if (!mfa.ok) return json({ error: mfa.error }, mfa.status);

        const cuerpo = await req.json().catch(() => ({})) as { accion?: string; auth_user_id?: string };

        // ── estado ──────────────────────────────────────────────────────────
        if (cuerpo.accion === 'estado') {
            const { data: perfiles, error: perfErr } = await admin
                .from('profiles')
                .select('id')
                .eq('organization_id', callerProfile.organization_id);
            if (perfErr) return json({ error: 'No se pudieron leer los usuarios de la organización.' }, 500);

            // Un usuario cuya consulta falla NO entra en el mapa: la pantalla
            // pinta «?», no «0». Un cero que nadie midió es justo lo que no
            // puede decir una columna de seguridad.
            const factores: Record<string, number> = {};
            // Cuentas cuyo factor este llamante NO puede quitar (ver «quitar»).
            // Solo decide qué botón se pinta; la regla vive abajo.
            const protegidos: string[] = [];
            for (const p of perfiles ?? []) {
                const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: p.id });
                if (error) {
                    console.error('[segundo-factor-admin] listFactors', p.id, error.message);
                    continue;
                }
                factores[p.id] = (data?.factors ?? []).filter(f => f.status === 'verified').length;
                if (!esAdminPlataforma(caller)) {
                    const { data: u } = await admin.auth.admin.getUserById(p.id);
                    if (esAdminPlataforma(u?.user)) protegidos.push(p.id);
                }
            }
            return json({ factores, protegidos });
        }

        // ── quitar ──────────────────────────────────────────────────────────
        if (cuerpo.accion === 'quitar') {
            const userId = cuerpo.auth_user_id;
            if (!userId) return json({ error: 'Falta el campo auth_user_id' }, 400);

            // El propio factor se quita desde «Seguridad», con aal2 y sabiendo
            // lo que se hace; por aquí un admin se dejaría sin factor de un clic.
            if (userId === caller.id) {
                return json({ error: 'Tu propio segundo factor no se quita desde aquí.' }, 400);
            }

            const { data: target, error: targetErr } = await admin
                .from('profiles')
                .select('id, email, name, organization_id')
                .eq('id', userId)
                .single();
            if (targetErr || !target) return json({ error: 'Ese usuario no existe.' }, 404);
            if (target.organization_id !== callerProfile.organization_id) {
                return json({ error: 'Ese usuario no pertenece a tu organización.' }, 403);
            }

            // 27/10/2026, cazado por Hermes al probar: un admin de organización
            // podía quitarle el factor al administrador de la PLATAFORMA, que
            // está por encima de él (es quien gobierna `exigir_mfa`). Solo otro
            // admin de plataforma puede. Falla cerrado: si no se puede leer la
            // cuenta de destino, no se quita nada.
            if (!esAdminPlataforma(caller)) {
                const { data: destino, error: destinoErr } = await admin.auth.admin.getUserById(userId);
                if (destinoErr || !destino?.user) {
                    return json({ error: 'No se pudo comprobar la cuenta de ese usuario; no se quitó nada.' }, 500);
                }
                if (esAdminPlataforma(destino.user)) {
                    return json({ error: `${target.name} es administrador de la plataforma: su segundo factor solo lo puede quitar otro administrador de la plataforma.` }, 403);
                }
            }

            const { data: lista, error: listErr } = await admin.auth.admin.mfa.listFactors({ userId });
            if (listErr) return json({ error: `No se pudieron leer sus factores: ${listErr.message}` }, 500);
            const suyos = lista?.factors ?? [];
            if (suyos.length === 0) return json({ error: `${target.name} no tiene ningún segundo factor.` }, 409);

            // La traza va ANTES de borrar: si no se puede dejar constancia, no
            // se borra. Un control cuya evidencia puede faltar no es un control.
            const { error: auditErr } = await admin.from('audit_log').insert({
                organization_id: callerProfile.organization_id,
                usuario_id:      caller.id,
                usuario_email:   caller.email,
                accion:          'modificar',
                entidad:         'usuario',
                entidad_id:      userId,
                descripcion:     `Quitó el segundo factor de ${target.name} (${target.email}): ${suyos.length} dispositivo(s)`,
            });
            if (auditErr) {
                console.error('[segundo-factor-admin] audit_log:', auditErr.message);
                return json({ error: 'No se pudo registrar la acción en la auditoría; no se quitó nada.' }, 500);
            }

            let quitados = 0;
            for (const f of suyos) {
                const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
                if (error) {
                    console.error('[segundo-factor-admin] deleteFactor', f.id, error.message);
                    await admin.from('audit_log').insert({
                        organization_id: callerProfile.organization_id,
                        usuario_id:      caller.id,
                        usuario_email:   caller.email,
                        accion:          'modificar',
                        entidad:         'usuario',
                        entidad_id:      userId,
                        descripcion:     `Quitar segundo factor de ${target.name}: falló tras ${quitados} de ${suyos.length}`,
                    });
                    return json({ error: `Se quitaron ${quitados} de ${suyos.length} dispositivos. Vuelve a intentarlo.` }, 500);
                }
                quitados++;
            }

            return json({ quitados });
        }

        return json({ error: 'Acción desconocida' }, 400);

    } catch (err) {
        return json({ error: String((err as Error)?.message ?? err) }, 500);
    }
});

/** Misma marca que mira `es_admin_plataforma()` en SQL (20261027b/c). */
function esAdminPlataforma(u: { app_metadata?: Record<string, unknown> } | null | undefined): boolean {
    return u?.app_metadata?.admin_plataforma === true;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });
}
