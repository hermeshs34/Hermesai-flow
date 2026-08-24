// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Health Check
// Verifica disponibilidad real + latencia de cada sistema integrado.
// Llamada desde el Sidebar cada 60s para mostrar estado dinámico.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { canalEmail, direccionRemitente, DOMINIO_ENVIO } from '../_shared/email.ts';

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
        return { name: label, status: 'error', latency_ms: Date.now() - t0, last_check: now, message: String(e?.message ?? 'Error desconocido').slice(0, 220) };
    }
}

// Un `{ error }` de PostgREST trae `message`, y el motivo de verdad suele ir en
// `hint` y `code`. Quedarse solo con `message` deja "Invalid API key" a secas,
// que no distingue una clave mal copiada de una clave del formato viejo — el
// gateway SÍ lo distingue, y lo dice en el hint. Misma doctrina que §12.2:
// lo que acaba delante de una persona tiene que llevar el motivo, no el sobre.
// Familia de la credencial de cada integración. Devuelve la ETIQUETA del formato,
// nunca un solo carácter del valor: sirve para auditar el apagado de las claves
// legacy de Supabase sin pedirle a nadie que pegue un secreto en un chat.
// `eyJ` = JWT legacy (anon/service_role, mueren al apagar las legacy);
// `sb_secret_` / `sb_publishable_` = formato nuevo, sobreviven.
function familiaClave(k: string | undefined): string {
    if (!k) return 'ausente';
    if (k.startsWith('sb_secret_')) return 'sb_secret_';
    if (k.startsWith('sb_publishable_')) return 'sb_publishable_';
    if (k.startsWith('eyJ')) return 'JWT legacy';
    return 'desconocida';
}

function detalleError(e: { message: string; hint?: string | null; code?: string | null }): string {
    return [e.message, e.hint, e.code ? `[${e.code}]` : null].filter(Boolean).join(' — ');
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
            if (error) throw new Error(detalleError(error));
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
            if (error) throw new Error(detalleError(error));
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
            if (error) throw new Error(detalleError(error));
        }));
    } else {
        results.push({ name: 'RiskGuard', status: 'unconfigured', latency_ms: null, last_check: new Date().toISOString(), message: 'Secret RISKGUARD_SUPABASE_URL no configurado' });
    }

    // ── Email — Resend sobre el dominio de plataforma ────────────────────
    // Antes esto decía "Conectado" en cuanto la clave respondía, mientras no
    // entregaba nada: la clave era válida pero `onboarding@resend.dev` había
    // dejado de repartir. Por eso ahora no basta con que la API conteste —se
    // comprueba que la cuenta de esa clave tenga verificado el dominio desde
    // el que enviamos de verdad (ver _shared/email.ts).
    if (canalEmail() === 'resend') {
        results.push(await ping(`Email · Resend (${direccionRemitente()})`, async () => {
            const r = await fetch('https://api.resend.com/domains', {
                headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}` },
                signal: AbortSignal.timeout(6000),
            });

            // Una clave de solo envío responde 401 aquí aunque sirva para
            // mandar correo. Se dice explícito para no salir a buscar una
            // clave rota que no lo está.
            if (r.status === 401) throw new Error('Clave inválida, o es de solo envío y no puede listar dominios');
            if (!r.ok) throw new Error(`Resend HTTP ${r.status}`);

            const { data } = await r.json() as { data?: { name?: string; status?: string }[] };
            const dominio = (data ?? []).find(d => d.name === DOMINIO_ENVIO);

            if (!dominio) throw new Error(`La clave no ve ${DOMINIO_ENVIO}: es de otra cuenta de Resend`);
            if (dominio.status !== 'verified') throw new Error(`${DOMINIO_ENVIO} está en estado "${dominio.status}", no verificado`);
        }));
    } else {
        results.push({ name: 'Email · Resend', status: 'unconfigured', latency_ms: null, last_check: new Date().toISOString(), message: 'Falta RESEND_API_KEY en Supabase Secrets' });
    }

    return new Response(
        JSON.stringify({
            systems: results,
            credenciales: {
                'EE.FF.':      familiaClave(Deno.env.get('EEFF_SERVICE_ROLE_KEY')),
                'RiskGuard':   familiaClave(Deno.env.get('RISKGUARD_SERVICE_ROLE_KEY')),
                'Indicadores': familiaClave(Deno.env.get('INDICADORES_SERVICE_ROLE_KEY')),
            },
            checked_at: new Date().toISOString(),
        }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
});
