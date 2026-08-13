// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Admin: asignar clave temporal por olvido
//
// Un administrador le pone una clave temporal a otro usuario de SU organización.
// La clave se genera aquí, se devuelve UNA vez para que el admin la entregue en
// mano, y la cuenta queda marcada para cambiarla en el primer acceso.
//
// Encargo de Hermes (12/08/2026): hasta hoy, un olvido de clave dejaba a la
// persona fuera sin vía de vuelta.
//
// Calcada de admin-create-user: mismo modo de autenticar (getUser con el cliente
// de servicio, no un cliente anon — ver el comentario largo de allí), misma
// forma de derivar la organización del JWT y no del cuerpo.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generarClaveTemporal } from '../_shared/clave.ts';

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

        // 2. Solo un admin, y su organización sale de aquí — nunca del cuerpo
        const { data: callerProfile, error: callerErr } = await admin
            .from('profiles')
            .select('role, organization_id, name')
            .eq('id', caller.id)
            .single();

        if (callerErr) return json({ error: 'No se pudo comprobar tu perfil' }, 500);
        if (!callerProfile || callerProfile.role !== 'admin') {
            return json({ error: 'Solo un administrador puede asignar una clave temporal.' }, 403);
        }

        // 3. Validar destinatario
        const { userId } = await req.json();
        if (!userId) return json({ error: 'Falta el campo userId' }, 400);

        // Un admin no se restablece a sí mismo por esta vía. No es que sea
        // peligroso —ya puede hacerlo—, es que no tiene sentido: para llegar
        // aquí ha tenido que iniciar sesión, así que no ha olvidado nada y lo
        // que quiere es «Cambiar mi contraseña», que sí pide la clave actual.
        // Esta ruta la salta, y una ruta que salta comprobaciones no debe
        // usarse cuando existe la que no las salta.
        if (userId === caller.id) {
            return json({
                error: 'Para cambiar tu propia contraseña usa «Cambiar mi contraseña» en el menú lateral: esa opción verifica tu clave actual.',
            }, 400);
        }

        const { data: target, error: targetErr } = await admin
            .from('profiles')
            .select('id, email, name, organization_id, is_active')
            .eq('id', userId)
            .single();

        if (targetErr || !target) return json({ error: 'Ese usuario no existe.' }, 404);

        // Aislamiento entre organizaciones: la comparación es contra el perfil
        // del llamante, no contra nada que haya viajado en la petición.
        if (target.organization_id !== callerProfile.organization_id) {
            return json({ error: 'Ese usuario no pertenece a tu organización.' }, 403);
        }

        // 4. Asignar la clave temporal
        const claveTemporal = generarClaveTemporal();

        const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
            password: claveTemporal,
        });
        if (updateErr) {
            return json({ error: `No se pudo asignar la clave: ${updateErr.message}` }, 400);
        }

        // 5. Marcar que hay que cambiarla al entrar
        //
        // Si esto falla, la clave YA está cambiada: dejarlo pasar en silencio
        // daría una cuenta con clave conocida por dos personas y sin obligación
        // de cambiarla. Se responde con error para que el admin lo repita.
        const { error: marcaErr } = await admin
            .from('profiles')
            .update({ debe_cambiar_clave: true })
            .eq('id', userId);

        if (marcaErr) {
            return json({
                error: `La clave se cambió, pero no se pudo marcar la cuenta para el cambio obligatorio (${marcaErr.message}). Vuelve a restablecerla.`,
            }, 500);
        }

        // 6. Traza. En el log va el HECHO, nunca el secreto.
        const { error: auditErr } = await admin.from('audit_log').insert({
            organization_id: callerProfile.organization_id,
            usuario_id:      caller.id,
            usuario_email:   caller.email,
            accion:          'modificar',
            entidad:         'usuario',
            entidad_id:      userId,
            descripcion:     `Clave temporal asignada a ${target.name} (${target.email}) por olvido`,
        });
        if (auditErr) console.error('[admin-reset-password] audit_log:', auditErr.message);

        return json({
            success:       true,
            email:         target.email,
            name:          target.name,
            is_active:     target.is_active,
            temp_password: claveTemporal,
        });

    } catch (err) {
        return json({ error: String((err as Error)?.message ?? err) }, 500);
    }
});

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });
}
