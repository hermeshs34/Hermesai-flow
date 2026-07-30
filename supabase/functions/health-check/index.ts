// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Health Check
// Verifica disponibilidad real + latencia de cada sistema integrado.
// Llamada desde el Sidebar cada 60s para mostrar estado dinámico.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { canalEmail, direccionRemitente } from '../_shared/email.ts';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SystemResult {
    name:        string;
    status:      'ok' | 'error' | 'unconfigured';
    latency_ms:  number | null;
    last_check:  string;
    message:     string;
}

async function ping(label: string, fn: () => Promise<void>): Promise<SystemResult> {
    const t0  = Date.now();
    const now = new Date().toISOString();
    try {
        await fn();
        return { name: label, status: 'ok', latency_ms: Date.now() - t0, last_check: now, message: 'Conectado' };
    } catch (e: any) {
        return { name: label, status: 'error', latency_ms: Date.now() - t0, last_check: now, message: String(e?.message ?? 'Error desconocido').slice(0, 120) };
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    const results: SystemResult[] = [];

    // ── BCV — intenta pydolarve, hace fallback a dolarapi.com ────────────
    results.push(await ping('Tasa BCV', async () => {
        // Fuente primaria
        try {
            const r = await fetch('https://pydolarve.org/api/v1/dollar?page=bcv', { signal: AbortSignal.timeout(6000) });
            if (r.ok) {
                const d = await r.json();
                if (d?.monitors?.usd?.price) return; // OK
            }
        } catch { /* fallback */ }
        // Fuente secundaria
        const r2 = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(6000) });
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
        const d2 = await r2.json();
        if (!d2?.promedio && !d2?.price) throw new Error('Respuesta inesperada de dolarapi');
    }));

    // ── Indicadores ──────────────────────────────────────────────────────
    const IND_URL = Deno.env.get('INDICADORES_SUPABASE_URL');
    const IND_KEY = Deno.env.get('INDICADORES_SERVICE_ROLE_KEY');
    if (IND_URL && IND_KEY) {
        results.push(await ping('Indicadores', async () => {
            const ind = createClient(IND_URL, IND_KEY);
            const { error } = await ind.from('indicadores_definicion').select('id').limit(1);
            if (error) throw new Error(error.message);
        }));
    } else {
        results.push({ name: 'Indicadores', status: 'unconfigured', latency_ms: null, last_check: new Date().toISOString(), message: 'Secret INDICADORES_SUPABASE_URL no configurado' });
    }

    // ── EE.FF. ────────────────────────────────────────────────────────────
    const EEFF_URL = Deno.env.get('EEFF_SUPABASE_URL');
    const EEFF_KEY = Deno.env.get('EEFF_SERVICE_ROLE_KEY');
    if (EEFF_URL && EEFF_KEY) {
        results.push(await ping('EE.FF.', async () => {
            const eeff = createClient(EEFF_URL, EEFF_KEY);
            const { error } = await eeff.from('companies').select('id').limit(1);
            if (error) throw new Error(error.message);
        }));
    } else {
        results.push({ name: 'EE.FF.', status: 'unconfigured', latency_ms: null, last_check: new Date().toISOString(), message: 'Secret EEFF_SUPABASE_URL no configurado' });
    }

    // ── RiskGuard ────────────────────────────────────────────────────────
    const RG_URL = Deno.env.get('RISKGUARD_SUPABASE_URL');
    const RG_KEY = Deno.env.get('RISKGUARD_SERVICE_ROLE_KEY');
    if (RG_URL && RG_KEY) {
        results.push(await ping('RiskGuard', async () => {
            const rg = createClient(RG_URL, RG_KEY);
            const { error } = await rg.from('siniestros').select('id').limit(1);
            if (error) throw new Error(error.message);
        }));
    } else {
        results.push({ name: 'RiskGuard', status: 'unconfigured', latency_ms: null, last_check: new Date().toISOString(), message: 'Secret RISKGUARD_SUPABASE_URL no configurado' });
    }

    // ── Email — el canal que se usaría ahora mismo ───────────────────────
    // Antes esto preguntaba siempre por Resend y decía "Conectado" mientras
    // no entregaba nada: la clave era válida, pero `onboarding@resend.dev`
    // había dejado de repartir. Se informa del canal real (ver _shared/email.ts).
    const canal = canalEmail();
    if (canal === 'smtp') {
        results.push(await ping(`Email · Gmail SMTP (${direccionRemitente()})`, async () => {
            // Solo se comprueba que la salida al 465 sigue abierta. No se hace
            // AUTH: esto lo llama el Sidebar cada 60 s y no conviene tocar la
            // puerta de Gmail con la contraseña tantas veces al día.
            const conn = await Deno.connect({ hostname: 'smtp.gmail.com', port: 465 });
            conn.close();
        }));
    } else if (canal === 'resend') {
        results.push(await ping('Email · Resend', async () => {
            const r = await fetch('https://api.resend.com/domains', {
                headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}` },
                signal: AbortSignal.timeout(6000),
            });
            if (!r.ok) throw new Error(`Resend HTTP ${r.status}`);
        }));
    } else {
        results.push({ name: 'Email', status: 'unconfigured', latency_ms: null, last_check: new Date().toISOString(), message: 'Sin canal: faltan GMAIL_USER + GMAIL_APP_PASSWORD y también RESEND_API_KEY' });
    }

    return new Response(
        JSON.stringify({ systems: results, checked_at: new Date().toISOString() }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
});
