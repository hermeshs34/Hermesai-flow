import { supabase } from '../core/supabase.ts';
import type { Role, User } from '../core/user.types.ts';
import { mensajeDeEdgeFunction } from '../utils/errores.ts';

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
// ⚠️ Estos valores los comprueba el CHECK `audit_log_entidad_check` en la base.
// Añadir uno aquí sin migrarlo allí hace que el INSERT se rechace — y como el
// audit es best-effort, se perdería en silencio. `matriz_aprobacion` entró el
// 13/08/2026 (20260813_audit_matriz_aprobacion.sql).
type AuditEntidad = 'workflow' | 'usuario' | 'integracion' | 'aprobacion' | 'sesion' | 'matriz_aprobacion';

// ── Servicio de Gobierno ─────────────────────────────────────────────────────
export class GovernanceService {

    // ── Audit Log (inmutable) ─────────────────────────────────────────────
    static async log(
        actor: User,
        accion: AuditAccion,
        entidad: AuditEntidad,
        opts: { entidadId?: string; descripcion?: string; antes?: unknown; despues?: unknown } = {}
    ): Promise<void> {
        // Best-effort: el audit nunca debe romper el flujo principal.
        //
        // Pero «no romper» no es «no enterarse». supabase-js DEVUELVE el error,
        // no lo lanza, así que este try/catch nunca lo vería: un CHECK violado
        // o una RLS que rechaza pasarían por aquí como si se hubiera escrito
        // (§5.1). Se comprueba y se deja rastro en consola.
        try {
            const { error } = await supabase.from('audit_log').insert({
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
            if (error) {
                console.error(`audit log NO escrito (${accion}/${entidad}): ${error.message}`);
            }
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
        if (error) throw new Error(await mensajeDeEdgeFunction(error, 'No se pudo crear el usuario.'));
        if (data?.error) throw new Error(data.error);
        return { tempPassword: data?.temp_password };
    }

    /**
     * Asigna una clave temporal a alguien que olvidó la suya.
     *
     * La clave la inventa el servidor y vuelve UNA vez: no se guarda en ningún
     * sitio ni se escribe en la auditoría, que registra el hecho y no el
     * secreto. La cuenta queda marcada para forzar el cambio en el primer
     * acceso — mientras esa clave siga puesta, la conocen dos personas.
     *
     * Quién puede hacerlo lo decide la Edge Function con el JWT (solo admin de
     * la misma organización); esto es la pantalla, no el control.
     */
    static async resetPassword(userId: string): Promise<{ tempPassword: string }> {
        const { data, error } = await supabase.functions.invoke('admin-reset-password', {
            body: { userId },
        });
        if (error) throw new Error(await mensajeDeEdgeFunction(error, 'No se pudo restablecer la contraseña.'));
        if (data?.error) throw new Error(data.error);
        if (!data?.temp_password) {
            // Sin clave que enseñar no hay nada que entregar: decirlo, y no
            // dejar un «hecho» que el admin no pueda usar.
            throw new Error('El servidor no devolvió la clave temporal. Vuelve a intentarlo.');
        }
        return { tempPassword: data.temp_password as string };
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

    // ⚠️ Aquí vivía `resolverAprobador`, que decidía el aprobador con SUS
    // propias reglas —ignoraba el `operador`, trataba «sin categoría» como
    // comodín en los dos sentidos y no miraba el nivel— y a la que **no llamaba
    // nadie**. Retirada el 13/08/2026: quien decide es `resolverRegla` de
    // `src/utils/matrizAprobacion.ts`, gemelo exacto del que usa el motor en
    // `_shared/matriz.ts`. Un segundo emparejador con otro criterio es una
    // respuesta distinta esperando a que alguien la llame por error.
}
