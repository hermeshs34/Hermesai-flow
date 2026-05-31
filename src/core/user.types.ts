// ── Roles ───────────────────────────────────────────────────────────────────
// F1 Gobierno: roles BPM + legacy (compatibilidad con usuarios existentes)
export type Role =
    | 'admin'          // Administrador — control total + gestión usuarios
    | 'dueno_proceso'  // Dueño de Proceso — diseña y optimiza flujos de su área
    | 'supervisor'     // Supervisor/Control — aprueba, reasigna, monitorea
    | 'operador'       // Operativo — ejecuta y completa tareas
    | 'autorizador'    // Autorizador Máximo — aprueba operaciones sobre umbral crítico
    | 'auditor'        // Auditor — solo lectura total + trazabilidad
    // legacy (no romper usuarios existentes)
    | 'editor'
    | 'operator'
    | 'viewer';

// ── Permisos granulares ──────────────────────────────────────────────────────
export type Permission =
    | 'manage_users'       // CRUD usuarios y roles
    | 'manage_workflows'   // crear/editar/eliminar flujos
    | 'execute_workflows'  // ejecutar flujos
    | 'approve_tasks'      // aprobar/rechazar tareas humanas
    | 'authorize_critical' // autorizar operaciones sobre umbral crítico
    | 'manage_integrations'// conectar/configurar integraciones
    | 'view_logs'          // ver monitoreo/ejecuciones
    | 'view_audit'         // ver audit trail (gobierno)
    | 'view_all';          // lectura total de todos los módulos

export interface Organization {
    id:         string;
    name:       string;
    slug:       string;
    plan:       'free' | 'pro' | 'enterprise';
    is_active:  boolean;
}

export interface User {
    id:             string;
    email:          string;
    name:           string;
    role:           Role;
    organizationId: string;
    isActive:       boolean;
}

// ── Matriz rol → permisos ────────────────────────────────────────────────────
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    admin:         ['manage_users', 'manage_workflows', 'execute_workflows', 'approve_tasks', 'authorize_critical', 'manage_integrations', 'view_logs', 'view_audit', 'view_all'],
    dueno_proceso: ['manage_workflows', 'execute_workflows', 'view_logs', 'view_audit'],
    supervisor:    ['manage_workflows', 'execute_workflows', 'approve_tasks', 'view_logs'],
    operador:      ['execute_workflows', 'view_logs'],
    autorizador:   ['approve_tasks', 'authorize_critical', 'view_logs'],
    auditor:       ['view_all', 'view_logs', 'view_audit'],
    // legacy
    editor:        ['manage_workflows', 'execute_workflows', 'view_logs'],
    operator:      ['execute_workflows', 'view_logs'],
    viewer:        ['view_logs'],
};

// ── Metadata visual de roles ─────────────────────────────────────────────────
export const ROL_META: Record<Role, { label: string; color: string; descripcion: string }> = {
    admin:         { label: 'Administrador',     color: '#6366f1', descripcion: 'Control total del sistema y gestión de usuarios' },
    dueno_proceso: { label: 'Dueño de Proceso',  color: '#0ea5e9', descripcion: 'Diseña y optimiza los flujos de su área' },
    supervisor:    { label: 'Supervisor',        color: '#10b981', descripcion: 'Aprueba, reasigna y monitorea ejecuciones' },
    operador:      { label: 'Operativo',         color: '#f59e0b', descripcion: 'Ejecuta flujos y completa tareas asignadas' },
    autorizador:   { label: 'Autorizador Máximo',color: '#dc2626', descripcion: 'Aprueba operaciones sobre umbral crítico' },
    auditor:       { label: 'Auditor',           color: '#8b5cf6', descripcion: 'Lectura total y trazabilidad (sin modificar)' },
    editor:        { label: 'Editor',            color: '#0ea5e9', descripcion: 'Rol heredado — edita flujos' },
    operator:      { label: 'Operador',          color: '#f59e0b', descripcion: 'Rol heredado — ejecuta flujos' },
    viewer:        { label: 'Visualizador',      color: '#94a3b8', descripcion: 'Rol heredado — solo lectura' },
};

// Roles asignables desde la UI (los legacy no se ofrecen para nuevos usuarios)
export const ROLES_ASIGNABLES: Role[] = ['admin', 'dueno_proceso', 'supervisor', 'operador', 'autorizador', 'auditor'];
