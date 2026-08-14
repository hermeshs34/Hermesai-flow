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
    | 'authorize_workflows'// autorizar/rechazar la DEFINICIÓN de un flujo (publicarlo)
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
//
// ⚠️ `authorize_workflows` (14/08/2026) es el hueco que dejó abierto sacar a
// `supervisor` de la edición: se le quitó editar «porque autoriza, no edita», y
// hasta hoy no había nada que autorizar a nivel de definición. Nace con el
// código que lo comprueba, no antes — la regla que manda de verdad es la función
// `transicionar_flujo()` de la base (20260814_ciclo_vida_flujos.sql), que repite
// estas dos listas porque es SQL y no puede importar este fichero. **Si cambias
// una, cambia la otra**, igual que `execute_workflows` y `view_audit` (§6).
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    admin:         ['manage_users', 'manage_workflows', 'execute_workflows', 'approve_tasks', 'manage_integrations', 'authorize_workflows', 'view_logs', 'view_audit', 'view_all'],
    dueno_proceso: ['manage_workflows', 'execute_workflows', 'view_logs', 'view_audit'],
    supervisor:    ['approve_tasks', 'authorize_workflows', 'view_logs'],
    operador:      ['view_logs'],
    autorizador:   ['execute_workflows', 'approve_tasks', 'authorize_workflows', 'view_logs'],
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

// ── Quién puede resolver una tarea de aprobación ─────────────────────────────
//
// Los procesos de cumplimiento y legitimación de capitales los autoriza SOLO el
// Oficial de Cumplimiento, ni siquiera un admin (decisión de negocio de Hermes,
// CLAUDE.md §6.2). El resto de tareas las resuelve el rol de `rol_aprobador` o
// un admin. Y sobre todo: quien lanzó el flujo nunca aprueba su propia tarea.
//
// ⚠️ Esto es GEMELO del bloque de autorización de
// `supabase/functions/resolve-approval/index.ts` (líneas 113-137), que es **el
// que manda de verdad**: la Edge Function es la que impide resolver; esto de
// aquí solo decide qué botón se pinta y qué contador se enseña. Está copiado y
// no importado porque Deno no alcanza `src/`, igual que `fecha.ts` y
// `ROLES_QUE_EJECUTAN`. **Si cambias uno, cambia el otro.**
//
// Antes del 14/08/2026 esto vivía suelto en CUATRO sitios del frontend y los
// cuatro decían cosas distintas, que es la forma que tiene una lista copiada de
// pudrirse sin avisar:
//   · `Governance.tsx`  — sin comprobar segregación de funciones: pintaba
//                          «Aprobar» en una tarea del propio solicitante, y al
//                          pulsarlo llegaba un 403 de la Edge Function.
//   · `Sidebar.tsx`     — lo mismo, así que el globo de pendientes contaba
//                          tareas que ese usuario no podía resolver.
//   · `Dashboard.tsx`   — tenía la segregación, pero su idea de «admin» era
//                          ['admin','supervisor','autorizador']: a un supervisor
//                          le contaba como suyas tareas de rol `admin` que
//                          `resolve-approval` le rechaza.
//   · `WorkQueue.tsx`   — la única que coincidía con la Edge Function.
// Ninguna de las tres se saltaba un control —la puerta la sigue guardando la
// función—, pero las tres mentían al usuario, que es el fallo de §12.2.
export const ROLES_REGULATORIOS: Role[] = ['cumplimiento'];

/** Lo mínimo de una tarea para decidir quién la resuelve. */
export interface TareaResoluble {
    rol_aprobador:   string;
    solicitante_id?: string | null;
}

/**
 * @param rolesDelegados  roles que esta persona ejerce por una suplencia vigente
 *   (`src/utils/delegaciones.ts`). Por defecto vacío: quien no le pase nada
 *   obtiene el comportamiento de siempre, nunca uno más permisivo.
 */
export function puedeResolverTarea(
    usuario: { id: string; role: Role | string },
    tarea:   TareaResoluble,
    rolesDelegados: string[] = [],
): boolean {
    // Segregación de funciones: quien ejecutó el flujo no lo aprueba. Va primero
    // porque no la levanta ningún rol, ni el de admin — **ni una delegación**.
    // Recibir la suplencia de otro no borra que fuiste tú quien lanzó el flujo.
    if (tarea.solicitante_id && tarea.solicitante_id === usuario.id) return false;

    // Una delegación vigente hace que ejerzas el rol del titular, además del
    // tuyo. Alcanza también a las tareas regulatorias, y tiene que alcanzarlas:
    // si no, no resolvería nada — el único punto único de fallo real es que hay
    // un solo Oficial de Cumplimiento (§6.2). Lo que impide que eso convierta la
    // delegación en la puerta de al lado de §6.2 es que un admin NO puede
    // crearle una delegación a un rol regulatorio: solo esa persona puede, y eso
    // lo guarda un trigger de la base, no esta función.
    const roles = [usuario.role, ...rolesDelegados];

    if (ROLES_REGULATORIOS.includes(tarea.rol_aprobador as Role)) {
        return roles.includes(tarea.rol_aprobador);
    }
    return roles.includes('admin') || roles.includes(tarea.rol_aprobador);
}
