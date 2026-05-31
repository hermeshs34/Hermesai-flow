// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Admin: Crear Usuario
// Crea un usuario (auth + profile) de forma segura.
// Solo un admin de la misma organización puede invocarla.
// El service_role key NUNCA sale del servidor.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLES_VALIDOS = ['admin', 'dueno_proceso', 'supervisor', 'operador', 'autorizador', 'auditor'];

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        // 1. Identificar al llamante por su JWT
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json({ error: 'No autenticado' }, 401);

        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user: caller }, error: authErr } = await userClient.auth.getUser();
        if (authErr || !caller) return json({ error: 'Sesión inválida' }, 401);

        // 2. Verificar que el llamante es admin y obtener su organización
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: callerProfile } = await admin
            .from('profiles')
            .select('role, organization_id')
            .eq('id', caller.id)
            .single();

        if (!callerProfile || callerProfile.role !== 'admin') {
            return json({ error: 'Solo un administrador puede crear usuarios' }, 403);
        }

        // 3. Validar payload
        const { email, name, role, password } = await req.json();
        if (!email || !name || !role) return json({ error: 'Faltan campos: email, name, role' }, 400);
        if (!ROLES_VALIDOS.includes(role)) return json({ error: `Rol inválido: ${role}` }, 400);

        const cleanEmail = String(email).trim().toLowerCase();
        const tempPassword = password && String(password).length >= 8
            ? String(password)
            : `Hermes${Math.random().toString(36).slice(2, 10)}!`;

        // 4. Crear usuario en Auth (confirmado, sin email de verificación)
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email: cleanEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { name },
        });
        if (createErr || !created.user) {
            return json({ error: `No se pudo crear la cuenta: ${createErr?.message ?? 'desconocido'}` }, 400);
        }

        // 5. Crear el profile vinculado a la misma organización del admin
        const { error: profileErr } = await admin.from('profiles').insert({
            id:              created.user.id,
            organization_id: callerProfile.organization_id,
            email:           cleanEmail,
            name:            String(name).trim(),
            role,
            is_active:       true,
        });
        if (profileErr) {
            // rollback del auth user si el profile falla
            await admin.auth.admin.deleteUser(created.user.id);
            return json({ error: `No se pudo crear el perfil: ${profileErr.message}` }, 400);
        }

        // 6. Registrar en audit log
        await admin.from('audit_log').insert({
            organization_id: callerProfile.organization_id,
            usuario_id:      caller.id,
            usuario_email:   caller.email,
            accion:          'crear',
            entidad:         'usuario',
            entidad_id:      created.user.id,
            descripcion:     `Usuario creado: ${name} (${cleanEmail}) con rol ${role}`,
        });

        return json({
            success: true,
            user_id: created.user.id,
            email:   cleanEmail,
            // Devolver la clave temporal solo si fue autogenerada, para que el admin la comparta
            temp_password: password ? undefined : tempPassword,
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
