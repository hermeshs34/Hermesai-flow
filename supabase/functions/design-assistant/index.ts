// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Asistente de Diseño de Flujos (F3.2)
// Proxy seguro hacia Anthropic API — la API Key nunca sale al cliente.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
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
