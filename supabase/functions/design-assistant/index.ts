// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Asistente de Diseño de Flujos (F3.2)
// Proxy seguro hacia Anthropic API — la API Key nunca sale al cliente.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        // ── Sesión obligatoria ──────────────────────────────────────────────
        // Hasta el 08/10/2026 esta función no comprobaba nada y estaba desplegada
        // con verify_jwt=false: cualquiera en internet podía usar la clave de
        // Anthropic de la organización, con el prompt que quisiera. La puerta
        // de Supabase sigue abierta (no hay config.toml y un deploy sin bandera
        // la cambiaría sin avisar, CLAUDE.md §6.1), así que la autorización vive
        // aquí: usuario con sesión válida y perfil activo.
        const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
        if (token === '') return json({ error: 'No autorizado' }, 401);

        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: userData } = await supabase.auth.getUser(token);
        if (!userData?.user) {
            return json({ error: 'Tu sesión no es válida o ha caducado. Vuelve a iniciar sesión.' }, 401);
        }
        const { data: perfil, error: perfilErr } = await supabase
            .from('profiles')
            .select('is_active')
            .eq('id', userData.user.id)
            .maybeSingle();
        if (perfilErr) return json({ error: `No se pudo comprobar tu perfil: ${perfilErr.message}` }, 500);
        if (!perfil?.is_active) return json({ error: 'Tu usuario no está activo.' }, 403);

        const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
        if (!ANTHROPIC_KEY) {
            return json({ error: 'ANTHROPIC_API_KEY no configurado en Supabase Secrets' }, 500);
        }

        const { messages, system } = await req.json();
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return json({ error: 'Campo "messages" requerido' }, 400);
        }

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key':         ANTHROPIC_KEY,
                'anthropic-version': '2023-06-01',
                'content-type':      'application/json',
            },
            body: JSON.stringify({
                model:      'claude-sonnet-4-6',
                max_tokens: 1024,
                system:     system ?? 'Eres un asistente experto en diseño de flujos de trabajo.',
                messages,
            }),
        });

        if (!res.ok) {
            const txt = await res.text();
            return json({ error: `Anthropic API error: ${txt}` }, 502);
        }

        const data    = await res.json();
        const content = data?.content?.[0]?.text ?? '';
        return json({ content });

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
