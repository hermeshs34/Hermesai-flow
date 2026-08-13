// ── Roles ───────────────────────────────────────────────────────────────────
// F1 Gobierno: roles BPM + legacy (compatibilidad con usuarios existentes)
export type Role =
    | 'admin'          // Administrador — control total + gestión usuarios
    | 'dueno_proceso'  // Dueño de Proceso — diseña y optimiza flujos de su área
    | 'supervisor'     // Supervisor/Control — aprueba, reasigna, monitorea
    | 'operador'       // Operativo — ejecuta y completa tareas
    | 'autorizador'    // Autorizador Máximo — aprueba operaciones sobre umbral crítico
    | 'cumplimiento'   // Cumplimiento AML/CFT — aprueba procesos OFAC/PEP/ROS
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
    // true cuando la clave vigente se la puso un administrador por olvido.
    // Mientras siga puesta, la cuenta tiene dos dueños: la app obliga a
    // cambiarla antes de dejar usar nada.
    debeCambiarClave: boolean;
}

// ── Matriz rol → permisos ────────────────────────────────────────────────────
//
// ⚠️ `execute_workflows` lo tienen SOLO admin, dueno_proceso y autorizador.
// Es una decisión de negocio de Hermes (08/08/2026): «la ejecución de los
// procesos es del dueño del proceso y el administrador o quien autoriza el
// proceso que está definido». Antes lo tenían también supervisor, operador y
// los legacy editor/operator.
//
// Esta lista y la constante ROLES_QUE_EJECUTAN de
// supabase/functions/execute-workflow/index.ts SON LA MISMA REGLA en dos capas
// y tienen que moverse juntas: la de aquí esconde el botón, la de allí es la
// que de verdad impide ejecutar. Está copiada y no importada porque una Edge
// Function corre en Deno y no alcanza src/. Ver CLAUDE.md §6.
//
// ⚠️ `supervisor` NO tiene `manage_workflows`, y es a propósito (decisión de
// Hermes, 12/08/2026): «el supervisor no edita el flujo, solo lo autoriza,
// porque se pierde el control; debe remitir al dueño para su edición y
// corrección». Quien controla no edita, o los cuatro ojos se rompen en el otro
// sentido. Lo tuvo hasta ese día, cuando el rol estaba vacío y quitárselo lo
// habría dejado sin nada que hacer; el alta de un supervisor real acabó con esa
// excusa. La política RLS de edición se movió a la vez
// (20260812_supervisor_no_edita.sql): las dos capas deben decir lo mismo.
//
// ⚠️ Aquí NO hay permisos decorativos. Se retiró `authorize_critical`
// (13/08/2026): estaba concedido a `admin` y `autorizador` y **no lo leía ni
// una línea de código** — ni un `hasPermission`, ni una política RLS, ni una
// Edge Function. Un permiso que no gobierna nada es peor que no tenerlo: se
// mira la tabla de roles, se da por cubierto un control que no existe, y nadie
// vuelve a preguntarse quién autoriza las operaciones críticas. Lo que sí
// gobierna eso es la matriz de aprobación (Gobierno → Matriz), que desde hoy
// lee `execute-workflow`. Si algún día hace falta un permiso nuevo, se añade
// junto al código que lo comprueba, no antes.
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    admin:         ['manage_users', 'manage_workflows', 'execute_workflows', 'approve_tasks', 'manage_integrations', 'view_logs', 'view_audit', 'view_all'],
    dueno_proceso: ['manage_workflows', 'execute_workflows', 'view_logs', 'view_audit'],
    supervisor:    ['approve_tasks', 'view_logs'],
    operador:      ['view_logs'],
    autorizador:   ['execute_workflows', 'approve_tasks', 'view_logs'],
    cumplimiento:  ['approve_tasks', 'view_logs', 'view_audit'],
    auditor:       ['view_all', 'view_logs', 'view_audit'],
    // legacy
    editor:        ['manage_workflows', 'view_logs'],
    operator:      ['view_logs'],
    viewer:        ['view_logs'],
};

// ── Metadata visual de roles ─────────────────────────────────────────────────
export const ROL_META: Record<Role, { label: string; color: string; descripcion: string }> = {
    admin:         { label: 'Administrador',     color: '#6366f1', descripcion: 'Control total del sistema y gestión de usuarios' },
    dueno_proceso: { label: 'Dueño de Proceso',  color: '#0ea5e9', descripcion: 'Diseña y optimiza los flujos de su área' },
    supervisor:    { label: 'Supervisor',        color: '#10b981', descripcion: 'Aprueba, reasigna y monitorea ejecuciones' },
    operador:      { label: 'Operativo',         color: '#f59e0b', descripcion: 'Ejecuta flujos y completa tareas asignadas' },
    autorizador:   { label: 'Autorizador Máximo',color: '#dc2626', descripcion: 'Aprueba operaciones sobre umbral crítico' },
    cumplimiento:  { label: 'Cumplimiento',      color: '#0891b2', descripcion: 'Aprueba procesos AML/CFT, OFAC/PEP y reportes ROS' },
    auditor:       { label: 'Auditor',           color: '#8b5cf6', descripcion: 'Lectura total y trazabilidad (sin modificar)' },
    editor:        { label: 'Editor',            color: '#0ea5e9', descripcion: 'Rol heredado — edita flujos' },
    operator:      { label: 'Operador',          color: '#f59e0b', descripcion: 'Rol heredado — ejecuta flujos' },
    viewer:        { label: 'Visualizador',      color: '#94a3b8', descripcion: 'Rol heredado — solo lectura' },
};

// Roles asignables desde la UI (los legacy no se ofrecen para nuevos usuarios)
export const ROLES_ASIGNABLES: Role[] = ['admin', 'dueno_proceso', 'supervisor', 'operador', 'autorizador', 'cumplimiento', 'auditor'];
