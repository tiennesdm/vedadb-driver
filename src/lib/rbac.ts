/**
 * RBAC (Role-Based Access Control) Module
 * Defines roles, permissions, ticket types, and authorization helpers.
 */

// --- Role ---
export const Role = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  AGENT: 'agent',
  CUSTOMER: 'customer',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

// --- TicketType ---
export const TicketType = {
  INCIDENT: 'incident',
  SERVICE_REQUEST: 'service_request',
  PROBLEM: 'problem',
  CHANGE: 'change',
} as const;
export type TicketType = (typeof TicketType)[keyof typeof TicketType];

// --- Permission ---
export const Permission = {
  TICKET_VIEW_ALL: 'ticket:view:all',
  TICKET_VIEW_DEPT: 'ticket:view:department',
  TICKET_VIEW_OWN: 'ticket:view:own',
  TICKET_CREATE: 'ticket:create',
  TICKET_EDIT_ALL: 'ticket:edit:all',
  TICKET_EDIT_OWN: 'ticket:edit:own',
  TICKET_EDIT_ASSIGNED: 'ticket:edit:assigned',
  TICKET_DELETE: 'ticket:delete',
  TICKET_ASSIGN: 'ticket:assign',
  TICKET_BULK_OPS: 'ticket:bulk',
  USER_MANAGE: 'user:manage',
  USER_VIEW: 'user:view',
  KB_MANAGE: 'kb:manage',
  KB_CREATE: 'kb:create',
  KB_EDIT: 'kb:edit',
  KB_DELETE: 'kb:delete',
  KB_APPROVE: 'kb:approve',
  KB_VIEW: 'kb:view',
  CATEGORY_MANAGE: 'category:manage',
  SLA_MANAGE: 'sla:manage',
  SLA_VIEW: 'sla:view',
  AUTOMATION_MANAGE: 'automation:manage',
  CANNED_MANAGE: 'canned:manage',
  REPORT_VIEW_ALL: 'report:view:all',
  REPORT_VIEW_OWN: 'report:view:own',
  CATALOG_MANAGE: 'catalog:manage',
  AUDIT_VIEW: 'audit:view',
  ANNOUNCEMENT_MANAGE: 'announcement:manage',
  DEPARTMENT_MANAGE: 'department:manage',
  SETTINGS_MANAGE: 'settings:manage',
  CSAT_VIEW: 'csat:view',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission) as Permission[],
  [Role.ADMIN]: [
    Permission.TICKET_VIEW_ALL,
    Permission.TICKET_CREATE,
    Permission.TICKET_EDIT_ALL,
    Permission.TICKET_DELETE,
    Permission.TICKET_ASSIGN,
    Permission.TICKET_BULK_OPS,
    Permission.USER_MANAGE,
    Permission.USER_VIEW,
    Permission.KB_MANAGE,
    Permission.KB_CREATE,
    Permission.KB_EDIT,
    Permission.KB_DELETE,
    Permission.CATEGORY_MANAGE,
    Permission.SLA_MANAGE,
    Permission.SLA_VIEW,
    Permission.AUTOMATION_MANAGE,
    Permission.CANNED_MANAGE,
    Permission.REPORT_VIEW_ALL,
    Permission.REPORT_VIEW_OWN,
    Permission.CATALOG_MANAGE,
    Permission.AUDIT_VIEW,
    Permission.ANNOUNCEMENT_MANAGE,
    Permission.DEPARTMENT_MANAGE,
    Permission.SETTINGS_MANAGE,
    Permission.CSAT_VIEW,
  ],
  [Role.MANAGER]: [
    Permission.TICKET_VIEW_ALL,
    Permission.TICKET_CREATE,
    Permission.TICKET_EDIT_ALL,
    Permission.TICKET_ASSIGN,
    Permission.TICKET_BULK_OPS,
    Permission.USER_VIEW,
    Permission.KB_CREATE,
    Permission.KB_EDIT,
    Permission.KB_APPROVE,
    Permission.SLA_VIEW,
    Permission.CANNED_MANAGE,
    Permission.REPORT_VIEW_ALL,
    Permission.REPORT_VIEW_OWN,
    Permission.CSAT_VIEW,
    Permission.AUTOMATION_MANAGE,
  ],
  [Role.AGENT]: [
    Permission.TICKET_VIEW_DEPT,
    Permission.TICKET_CREATE,
    Permission.TICKET_EDIT_OWN,
    Permission.TICKET_EDIT_ASSIGNED,
    Permission.KB_CREATE,
    Permission.KB_EDIT,
    Permission.KB_VIEW,
    Permission.REPORT_VIEW_OWN,
    Permission.CANNED_MANAGE,
    Permission.CSAT_VIEW,
  ],
  [Role.CUSTOMER]: [
    Permission.TICKET_VIEW_OWN,
    Permission.TICKET_CREATE,
    Permission.KB_VIEW,
  ],
};

export function hasPermission(role: Role, p: Permission): boolean {
  if (role === Role.SUPER_ADMIN) return true;
  return ROLE_PERMISSIONS[role]?.includes(p) ?? false;
}

export function hasAnyPermission(role: Role, ps: Permission[]): boolean {
  return ps.some((p) => hasPermission(role, p));
}

export function hasRoleLevel(role: Role, minRole: Role): boolean {
  const levels: Record<string, number> = {
    customer: 1,
    agent: 2,
    manager: 3,
    admin: 4,
    super_admin: 5,
  };
  return (levels[role] ?? 0) >= (levels[minRole] ?? 0);
}

export function getRoleLabel(role: Role): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function getRoleColor(role: Role): string {
  const c: Record<Role, string> = {
    [Role.SUPER_ADMIN]: '#722ed1',
    [Role.ADMIN]: '#f5222d',
    [Role.MANAGER]: '#faad14',
    [Role.AGENT]: '#1890ff',
    [Role.CUSTOMER]: '#52c41a',
  };
  return c[role] ?? '#8a8a8a';
}

/** Get all permissions for a role as human-readable strings */
export function getRolePermissions(role: Role): string[] {
  return (ROLE_PERMISSIONS[role] ?? []).map((p) => p);
}

/** Check if a role can manage users */
export function canManageUsers(role: Role): boolean {
  return hasPermission(role, Permission.USER_MANAGE);
}

/** Check if a role can view all tickets */
export function canViewAllTickets(role: Role): boolean {
  return hasAnyPermission(role, [
    Permission.TICKET_VIEW_ALL,
    Permission.TICKET_VIEW_DEPT,
  ]);
}

/** Check if a role can manage settings */
export function canManageSettings(role: Role): boolean {
  return hasPermission(role, Permission.SETTINGS_MANAGE);
}
