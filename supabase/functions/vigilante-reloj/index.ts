// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Vigilante del reloj
//
// Comprueba cada pocos minutos que el planificador está vivo, y manda un
// correo a los administradores cuando no lo está.
//
// POR QUÉ EXISTE
// El 10/09/2026 el job de pg_cron desapareció de cron.job y la ejecución
// automática estuvo DOCE DÍAS parada. No falló ninguna alarma: es que no había
// ninguna. El Dashboard decía "sin ejecuciones automáticas", que es igual de
// cierto si el reloj está muerto que si a ningún flujo le tocaba, y nadie
// entra al Dashboard todos los días.
//
// ⚠️ LÍMITE HONESTO, Y NO ES PEQUEÑO
// A este vigilante lo dispara el MISMO pg_cron al que vigila. Si se cae
// pg_cron entero, o si alguien borra los dos jobs, el vigilante tampoco corre
// y no avisa de nada: un vigilante programado no puede detectar su propia
// desaparición. Lo que sí cubre —que son los dos incidentes reales que ha
// tenido este proyecto— es:
//   · el job de cron-runner borrado o desactivado mientras el suyo sigue
//     (10/09/2026)
//   · cron-runner devolviendo 401 o 500: el punto ciego de §6.1, donde pg_cron
//     marca "succeeded" porque net.http_post solo ENCOLA (07/08/2026, ocho días)
//   · la petición que se encola y no llega a salir
// Un aviso a prueba de todo necesitaría un pinger EXTERNO a la base. No lo
// hay, y abrir esa puerta es decisión de Hermes, no mía.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enviarEmail, canalEmail, escaparHtml } from '../_shared/email.ts';
import { fechaHoraVE } from '../_shared/fecha.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET      = Deno.env.get('CRON_SECRET') ?? '';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Cada cuánto se repite el aviso mientras el problema siga. Un correo cada
// diez minutos durante doce días son mil setecientos correos: la gente crea un
// filtro, y entonces la alarma deja de existir.
const MINUTOS_ENTRE_AVISOS = 60;

interface Salud {
    veredicto: string;
    grave: boolean;
    motivo: string;
    job_nombre: string | null;
    job_schedule: string | null;
    ultimo_tick: string | null;
    respuestas_10min: number;
    respuestas_ok_10min: number;
    ultimo_fallo_http: Record<string, unknown> | null;
    ultima_ejecucion_cron: string | null;
    medido_at: string;
}

function cuerpo(s: Salud, recuperado: boolean): string {
    const filas: [string, string][] = [
        ['Veredicto',                   s.veredicto],
        ['Job',                         s.job_nombre ?? '— no existe —'],
        ['Expresión',                   s.job_schedule ?? '—'],
        ['Último latido',               s.ultimo_tick ? fechaHoraVE(s.ultimo_tick) : 'nunca'],
        ['Respuestas OK (10 min)',      `${s.respuestas_ok_10min} de ${s.respuestas_10min}`],
        ['Última ejecución automática', s.ultima_ejecucion_cron ? fechaHoraVE(s.ultima_ejecucion_cron) : 'ninguna'],
    ];
    if (s.ultimo_fallo_http) filas.push(['Último fallo HTTP', JSON.stringify(s.ultimo_fallo_http)]);

    const cabecera = recuperado
        ? 'El planificador volvió a funcionar'
        : 'El planificador de HermesAI Flow está parado';

    const aviso = recuperado ? '' :
        `<p style="margin:0 0 16px;font-size:13px;color:#374151">Mientras dure,
          <strong>ningún flujo programado se ejecuta solo</strong>. La ejecución
          manual desde la aplicación no está afectada.</p>`;

    const tabla = filas.map(([k, v]) =>
        `<tr><td style="padding:5px 0;color:#6b7280;width:45%">${escaparHtml(k)}</td>
             <td style="padding:5px 0;font-family:ui-monospace,monospace">${escaparHtml(v)}</td></tr>`
    ).join('');

    return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:620px;margin:0 auto">
      <div style="background:${recuperado ? '#065f46' : '#991b1b'};color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
        <h1 style="margin:0;font-size:17px">${escaparHtml(cabecera)}</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 12px 12px;padding:20px 24px">
        <p style="margin:0 0 14px;font-size:14px;color:#111827">${escaparHtml(s.motivo)}</p>
        ${aviso}
        <table style="width:100%;border-collapse:collapse;font-size:12px;color:#374151">${tabla}</table>
        <p style="margin:18px 0 0;font-size:11px;color:#9ca3af">
          Medido en la base de datos a las ${escaparHtml(fechaHoraVE(s.medido_at))}, hora de Venezuela.
          Aviso automático del vigilante; no se repite antes de ${MINUTOS_ENTRE_AVISOS} minutos.
        </p>
      </div>
    </div>`;
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Misma puerta que cron-runner: su único llamante legítimo es el
    // planificador. El `!== ''` no es adorno — si el secreto llegara vacío por
    // un despliegue mal configurado, `'' === ''` abriría la función a
    // cualquiera que llame sin cabecera (§6.1).
    const token    = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    const cabecera = (req.headers.get('x-cron-secret') ?? '').trim();
    const esCron    = CRON_SECRET !== '' && (token === CRON_SECRET || cabecera === CRON_SECRET);
    const esService = token !== '' && token === SERVICE_ROLE_KEY;
    if (!esCron && !esService) {
        return json({ error: 'No autorizado — vigilante-reloj solo lo invoca el planificador' }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // supabase-js no lanza: devuelve el error (§5.1, regla 2). Y aquí no se
    // puede tragar — sería un vigilante que informa de salud sin medirla, que
    // es exactamente el instrumento que escondió el fallo ocho días.
    const { data: salud, error: errSalud } = await supabase.rpc('salud_cron');
    if (errSalud || !salud) {
        console.error('[vigilante] salud_cron falló:', errSalud?.message);
        return json({ error: `No se pudo medir el planificador: ${errSalud?.message ?? 'sin datos'}` }, 500);
    }
    const s = salud as Salud;

    const { data: estado } = await supabase
        .from('vigilante_reloj').select('*').eq('id', 1).maybeSingle();

    const antes      = estado?.ultimo_estado ?? null;
    const sano       = s.veredicto === 'ok';
    const recuperado = sano && antes !== null && antes !== 'ok';

    const minutosDesdeAviso = estado?.ultimo_aviso_at
        ? (Date.now() - new Date(estado.ultimo_aviso_at).getTime()) / 60_000
        : Infinity;
    const tocaAvisar = (!sano && minutosDesdeAviso >= MINUTOS_ENTRE_AVISOS) || recuperado;

    let enviados = 0;
    let motivoNoEnvio: string | null = null;

    if (tocaAvisar) {
        if (canalEmail() === 'ninguno') {
            motivoNoEnvio = 'sin canal de correo configurado (RESEND_API_KEY)';
        } else {
            // El reloj es infraestructura compartida, no algo de una
            // organización concreta, así que van todos los administradores
            // activos. No se usa `destinatariosDelRol` a propósito: una
            // delegación delega la capacidad de APROBAR (§6.6), no el ser
            // avisado de que el servidor se cayó.
            const { data: admins, error: errAdmins } = await supabase
                .from('profiles').select('email').eq('role', 'admin').eq('is_active', true);

            if (errAdmins) {
                motivoNoEnvio = `no se pudo leer la lista de administradores: ${errAdmins.message}`;
            } else {
                const destinos = (admins ?? []).map(a => a.email).filter(Boolean) as string[];
                if (destinos.length === 0) {
                    motivoNoEnvio = 'no hay ningún administrador activo con correo';
                } else {
                    try {
                        await enviarEmail(
                            destinos,
                            recuperado
                                ? 'HermesAI Flow — el planificador volvió a funcionar'
                                : 'HermesAI Flow — EL PLANIFICADOR ESTÁ PARADO',
                            cuerpo(s, recuperado),
                        );
                        enviados = destinos.length;
                    } catch (e) {
                        // Que no salga el correo no puede tumbar la medición: el
                        // estado se guarda igual y el Dashboard lo ve.
                        motivoNoEnvio = `fallo al enviar: ${e instanceof Error ? e.message : String(e)}`;
                        console.error('[vigilante]', motivoNoEnvio);
                    }
                }
            }
        }
    }

    const { error: errEstado } = await supabase.from('vigilante_reloj').upsert({
        id: 1,
        ultimo_estado:   s.veredicto,
        ultimo_ok_at:    sano ? new Date().toISOString() : (estado?.ultimo_ok_at ?? null),
        // Si el correo no llegó a salir NO se marca como avisado: así el ciclo
        // siguiente lo reintenta en vez de callarse una hora.
        ultimo_aviso_at: enviados > 0 ? new Date().toISOString() : (estado?.ultimo_aviso_at ?? null),
        avisos_enviados: (estado?.avisos_enviados ?? 0) + (enviados > 0 ? 1 : 0),
        detalle_json:    s as unknown as Record<string, unknown>,
        actualizado_at:  new Date().toISOString(),
    });
    if (errEstado) console.error('[vigilante] no se pudo guardar el estado:', errEstado.message);

    return json({
        veredicto: s.veredicto,
        motivo:    s.motivo,
        recuperado,
        avisados:  enviados,
        no_enviado_porque: motivoNoEnvio,
    });
});
