import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { politicasSeguridadService } from '../services/politicasSeguridad.service';

// ============================================================================
// Segundo factor (TOTP) sobre el MFA nativo de Supabase — 27/10/2026
// ============================================================================
//
// Portado de RiskGuard (`src/lib/mfa.ts`), que a su vez lo trajo de Estados
// Financieros. Paso 3 del blindaje (/blindar-seguridad).
//
// Lo que da el servidor y no el navegador:
//  1. El código se comprueba en Supabase. El secreto no vuelve a bajar al
//     cliente después del alta.
//  2. Al verificar, el JWT sube de `aal1` a `aal2`. Eso es lo que lee
//     `public.mfa_satisfecho()` en las políticas `_aal2`: la barrera de verdad
//     es la RLS; estas pantallas solo guían al usuario.
//  3. Quitar un factor verificado exige `aal2`.
//
// El alta es obligatoria mientras `politicas_seguridad.exigir_mfa` esté
// encendido: quien entra sin factor no ve la aplicación hasta darlo de alta
// (App.tsx). Quien TIENE factor pasa el código siempre: eso lo exige la base y
// el interruptor no lo toca.

export interface FactorMfa {
    id:     string;
    nombre: string;
    creado: string;
}

export interface AltaMfa {
    factorId: string;
    /** SVG listo para un `<img src>`. */
    qr:       string;
    /** Para teclearlo a mano si no se puede escanear el QR. */
    secreto:  string;
}

/**
 * Estado del segundo factor de la sesión abierta.
 *
 * - `alta`      — el usuario no tiene factor verificado y la plataforma lo exige.
 * - `verificar` — lo tiene, y esta sesión aún no lo ha pasado (`aal1`).
 * - `ok`        — sesión `aal2` dentro del plazo, o sin factor con la exigencia apagada.
 * - `caducado`  — sesión `aal2` con el plazo vencido: hay que cerrarla.
 */
export type NivelMfa = 'alta' | 'verificar' | 'ok' | 'caducado';

const ISSUER = 'HermesAI Flow';

/**
 * Horas que vale el segundo factor. **Tiene que coincidir con el `interval` de
 * `public.mfa_satisfecho()`** (20261027b): la barrera es esa función, que deja
 * de ver los datos al vencer; esto solo cierra la sesión a la vez y dice por
 * qué, en vez de dejar al usuario delante de pantallas vacías.
 *
 * Existe por el AiTM: quien roba una sesión ya verificada se lleva el `aal2`
 * con ella, y sin caducidad le duraría lo que durase el refresh token.
 */
export const CADUCIDAD_MFA_HORAS = 6;

/** Clave de sessionStorage con el aviso que enseña el login tras un cierre. */
const AVISO_MFA_CADUCADO = 'hf_aviso_mfa_caducado';

const METODOS_SEGUNDO_FACTOR = ['totp', 'phone', 'webauthn'];

/**
 * Momento (ms) en que caduca el segundo factor de este token, o `null` si el
 * token no lo lleva (sesión `aal1`).
 *
 * La hora sale del claim `amr` del JWT: `[{method:'totp', timestamp}, …]`.
 * Supabase la toma de `auth.mfa_amr_claims` y un refresh no la mueve.
 */
export function caducidadDelMfa(accessToken: string): number | null {
    try {
        const base64 = (accessToken.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
        const carga = JSON.parse(atob(base64)) as { aal?: string; amr?: { method?: string; timestamp?: number }[] };
        if (carga.aal !== 'aal2' || !Array.isArray(carga.amr)) return null;

        const horas = carga.amr
            .filter(e => METODOS_SEGUNDO_FACTOR.includes(e?.method ?? ''))
            .map(e => Number(e.timestamp))
            .filter(Number.isFinite);
        if (horas.length === 0) return null;

        return (Math.max(...horas) + CADUCIDAD_MFA_HORAS * 3600) * 1000;
    } catch {
        return null;
    }
}

function dejarAviso(texto: string): void {
    try { sessionStorage.setItem(AVISO_MFA_CADUCADO, texto); } catch { /* noop */ }
}

/** Deja el aviso de caducidad para el login, que lo enseña una vez. */
export function avisarMfaCaducado(): void {
    dejarAviso(`Por seguridad, la verificación en dos pasos vale ${CADUCIDAD_MFA_HORAS} horas. Vuelve a entrar con tu contraseña y el código.`);
}

/** Aviso para el login cuando la base dio la sesión por cerrada. */
export function avisarSesionCerrada(): void {
    dejarAviso('Tu sesión se cerró (cambio de contraseña, cierre desde otro equipo o retirada del segundo factor). Vuelve a entrar con tu contraseña y el código.');
}

/** Aviso para el login tras cambiar la contraseña: el cambio cierra todas las sesiones. */
export function avisarClaveCambiada(): void {
    dejarAviso('Contraseña cambiada. Entra con la nueva y, si lo tienes, el código de tu aplicación.');
}

/** Devuelve el aviso pendiente, si lo hay, y lo borra. */
export function tomarAvisoMfaCaducado(): string | null {
    try {
        const aviso = sessionStorage.getItem(AVISO_MFA_CADUCADO);
        sessionStorage.removeItem(AVISO_MFA_CADUCADO);
        return aviso;
    } catch { return null; }
}

/** Mensajes de Supabase traducidos a algo que se pueda enseñar al usuario. */
function traducirError(error: { message: string; code?: string }): string {
    const m = error.message.toLowerCase();
    if (error.code === 'mfa_verification_failed' || m.includes('invalid totp code') || m.includes('invalid code')) {
        return 'Código incorrecto. Revisa que sea el que muestra tu aplicación en este momento.';
    }
    if (error.code === 'mfa_challenge_expired') {
        return 'El código ha caducado. Escribe el que muestra ahora tu aplicación.';
    }
    if (m.includes('too many requests') || m.includes('rate limit')) {
        return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
    }
    if (error.code === 'mfa_factor_name_conflict') {
        return 'Ya tienes un dispositivo con ese nombre. Elige otro.';
    }
    if (error.code === 'mfa_totp_enroll_not_enabled' || error.code === 'mfa_totp_verify_not_enabled') {
        return 'La verificación en dos pasos no está activada en el servidor. Avisa al administrador.';
    }
    if (error.code === 'insufficient_aal' || m.includes('aal2')) {
        return 'Para este cambio tienes que verificar primero tu segundo factor.';
    }
    return error.message;
}

function fallar(contexto: string, error: { message: string; code?: string }): never {
    console.error(`[MFA] ${contexto}:`, error.message);
    throw new Error(traducirError(error));
}

/**
 * Deja el QR de Supabase listo para un `<img src>`.
 *
 * `auth-js` ya lo devuelve con el prefijo `data:image/svg+xml;utf-8,` y el SVG
 * en crudo detrás: sin escapar, un `#` dentro del SVG corta la URL por el
 * fragmento y sale media imagen (EE.FF., 21/08/2026). Se quita el prefijo y se
 * vuelve a montar escapado.
 */
function qrADataUri(qr: string): string {
    let svg = qr;
    if (svg.startsWith('data:')) {
        const carga = svg.slice(svg.indexOf(',') + 1);
        try {
            svg = decodeURIComponent(carga);
        } catch {
            svg = carga;
        }
    }
    return `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`;
}

async function listarTotp(cliente: SupabaseClient = supabase): Promise<{ id: string; nombre: string; creado: string; verificado: boolean }[]> {
    const { data, error } = await cliente.auth.mfa.listFactors();
    if (error) fallar('listFactors', error);
    return (data?.all ?? [])
        .filter(f => f.factor_type === 'totp')
        .map(f => ({
            id:         f.id,
            nombre:     f.friendly_name || 'Dispositivo sin nombre',
            creado:     f.created_at,
            verificado: f.status === 'verified',
        }));
}

/**
 * Pasa el segundo factor sobre la sesión de `cliente`. Separado de
 * `mfaService.verificar` para la recuperación de contraseña, que trabaja con un
 * cliente en memoria (`crearClienteEfimero`) y no con el de la aplicación.
 */
export async function verificarCodigoCon(cliente: SupabaseClient, codigo: string): Promise<void> {
    const factor = (await listarTotp(cliente)).find(f => f.verificado);
    if (!factor) throw new Error('No tienes ningún dispositivo de verificación dado de alta.');
    const { error } = await cliente.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo.trim() });
    if (error) fallar('verificar', error);
}

export const mfaService = {
    /** Estado del segundo factor de la sesión abierta. */
    async estado(): Promise<NivelMfa> {
        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error) fallar('getAuthenticatorAssuranceLevel', error);
        if (data?.currentLevel === 'aal2') {
            return (await this.haCaducado()) ? 'caducado' : 'ok';
        }
        if (data?.nextLevel === 'aal2') return 'verificar';
        // Sin factor verificado: solo se pide el alta si la plataforma la exige.
        return (await politicasSeguridadService.exigeMfa()) ? 'alta' : 'ok';
    },

    /** Momento (ms) en que vence el segundo factor de la sesión abierta, o `null`. */
    async caducaA(): Promise<number | null> {
        const { data: { session } } = await supabase.auth.getSession();
        return session ? caducidadDelMfa(session.access_token) : null;
    },

    async haCaducado(): Promise<boolean> {
        const caduca = await this.caducaA();
        return caduca !== null && Date.now() >= caduca;
    },

    /**
     * ¿La base sigue dando por buena esta sesión? Lo contesta la misma
     * `mfa_satisfecho()` de las políticas `_aal2`. El JWT local no lo sabe: una
     * sesión cerrada en la base (cambio de clave, «Sesiones abiertas», el admin
     * quitando el factor) sigue pintando la aplicación, pero vacía.
     * `null` = no se pudo preguntar (sin red): con eso no se decide nada.
     */
    async sesionViva(): Promise<boolean | null> {
        const { data, error } = await supabase.rpc('mfa_satisfecho');
        if (error) return null;
        return data === true;
    },

    async factoresVerificados(): Promise<FactorMfa[]> {
        return (await listarTotp())
            .filter(f => f.verificado)
            .map(({ id, nombre, creado }) => ({ id, nombre, creado }));
    },

    /**
     * Da de alta un factor TOTP nuevo, sin verificar. Antes descarta los que
     * hayan quedado a medias de intentos anteriores: se acumulan en
     * `auth.mfa_factors` y hacen chocar el nombre del dispositivo.
     */
    async iniciarAlta(nombre: string): Promise<AltaMfa> {
        for (const f of (await listarTotp()).filter(f => !f.verificado)) {
            await this.descartarAlta(f.id);
        }
        const { data, error } = await supabase.auth.mfa.enroll({
            factorType:   'totp',
            friendlyName: nombre.trim() || `Dispositivo ${new Date().toLocaleDateString('es-VE')}`,
            issuer:       ISSUER,
        });
        if (error) fallar('enroll', error);
        if (!data) throw new Error('Supabase no devolvió los datos de alta del dispositivo.');
        return { factorId: data.id, qr: qrADataUri(data.totp.qr_code), secreto: data.totp.secret };
    },

    /**
     * Confirma el alta con el primer código de la aplicación. Supabase marca el
     * factor como verificado, sube la sesión a `aal2` y cierra el resto de
     * sesiones del usuario.
     */
    async confirmarAlta(factorId: string, codigo: string): Promise<void> {
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo.trim() });
        if (error) fallar('confirmarAlta', error);
    },

    /** Descarta un alta a medias (el usuario salió sin confirmar). */
    async descartarAlta(factorId: string): Promise<void> {
        const { error } = await supabase.auth.mfa.unenroll({ factorId });
        if (error) console.warn('[MFA] no se pudo descartar el alta a medias:', error.message);
    },

    /**
     * Pasa el segundo factor con la sesión ya abierta en `aal1` (así funciona el
     * MFA de Supabase: la contraseña abre la sesión y el código la sube).
     */
    async verificar(codigo: string): Promise<void> {
        await verificarCodigoCon(supabase, codigo);
    },
};
