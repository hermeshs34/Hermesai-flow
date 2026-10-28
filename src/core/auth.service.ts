import { supabase, crearClienteEfimero } from './supabase.ts';
import { verificarCodigoCon } from './mfa.ts';
import { ROLE_PERMISSIONS, type User, type Permission } from './user.types.ts';

const SESSION_KEY     = 'hermesflow_session';
const RATE_KEY_PREFIX = 'hermesflow_rate_';
const MAX_ATTEMPTS    = 5;
const LOCKOUT_STEPS   = [30, 120, 300, 900];

// Turnstile (§ blindaje, paso 7): el token falta, caducó o ya se usó. Cada
// token vale una vez, así que la pantalla remonta el widget tras cada intento.
const MENSAJE_CAPTCHA = 'La verificación anti-robots no se completó o caducó. Márquela de nuevo e inténtelo otra vez.';

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

/**
 * Una recuperación de contraseña en curso (27/10/2026). Vive en un cliente en
 * memoria: si la persona cierra la pestaña a medias, no queda nada guardado.
 * Quien la abre debe llamar a `cerrar()` al salir, pase lo que pase.
 */
export interface Recuperacion {
    /** La cuenta tiene segundo factor: hay que pasar el código antes de fijar la clave. */
    necesitaCodigo: boolean;
    verificarCodigo(codigo: string): Promise<void>;
    /** Fija la clave nueva y cierra la sesión del enlace. */
    fijar(clave: string): Promise<void>;
    cerrar(): Promise<void>;
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

    /**
     * `captchaToken` es el de Turnstile: con el captcha encendido en el panel de
     * Auth, GoTrue rechaza la entrada sin él.
     */
    async login(email: string, password: string, captchaToken?: string): Promise<User> {
        const cleanEmail = email.trim().toLowerCase();
        this.checkRateLimit(cleanEmail);

        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: cleanEmail, password,
            options: captchaToken ? { captchaToken } : undefined,
        });

        // Una cuenta desactivada está baneada en Auth (admin-set-active, §6.8).
        // Medido el 09/10/2026: Auth contesta `user_banned` ANTES de mirar la
        // contraseña, con la buena y con la mala, así que decirlo aquí no
        // revela nada que la API no diga ya. No cuenta como intento fallido:
        // no es una clave mal escrita, y el contador la haría parecer una.
        if (authError?.code === 'user_banned') {
            throw new Error('Esta cuenta está desactivada. Contacte al administrador.');
        }

        // 27/10/2026: con la protección CAPTCHA encendida en Auth y sin widget en
        // esta pantalla, TODO inicio de sesión volvía `captcha_failed` y se leía
        // como «Error de autenticación» — parecía una clave mal escrita. Desde el
        // 28/10 hay widget, y esto es un token que faltó, caducó o ya se usó.
        // No es una clave mal escrita: no cuenta como intento.
        if (authError?.code === 'captcha_failed') {
            throw new Error(MENSAJE_CAPTCHA);
        }

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

        // Desde el 09/10/2026 la RLS no le devuelve su perfil a una cuenta
        // desactivada (20261009_inactivo_fuera_de_rls.sql), así que este caso
        // cubre las dos cosas y no se pueden distinguir desde aquí.
        if (profileError || !profile) {
            await this.logout();
            throw new Error('Esta cuenta está desactivada o no tiene perfil configurado. Contacte al administrador.');
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

        // Al recargar también: alguien desactivado con la sesión abierta seguía
        // dentro hasta el 09/10/2026, porque esto solo miraba la organización.
        // Desde esa fecha la RLS ya no le devuelve su propio perfil, así que el
        // primer caso es el que salta; el segundo es la segunda red.
        if (!profile?.organization_id || profile.is_active !== true) {
            await this.logout();
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
    /**
     * Verifica la clave actual y la cambia por la nueva.
     *
     * La clave actual se comprueba en un cliente aparte (27/10/2026): un
     * `signInWithPassword` sobre el principal abría una sesión nueva en `aal1`,
     * y a quien tiene segundo factor Auth le rechaza el cambio sin `aal2`.
     *
     * Al volver, quien llama debe cerrar sesión (ChangePasswordModal): Auth
     * cierra las demás sesiones de la cuenta al cambiar la clave, y medido en
     * RiskGuard la propia tampoco sobrevive con garantías.
     */
    async changePassword(email: string, currentPassword: string, newPassword: string, captchaToken?: string): Promise<void> {
        if (newPassword.length < 8) {
            throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
        }
        // 1. Verificar clave actual, sin tocar la sesión de la aplicación
        const comprobador = crearClienteEfimero();
        // Es un `signInWithPassword` más: con el captcha encendido, GoTrue también
        // lo pide aquí, y sin él toda clave actual «sería incorrecta».
        const { error: verifyErr } = await comprobador.auth.signInWithPassword({
            email: email.trim().toLowerCase(), password: currentPassword,
            options: captchaToken ? { captchaToken } : undefined,
        });
        await comprobador.auth.signOut({ scope: 'local' }).catch(() => { /* sesión en memoria */ });
        if (verifyErr?.code === 'captcha_failed') throw new Error(MENSAJE_CAPTCHA);
        if (verifyErr) throw new Error('La contraseña actual es incorrecta.');

        // 2. Actualizar a la nueva
        const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
        if (updateErr) {
            if (updateErr.code === 'insufficient_aal') {
                throw new Error('Para cambiar la contraseña tienes que haber verificado tu segundo factor en esta sesión. Cierra sesión y vuelve a entrar.');
            }
            throw new Error(`No se pudo actualizar la contraseña: ${updateErr.message}`);
        }

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
    async requestPasswordReset(email: string, captchaToken?: string): Promise<string> {
        // El token lo comprueba la función, no GoTrue: `generateLink` no pasa
        // por el captcha del panel.
        const { data, error } = await supabase.functions.invoke('request-password-reset', {
            body: { email: email.trim().toLowerCase(), captchaToken },
        });
        if (error) throw new Error(await mensajeDeFuncion(error));
        if (data?.error) throw new Error(data.error);
        return data?.message ?? 'Si ese correo corresponde a una cuenta activa, recibirás un enlace.';
    }

    /**
     * Abre la recuperación con los tokens que traía el enlace del correo.
     *
     * El cliente principal arranca con `detectSessionInUrl: false`, así que ese
     * enlace no ha abierto ninguna sesión: sus tokens son texto hasta que alguien
     * los usa. Aquí se usan en un cliente EN MEMORIA (`crearClienteEfimero`),
     * porque desde el 27/10/2026 puede haber un paso intermedio —el código del
     * segundo factor— y una sesión guardada entre pasos sería una sesión que
     * sobrevive a cerrar la pestaña (§6.4).
     *
     * Con segundo factor, la clave no se cambia solo con el enlace: quien robe el
     * correo no debe poder quedarse con la cuenta. Se pide el código antes.
     *
     * **El `finally` de `fijar` y `cerrar()` no son limpieza, son el control.**
     * Pase lo que pase, al salir de aquí solo se puede seguir por el login.
     * No se pide la clave actual: quien la ha olvidado es justo el que está aquí.
     */
    async abrirRecuperacion(tokens: TokensDeRecuperacion): Promise<Recuperacion> {
        const cliente = crearClienteEfimero();
        const cerrar = async () => {
            // `.catch` a propósito: si el cierre fallara, su error taparía el
            // motivo real y la persona vería el equivocado.
            await cliente.auth.signOut().catch(() => { /* la sesión ya no sirve igualmente */ });
        };

        const { error: sesionErr } = await cliente.auth.setSession({
            access_token:  tokens.accessToken,
            refresh_token: tokens.refreshToken,
        });
        if (sesionErr) {
            await cerrar();
            throw new Error('El enlace ya no es válido o ha caducado. Pide uno nuevo desde «¿Olvidaste tu contraseña?».');
        }

        const { data: nivel, error: nivelErr } = await cliente.auth.mfa.getAuthenticatorAssuranceLevel();
        if (nivelErr || !nivel) {
            await cerrar();
            throw new Error('No se pudo comprobar la verificación en dos pasos de la cuenta. Pide un enlace nuevo.');
        }
        const necesitaCodigo = nivel.nextLevel === 'aal2' && nivel.currentLevel !== 'aal2';

        return {
            necesitaCodigo,
            verificarCodigo: codigo => verificarCodigoCon(cliente, codigo),
            async fijar(clave: string) {
                if (clave.length < 8) {
                    throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
                }
                try {
                    const { error } = await cliente.auth.updateUser({ password: clave });
                    if (error) {
                        if (error.code === 'insufficient_aal') {
                            throw new Error('Antes de cambiar la contraseña tienes que escribir el código de tu aplicación autenticadora.');
                        }
                        throw new Error(`No se pudo establecer la contraseña: ${error.message}`);
                    }
                    // Mismo efecto que `marcarClaveCambiada`, pero con la sesión del enlace.
                    const { error: marcaErr } = await cliente.rpc('marcar_clave_cambiada');
                    if (marcaErr) throw new Error(`No se pudo confirmar el cambio de contraseña: ${marcaErr.message}`);
                } finally {
                    await cerrar();
                }
            },
            cerrar,
        };
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
