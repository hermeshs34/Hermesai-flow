import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    const ts = new Date().toISOString();

    try {
        const r = await fetch('https://pydolarve.org/api/v1/dollar?page=bcv', {
            headers: { Accept: 'application/json' },
        });
        if (r.ok) {
            const d    = await r.json();
            const rate = d?.monitors?.usd?.price ?? d?.price ?? null;
            if (rate) {
                return new Response(
                    JSON.stringify({ bcv_rate: Number(rate).toFixed(2), source: 'pydolarve.org', timestamp: ts }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
        }
    } catch { /* intentar siguiente */ }

    try {
        const r = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
        if (r.ok) {
            const d    = await r.json();
            const rate = d?.promedio ?? d?.price ?? null;
            if (rate) {
                return new Response(
                    JSON.stringify({ bcv_rate: Number(rate).toFixed(2), source: 'dolarapi.com', timestamp: ts }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
        }
    } catch { /* intentar siguiente */ }

    return new Response(
        JSON.stringify({ bcv_rate: null, source: 'unavailable', timestamp: ts }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
});
