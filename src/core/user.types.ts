export type Role = 'admin' | 'editor' | 'operator' | 'viewer';

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

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
    admin:    ['manage_workflows', 'manage_users', 'manage_integrations', 'view_logs', 'execute_workflows'],
    editor:   ['manage_workflows', 'view_logs', 'execute_workflows'],
    operator: ['execute_workflows', 'view_logs'],
    viewer:   ['view_logs'],
};

export const ROL_META: Record<Role, { label: string; color: string }> = {
    admin:    { label: 'Administrador', color: '#6366f1' },
    editor:   { label: 'Editor',        color: '#0ea5e9' },
    operator: { label: 'Operador',      color: '#f59e0b' },
    viewer:   { label: 'Visualizador',  color: '#94a3b8' },
};
