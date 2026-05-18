/**
 * PermissionMatrix - Visual grid of roles × permissions
 */
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Permission, ROLE_PERMISSIONS, Role } from '@/lib/rbac';
import { Shield, Check, X } from 'lucide-react';

export interface CustomRoleDef {
  id: string;
  name: string;
  description?: string;
  color: string;
  permissions: Permission[];
  userCount: number;
}

interface PermissionMatrixProps {
  customRoles: CustomRoleDef[];
  onTogglePermission?: (roleId: string, permission: Permission, enabled: boolean) => void;
  readOnly?: boolean;
}

const PERMISSION_CATEGORIES = [
  {
    label: 'Tickets',
    perms: [
      Permission.TICKET_VIEW_ALL,
      Permission.TICKET_VIEW_DEPT,
      Permission.TICKET_VIEW_OWN,
      Permission.TICKET_CREATE,
      Permission.TICKET_EDIT_ALL,
      Permission.TICKET_EDIT_OWN,
      Permission.TICKET_EDIT_ASSIGNED,
      Permission.TICKET_DELETE,
      Permission.TICKET_ASSIGN,
      Permission.TICKET_BULK_OPS,
    ],
  },
  {
    label: 'Users',
    perms: [Permission.USER_MANAGE, Permission.USER_VIEW],
  },
  {
    label: 'Knowledge Base',
    perms: [
      Permission.KB_MANAGE,
      Permission.KB_CREATE,
      Permission.KB_EDIT,
      Permission.KB_DELETE,
      Permission.KB_APPROVE,
      Permission.KB_VIEW,
    ],
  },
  {
    label: 'SLA & Reports',
    perms: [
      Permission.SLA_MANAGE,
      Permission.SLA_VIEW,
      Permission.REPORT_VIEW_ALL,
      Permission.REPORT_VIEW_OWN,
      Permission.CSAT_VIEW,
    ],
  },
  {
    label: 'Automation',
    perms: [Permission.AUTOMATION_MANAGE, Permission.CANNED_MANAGE],
  },
  {
    label: 'Administration',
    perms: [
      Permission.CATEGORY_MANAGE,
      Permission.CATALOG_MANAGE,
      Permission.AUDIT_VIEW,
      Permission.ANNOUNCEMENT_MANAGE,
      Permission.DEPARTMENT_MANAGE,
      Permission.SETTINGS_MANAGE,
    ],
  },
];

const DEFAULT_ROLES: { key: Role; label: string; color: string }[] = [
  { key: Role.SUPER_ADMIN, label: 'Super Admin', color: '#722ed1' },
  { key: Role.ADMIN, label: 'Admin', color: '#f5222d' },
  { key: Role.MANAGER, label: 'Manager', color: '#faad14' },
  { key: Role.AGENT, label: 'Agent', color: '#1890ff' },
  { key: Role.CUSTOMER, label: 'Customer', color: '#52c41a' },
];

export default function PermissionMatrix({ customRoles, onTogglePermission, readOnly = false }: PermissionMatrixProps) {
  const allRoles = useMemo(() => {
    const defaults = DEFAULT_ROLES.map((r) => ({
      id: r.key,
      name: r.label,
      color: r.color,
      permissions: ROLE_PERMISSIONS[r.key] || [],
      isDefault: true,
      userCount: 0,
    }));
    const customs = customRoles.map((r) => ({ ...r, isDefault: false }));
    return [...defaults, ...customs];
  }, [customRoles]);

  return (
    <Card className="border-[#e5e0d5] bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-[#1a1a1a]">
          <Shield className="h-4 w-4 text-[#c9a87c]" />
          Permission Matrix
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto">
        <div className="min-w-[800px]">
          {/* Header row */}
          <div className="mb-2 grid grid-cols-[200px_1fr] gap-2 border-b border-[#e5e0d5] pb-2">
            <div className="text-xs font-medium text-[#8a8a8a] uppercase">Permission</div>
            <div className="flex gap-2">
              {allRoles.map((role) => (
                <div
                  key={role.id}
                  className="flex w-24 flex-col items-center gap-1"
                  title={role.name}
                >
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <span className="max-w-full truncate text-[10px] font-medium text-[#595959]">
                    {role.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Categories */}
          {PERMISSION_CATEGORIES.map((cat) => (
            <div key={cat.label} className="mb-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full bg-[#fbf9f4] px-2 py-0.5 text-xs font-semibold text-[#c9a87c]">
                  {cat.label}
                </span>
                <div className="h-px flex-1 bg-[#e5e0d5]" />
              </div>
              {cat.perms.map((perm) => (
                <div
                  key={perm}
                  className="grid grid-cols-[200px_1fr] gap-2 border-b border-[#f5f3ee] py-1.5 hover:bg-[#fbf9f4]/50"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs text-[#595959]">{perm}</span>
                  </div>
                  <div className="flex gap-2">
                    {allRoles.map((role) => {
                      const has = role.permissions.includes(perm);
                      if (role.isDefault || readOnly) {
                        return (
                          <div
                            key={role.id}
                            className={cn(
                              'flex h-6 w-24 items-center justify-center rounded',
                              has ? 'bg-green-50' : 'bg-gray-50'
                            )}
                          >
                            {has ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <X className="h-3 w-3 text-gray-300" />
                            )}
                          </div>
                        );
                      }
                      return (
                        <div key={role.id} className="flex w-24 items-center justify-center">
                          <Switch
                            checked={has}
                            onCheckedChange={(v) =>
                              onTogglePermission?.(role.id, perm, v)
                            }
                            className="data-[state=checked]:bg-[#c9a87c]"
                            
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export { PERMISSION_CATEGORIES, DEFAULT_ROLES };
