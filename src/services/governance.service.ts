import { supabase } from '../core/supabase.ts';
import type { Role, User } from '../core/user.types.ts';

// ── Tipos ────────────────────────────────────────────────────────────────────
export interface AuditEntry {
    id:            string;
    usuario_email: string | null;
    accion:        string;
    entidad:       string;
    entidad_id:    string | null;
    descripcion:   string | null;
    created_at:    string;
}

export interface ManagedUser {
    id:        string;
    email:     string;
    name:      string;
    role:      Role;
    isActive:  boolean;
    createdAt: string;
}

type AuditAccion = 'crear' | 'modificar' | 'eliminar' | 'ejecutar' | 'aprobar' | 'rechazar' | 'login' | 'cambio_rol';
type AuditEntidad = 'workflow' | 'usuario' | 'integracion' | 'aprobacion' | 'sesion';

// ── Servicio de Gobierno ─────────────────────────────────────────────────────
export class GovernanceService {

    // ── Audit Log (inmutable) ─────────────────────────────────────────────
    static async log(
        actor: User,
        accion: AuditAccion,
        entidad: AuditEntidad,
        opts: { entidadId?: string; descripcion?: string; antes?: unknown; despues?: unknown } = {}
    ): Promise<void> {
        // Best-effort: el audit nunca debe romper el flujo principal
        try {
            await supabase.from('audit_log').insert({
                organization_id: actor.organizationId,
                usuario_id:      actor.id,
                usuario_email:   actor.email,
                accion,
                entidad,
                entidad_id:      opts.entidadId ?? null,
                descripcion:     opts.descripcion ?? null,
                datos_antes:     opts.antes ?? null,
                datos_despues:   opts.despues ?? null,
            });
        } catch (e) {
            console.error('audit log error:', e);
        }
    }

    static async getAuditTrail(organizationId: string, limit = 100): Promise<AuditEntry[]> {
        const { data, error } = await supabase
            .from('audit_log')
            .select('id, usuario_email, accion, entidad, entidad_id, descripcion, created_at')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw new Error(error.message);
        return (data ?? []) as AuditEntry[];
    }

    // ── Gestión de usuarios ───────────────────────────────────────────────
    static async getUsers(organizationId: string): Promise<ManagedUser[]> {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, email, name, role, is_active, created_at')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []).map((p: Record<string, unknown>) => ({
            id:        p.id as string,
            email:     p.email as string,
            name:      p.name as string,
            role:      p.role as Role,
            isActive:  p.is_active as boolean,
            createdAt: p.created_at as string,
        }));
    }

    // Crea un usuario vía Edge Function segura (service_role en el servidor).
    // El actor/organización se derivan del JWT en la propia Edge Function.
    static async createUser(
        payload: { email: string; name: string; role: Role; password?: string }
    ): Promise<{ tempPassword?: string }> {
        const { data, error } = await supabase.functions.invoke('admin-create-user', { body: payload });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        return { tempPassword: data?.temp_password };
    }

    // ¿Cuántos administradores ACTIVOS hay? (salvaguarda último admin)
    static async countActiveAdmins(organizationId: string): Promise<number> {
        const { count } = await supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('role', 'admin')
            .eq('is_active', true);
        return count ?? 0;
    }

    static async updateUserRole(actor: User, userId: string, newRole: Role, oldRole: Role): Promise<void> {
        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId)
            .eq('organization_id', actor.organizationId);
        if (error) throw new Error(error.message);
        await this.log(actor, 'cambio_rol', 'usuario', {
            entidadId: userId,
            descripcion: `Rol cambiado de ${oldRole} a ${newRole}`,
            antes: { role: oldRole }, despues: { role: newRole },
        });
    }

    static async setUserActive(actor: User, userId: string, active: boolean): Promise<void> {
        const { error } = await supabase
            .from('profiles')
            .update({ is_active: active })
            .eq('id', userId)
            .eq('organization_id', actor.organizationId);
        if (error) throw new Error(error.message);
        await this.log(actor, 'modificar', 'usuario', {
            entidadId: userId,
            descripcion: active ? 'Usuario activado' : 'Usuario desactivado',
        });
    }

    // ── Segregación de Funciones (SoD) ────────────────────────────────────
    // Regla: quien CREA un flujo no puede ser quien lo APRUEBA.
    static async puedeAprobar(usuarioId: string, workflowId: string): Promise<{ permitido: boolean; razon?: string }> {
        const { data: wf } = await supabase
            .from('workflows')
            .select('created_by')
            .eq('id', workflowId)
            .single();
        if (wf?.created_by && wf.created_by === usuarioId) {
            return { permitido: false, razon: 'Segregación de funciones: el creador del flujo no puede aprobarlo.' };
        }
        return { permitido: true };
    }

    // ── Matriz de aprobación ──────────────────────────────────────────────
    static async getMatriz(organizationId: string) {
        const { data, error } = await supabase
            .from('matriz_aprobacion')
            .select('*')
            .eq('organization_id', organizationId)
            .order('nivel', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    }

    // Determina qué rol debe aprobar según monto/categoría
    static async resolverAprobador(organizationId: string, monto: number, categoria?: string): Promise<string | null> {
        const matriz = await this.getMatriz(organizationId);
        const aplicables = (matriz as Array<Record<string, unknown>>)
            .filter(m => m.activa && Number(m.umbral_monto ?? 0) <= monto &&
                (!categoria || !m.categoria || m.categoria === categoria))
            .sort((a, b) => Number(b.umbral_monto) - Number(a.umbral_monto));
        return aplicables.length > 0 ? (aplicables[0].rol_aprobador as string) : null;
    }
}
