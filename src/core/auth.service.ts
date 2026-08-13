import { supabase } from './supabase.ts';
import { ROLE_PERMISSIONS, type User, type Permission } from './user.types.ts';

const SESSION_KEY     = 'hermesflow_session';
const RATE_KEY_PREFIX = 'hermesflow_rate_';
const MAX_ATTEMPTS    = 5;
const LOCKOUT_STEPS   = [30, 120, 300, 900];

interface RateData { attempts: number; lockedUntil: number; step: number; }

/**
 * Lo que trae el enlace de recuperación en el hash de la URL.
 *
 * Viven en memoria y nada más: no se guardan en localStorage ni se dejan en la
 * barra de direcciones (App.tsx la limpia nada más leerlos). Un `refresh_token`
 * en el historial del navegador es una credencial escrita en la pared.
 */
export interface TokensDeRecuperacion {
    accessToken:  string;
    refreshToken: string;
}

function getRateData(email: string): RateData {
    const raw = sessionStorage.getItem(`${RATE_KEY_PREFIX}${email}`);
    if (!raw) return { attempts: 0, lockedUntil: 0, step: 0 };
    try { return JSON.parse(raw) as RateData; }
    catch { return { attempts: 0, lockedUntil: 0, step: 0 }; }
}

function setRateData(email: string, data: RateData): void {
    sessionStorage.setItem(`${RATE_KEY_PREFIX}${email}`, JSON.stringify(data));
}

function mapProfile(p: Record<string, unknown>): User {
    return {
        id:             p.id as string,
        email:          p.email as string,
        name:           p.name as string,
        role:           p.role as User['role'],
        organizationId: p.organization_id as string,
        isActive:       p.is_active as boolean,
        // Ausente ⇒ true. Si la columna no llegara (perfil viejo, select
        // recortado, error de lectura), lo seguro es pedir el cambio, no
        // saltárselo: es la misma regla que la huella NULL de execute-workflow
        // y el `token !== ''` de las llamadas internas — lo que no se puede
        // comprobar no puede acabar diciendo que sí.
        debeCambiarClave: p.debe_cambiar_clave !== false,
    };
}

class AuthService {

    // ── Rate limiting ─────────────────────────────────────────────────────

    checkRateLimit(email: string): void {
        const rate = getRateData(email);
        if (rate.lockedUntil > Date.now()) {
            const secs = Math.ceil((rate.lockedUntil - Date.now()) / 1000);
            throw new Error(`LOCKOUT:${secs}`);
        }
    }

    recordFailedAttempt(email: string): number {
        const rate     = getRateData(email);
        const attempts = rate.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
            const step       = Math.min(rate.step, LOCKOUT_STEPS.length - 1);
            const lockoutSec = LOCKOUT_STEPS[step];
            setRateData(email, { attempts, lockedUntil: Date.now() + lockoutSec * 1000, step: step + 1 });
            return lockoutSec;
        }
        setRateData(email, { ...rate, attempts });
        return 0;
    }

    clearRateLimit(email: string): void {
        sessionStorage.removeItem(`${RATE_KEY_PREFIX}${email}`);
    }

    getAttempts(email: string): number {
        return getRateData(email).attempts;
    }

    // ── Login ─────────────────────────────────────────────────────────────

    async login(email: string, password: string): Promise<User> {
        const cleanEmail = email.trim().toLowerCase();
        this.checkRateLimit(cleanEmail);

        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: cleanEmail, password,
        });

        if (authError || !authData.user) {
            this.recordFailedAttempt(cleanEmail);
            const remaining = Math.max(0, MAX_ATTEMPTS - this.getAttempts(cleanEmail));
            if (authError?.message.includes('Invalid login credentials')) {
                throw new Error(
                    remaining > 0
                        ? `Credenciales incorrectas. Intentos restantes: ${remaining}.`
                        : 'Cuenta bloqueada temporalmente.'
                );
            }
            throw new Error('Error de autenticación. Intente nuevamente.');
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (profileError || !profile) {
            await this.logout();
            throw new Error('Su cuenta no tiene perfil configurado. Contacte al administrador.');
        }

        if (!profile.is_active) {
            await this.logout();
            throw new Error('Esta cuenta ha sido desactivada.');
        }

        const user = mapProfile(profile);
        this._saveSession(user);
        this.clearRateLimit(cleanEmail);
        return user;
    }

    // ── Sesión ────────────────────────────────────────────────────────────

    private _saveSession(user: User): void {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    }

    getCurrentUser(): User | null {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        try {
            const user = JSON.parse(raw) as User;
            if (!user.id || !user.organizationId || !user.role) {
                sessionStorage.removeItem(SESSION_KEY);
                return null;
            }
            return user;
        } catch {
            sessionStorage.removeItem(SESSION_KEY);
            return null;
        }
    }

    async syncSession(): Promise<User | null> {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            sessionStorage.removeItem(SESSION_KEY);
            return null;
        }

        const cached = this.getCurrentUser();
        if (cached && cached.id !== session.user.id) {
            sessionStorage.removeItem(SESSION_KEY);
            await supabase.auth.signOut();
            return null;
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

        if (!profile?.organization_id) {
            sessionStorage.removeItem(SESSION_KEY);
            return null;
        }

        const freshUser = mapProfile(profile);
        this._saveSession(freshUser);
        return freshUser;
    }

    async logout(): Promise<void> {
        await supabase.auth.signOut();
        sessionStorage.removeItem(SESSION_KEY);
    }

    hasPermission(user: User | null, permission: Permission): boolean {
        if (!user) return false;
        return (ROLE_PERMISSIONS[user.role] || []).includes(permission);
    }

    // ── Cambio de contraseña ──────────────────────────────────────────────
    // Verifica la clave actual re-autenticando, luego actualiza a la nueva.
    async changePassword(email: string, currentPassword: string, newPassword: string): Promise<void> {
        if (newPassword.length < 8) {
            throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
        }
        // 1. Verificar clave actual
        const { error: verifyErr } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(), password: currentPassword,
        });
        if (verifyErr) throw new Error('La contraseña actual es incorrecta.');

        // 2. Actualizar a la nueva
        const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
        if (updateErr) throw new Error(`No se pudo actualizar la contraseña: ${updateErr.message}`);

        // 3. La cuenta ya no arrastra una clave puesta por otro
        await this.marcarClaveCambiada();
    }

    // ── Recuperación de contraseña ────────────────────────────────────────

    /**
     * Quita la marca `debe_cambiar_clave` del propio perfil.
     *
     * Va por RPC y no por UPDATE porque `profiles` solo lo escribe un admin
     * (política profiles_admin_manage) y así debe seguir: una política de
     * «edita tu propia fila» le dejaría a cualquiera cambiarse el `role`. La
     * función SQL es SECURITY DEFINER, no recibe parámetros y solo toca esa
     * columna de la fila de auth.uid().
     */
    async marcarClaveCambiada(): Promise<void> {
        const { error } = await supabase.rpc('marcar_clave_cambiada');
        if (error) throw new Error(`No se pudo confirmar el cambio de contraseña: ${error.message}`);
    }

    /**
     * Pide un enlace de recuperación por correo.
     *
     * La Edge Function responde SIEMPRE lo mismo exista o no la cuenta, así que
     * aquí no hay nada que interpretar: se enseña su mensaje tal cual. Ese es el
     * punto — si la pantalla distinguiera, sería un comprobador de «¿trabaja
     * fulano aquí?» abierto a internet.
     */
    async requestPasswordReset(email: string): Promise<string> {
        const { data, error } = await supabase.functions.invoke('request-password-reset', {
            body: { email: email.trim().toLowerCase() },
        });
        if (error) throw new Error(await mensajeDeFuncion(error));
        if (data?.error) throw new Error(data.error);
        return data?.message ?? 'Si ese correo corresponde a una cuenta activa, recibirás un enlace.';
    }

    /**
     * Fija la contraseña nueva con los tokens que traía el enlace del correo.
     *
     * El cliente arranca con `detectSessionInUrl: false`, así que ese enlace no
     * ha abierto ninguna sesión: sus tokens son texto hasta que alguien los usa.
     * Aquí se usan durante lo que dura el cambio, y se tiran.
     *
     * **El `finally` no es limpieza, es el control.** Pase lo que pase —clave
     * rechazada, enlace caducado, red caída— este método no puede terminar
     * dejando una sesión abierta, porque entonces el enlace habría servido para
     * entrar sin saber la contraseña. Al salir de aquí solo se puede seguir por
     * el login, con la clave que se acaba de elegir.
     *
     * No se pide la clave actual: quien la ha olvidado es justo el que está
     * aquí, y lo que autoriza el cambio es el enlace firmado.
     */
    async setNewPassword(tokens: TokensDeRecuperacion, newPassword: string): Promise<void> {
        if (newPassword.length < 8) {
            throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
        }
        try {
            const { error: sesionErr } = await supabase.auth.setSession({
                access_token:  tokens.accessToken,
                refresh_token: tokens.refreshToken,
            });
            if (sesionErr) {
                throw new Error('El enlace ya no es válido o ha caducado. Pide uno nuevo desde «¿Olvidaste tu contraseña?».');
            }

            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw new Error(`No se pudo establecer la contraseña: ${error.message}`);

            await this.marcarClaveCambiada();
        } finally {
            // `.catch` a propósito: si el cierre fallara, su error taparía el de
            // arriba y la persona vería el motivo equivocado.
            await this.logout().catch(() => { /* la sesión ya no sirve igualmente */ });
        }
    }
}

/**
 * El motivo real de un fallo de Edge Function.
 *
 * `functions.invoke` tira el cuerpo de la respuesta y deja siempre la misma
 * frase inútil («Edge Function returned a non-2xx status code»); el motivo va
 * en `err.context`, que es la Response. Mismo arreglo que utils/errores.ts, en
 * versión mínima porque este fichero es núcleo y no debe depender de la UI.
 */
async function mensajeDeFuncion(err: unknown): Promise<string> {
    const ctx = (err as { context?: Response })?.context;
    if (ctx && typeof ctx.text === 'function') {
        try {
            const cuerpo = await ctx.text();
            const json = JSON.parse(cuerpo) as { error?: string };
            if (json?.error) return json.error;
            if (cuerpo.trim()) return cuerpo;
        } catch { /* sin cuerpo legible: cae al mensaje genérico */ }
    }
    return (err as Error)?.message ?? 'No se pudo contactar con el servidor.';
}

export const authService = new AuthService();
