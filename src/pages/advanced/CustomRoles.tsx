/**
 * CustomRoles - Route: /custom-roles
 * Create custom roles beyond the 5 default ones with full permission management.
 */
import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Permission } from '@/lib/rbac';
import {
  Shield, Plus, Search, Users, Copy, Trash2, ChevronRight,
} from 'lucide-react';
import PermissionMatrix, { type CustomRoleDef } from '@/components/advanced/PermissionMatrix';
import RoleBuilder from '@/components/advanced/RoleBuilder';

const STORAGE_KEY = 'veda_custom_roles';

function loadCustomRoles(): CustomRoleDef[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* */ }
  return [
    {
      id: 'role-senior-agent',
      name: 'Senior Agent',
      color: '#13c2c2',
      permissions: [
        Permission.TICKET_VIEW_ALL,
        Permission.TICKET_CREATE,
        Permission.TICKET_EDIT_ALL,
        Permission.TICKET_ASSIGN,
        Permission.KB_CREATE,
        Permission.KB_EDIT,
        Permission.KB_APPROVE,
        Permission.REPORT_VIEW_OWN,
        Permission.CANNED_MANAGE,
        Permission.CSAT_VIEW,
      ],
      userCount: 3,
    },
  ];
}

function saveCustomRoles(roles: CustomRoleDef[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(roles)); } catch { /* */ }
}

export default function CustomRoles() {
  const [roles, setRoles] = useState<CustomRoleDef[]>(loadCustomRoles);
  const [search, setSearch] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRoleDef | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  const filteredRoles = useMemo(() => {
    if (!search) return roles;
    const q = search.toLowerCase();
    return roles.filter((r) => r.name.toLowerCase().includes(q));
  }, [roles, search]);

  const handleSave = useCallback((data: Omit<CustomRoleDef, 'id' | 'userCount'>) => {
    if (editingRole) {
      setRoles((prev) => {
        const next = prev.map((r) =>
          r.id === editingRole.id ? { ...r, ...data, id: r.id, userCount: r.userCount } : r
        );
        saveCustomRoles(next);
        return next;
      });
      setEditingRole(null);
    } else {
      const newRole: CustomRoleDef = {
        ...data,
        id: `role-${Date.now()}`,
        userCount: 0,
      };
      setRoles((prev) => {
        const next = [...prev, newRole];
        saveCustomRoles(next);
        return next;
      });
    }
    setShowBuilder(false);
  }, [editingRole]);

  const handleDuplicate = useCallback((role: CustomRoleDef) => {
    const dup: CustomRoleDef = {
      ...role,
      id: `role-${Date.now()}`,
      name: `${role.name} (Copy)`,
      userCount: 0,
    };
    setRoles((prev) => {
      const next = [...prev, dup];
      saveCustomRoles(next);
      return next;
    });
  }, []);

  const handleDelete = useCallback((id: string) => {
    setRoles((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveCustomRoles(next);
      return next;
    });
    if (selectedRoleId === id) setSelectedRoleId(null);
  }, [selectedRoleId]);

  const handleTogglePermission = useCallback((roleId: string, perm: Permission, enabled: boolean) => {
    setRoles((prev) => {
      const next = prev.map((r) => {
        if (r.id !== roleId) return r;
        const perms = enabled
          ? [...r.permissions, perm]
          : r.permissions.filter((p) => p !== perm);
        return { ...r, permissions: perms };
      });
      saveCustomRoles(next);
      return next;
    });
  }, []);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#1a1a1a]">
            <Shield className="h-5 w-5 text-[#c9a87c]" />
            Custom Roles
          </h1>
          <p className="mt-0.5 text-sm text-[#8a8a8a]">
            Build and manage roles beyond the 5 system defaults
          </p>
        </div>
        <Button
          onClick={() => { setEditingRole(null); setShowBuilder(true); }}
          className="bg-[#c9a87c] text-white hover:bg-[#b8996c]"
          
        >
          <Plus className="mr-1 h-4 w-4" />
          New Role
        </Button>
      </div>

      <Tabs defaultValue="roles" className="w-full">
        <TabsList className="bg-[#fbf9f4] border border-[#e5e0d5]">
          <TabsTrigger value="roles" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            Roles ({roles.length})
          </TabsTrigger>
          <TabsTrigger value="matrix" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            Permission Matrix
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-[#8a8a8a]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search roles..."
              className="h-8 max-w-xs border-[#e5e0d5] bg-[#fbf9f4] text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Role List */}
            <div className="space-y-2 lg:col-span-1">
              {filteredRoles.map((role) => (
                <Card
                  key={role.id}
                  className={cn(
                    'cursor-pointer border-[#e5e0d5] bg-white transition-all hover:shadow-sm',
                    selectedRoleId === role.id && 'ring-1 ring-[#c9a87c]'
                  )}
                  onClick={() => setSelectedRoleId(role.id === selectedRoleId ? null : role.id)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: role.color }}
                      >
                        {role.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="truncate text-sm font-medium text-[#1a1a1a]">{role.name}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDuplicate(role); }}
                              className="rounded p-1 text-[#8a8a8a] hover:bg-[#fbf9f4] hover:text-[#c9a87c]"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            {role.userCount === 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(role.id); }}
                                className="rounded p-1 text-[#8a8a8a] hover:bg-[#fbf9f4] hover:text-red-600"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-[#8a8a8a]">
                          <span>{role.permissions.length} permissions</span>
                          <span className="flex items-center gap-0.5">
                            <Users className="h-2.5 w-2.5" />
                            {role.userCount} users
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-3 w-3 text-[#e5e0d5]" />
                    </div>
                  </CardContent>
                </Card>
              ))}

              {filteredRoles.length === 0 && (
                <div className="rounded-lg border border-dashed border-[#e5e0d5] bg-[#fbf9f4] p-6 text-center">
                  <Shield className="mx-auto mb-2 h-6 w-6 text-[#e5e0d5]" />
                  <p className="text-xs text-[#8a8a8a]">No custom roles found</p>
                </div>
              )}
            </div>

            {/* Detail / Builder */}
            <div className="lg:col-span-2">
              {showBuilder ? (
                <RoleBuilder
                  onSave={handleSave}
                  onCancel={() => { setShowBuilder(false); setEditingRole(null); }}
                  editRole={editingRole}
                />
              ) : selectedRole ? (
                <Card className="border-[#e5e0d5] bg-white">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base font-semibold text-[#1a1a1a]">
                        <div
                          className="h-6 w-6 rounded-full"
                          style={{ backgroundColor: selectedRole.color }}
                        />
                        {selectedRole.name}
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          
                          className="h-6 border-[#e5e0d5] text-xs"
                          onClick={() => { setEditingRole(selectedRole); setShowBuilder(true); }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          
                          className="h-6 border-[#e5e0d5] text-xs"
                          onClick={() => handleDuplicate(selectedRole)}
                        >
                          <Copy className="mr-1 h-3 w-3" />
                          Duplicate
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex flex-wrap gap-1">
                      {selectedRole.permissions.map((p) => (
                        <Badge key={p} variant="secondary" className="text-[10px] bg-[#fbf9f4] text-[#595959]">
                          {p}
                        </Badge>
                      ))}
                    </div>
                    <div className="rounded-lg bg-[#fbf9f4] p-3 text-xs text-[#8a8a8a]">
                      <div className="flex items-center gap-2">
                        <Users className="h-3 w-3" />
                        {selectedRole.userCount} users assigned
                        {selectedRole.userCount === 0 && ' — can be deleted'}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-[#e5e0d5] bg-[#fbf9f4]">
                  <div className="text-center">
                    <Shield className="mx-auto mb-2 h-8 w-8 text-[#e5e0d5]" />
                    <p className="text-sm text-[#8a8a8a]">Select a role or create a new one</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="matrix" className="mt-4">
          <PermissionMatrix
            customRoles={roles}
            onTogglePermission={handleTogglePermission}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
