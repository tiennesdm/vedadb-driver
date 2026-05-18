/**
 * useRBAC Hook — React hooks for role-based access control
 */
import { useMemo } from 'react';
import { Role, Permission, hasPermission, hasAnyPermission, hasRoleLevel } from '@/lib/rbac';
import useAppStore from '@/lib/vedadb-store';

/** Hook to check a single permission */
export function usePermission(permission: Permission): boolean {
  const role = useCurrentRole();
  return useMemo(() => {
    if (!role) return false;
    return hasPermission(role, permission);
  }, [role, permission]);
}

/** Hook to check if user has ANY of the given permissions */
export function useAnyPermission(permissions: Permission[]): boolean {
  const role = useCurrentRole();
  return useMemo(() => {
    if (!role) return false;
    return hasAnyPermission(role, permissions);
  }, [role, permissions]);
}

/** Hook to check if user's role meets minimum level */
export function useRoleLevel(minRole: Role): boolean {
  const role = useCurrentRole();
  return useMemo(() => {
    if (!role) return false;
    return hasRoleLevel(role, minRole);
  }, [role, minRole]);
}

/** Hook to get the current user's Role enum value */
export function useCurrentRole(): Role | null {
  const currentUser = useAppStore((s) => s.currentUser);
  return useMemo(() => {
    if (!currentUser?.role) return null;
    const r = Object.values(Role).find((rv) => rv === currentUser.role);
    return r ?? null;
  }, [currentUser]);
}

/** Hook to check if user is admin or higher */
export function useIsAdmin(): boolean {
  return useRoleLevel(Role.ADMIN);
}

/** Hook to check if user is manager or higher */
export function useIsManager(): boolean {
  return useRoleLevel(Role.MANAGER);
}

/** Hook to check if user is agent or higher */
export function useIsAgent(): boolean {
  return useRoleLevel(Role.AGENT);
}

/** Hook to check if user is customer */
export function useIsCustomer(): boolean {
  const role = useCurrentRole();
  return role === Role.CUSTOMER;
}

/** Hook to check if user is super_admin */
export function useIsSuperAdmin(): boolean {
  return useRoleLevel(Role.SUPER_ADMIN);
}
