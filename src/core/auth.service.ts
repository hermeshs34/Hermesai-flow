import { supabase } from './supabase.ts';
import { ROLE_PERMISSIONS, type User, type Permission } from './user.types.ts';

const SESSION_KEY     = 'hermesflow_session';
const RATE_KEY_PREFIX = 'hermesflow_rate_';
const MAX_ATTEMPTS    = 5;
const LOCKOUT_STEPS   = [30, 120, 300, 900];

interface RateData { attempts: number; lockedUntil: number; step: number; }

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
    }
}

export const authService = new AuthService();
