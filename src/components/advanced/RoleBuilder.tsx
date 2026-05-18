/**
 * RoleBuilder - Form to create/edit custom roles
 */
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Permission } from '@/lib/rbac';
import { Save, X, Palette, Shield } from 'lucide-react';
import type { CustomRoleDef } from './PermissionMatrix';
import { PERMISSION_CATEGORIES } from './PermissionMatrix';

interface RoleBuilderProps {
  onSave: (role: Omit<CustomRoleDef, 'id' | 'userCount'>) => void;
  onCancel?: () => void;
  editRole?: CustomRoleDef | null;
}

const PRESET_COLORS = [
  '#c9a87c', '#722ed1', '#f5222d', '#faad14', '#1890ff',
  '#52c41a', '#13c2c2', '#eb2f96', '#fa8c16', '#2f54eb',
  '#a0d911', '#595959',
];

export default function RoleBuilder({ onSave, onCancel, editRole }: RoleBuilderProps) {
  const [name, setName] = useState(editRole?.name || '');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(editRole?.color || '#c9a87c');
  const [selectedPerms, setSelectedPerms] = useState<Set<Permission>>(
    new Set(editRole?.permissions || [])
  );
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(['Tickets']));

  const togglePerm = useCallback((perm: Permission) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }, []);

  const toggleCat = useCallback((catLabel: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catLabel)) next.delete(catLabel);
      else next.add(catLabel);
      return next;
    });
  }, []);

  const selectAllInCat = useCallback((perms: Permission[]) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      let allSelected = true;
      for (const p of perms) if (!next.has(p)) { allSelected = false; break; }
      for (const p of perms) {
        if (allSelected) next.delete(p); else next.add(p);
      }
      return next;
    });
  }, []);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      color,
      permissions: Array.from(selectedPerms),
    });
    if (!editRole) {
      setName('');
      setDescription('');
      setColor('#c9a87c');
      setSelectedPerms(new Set());
    }
  };

  const permCount = selectedPerms.size;
  const totalPerms = Object.values(Permission).length;

  return (
    <Card className="border-[#e5e0d5] bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-[#1a1a1a]">
          <Shield className="h-4 w-4 text-[#c9a87c]" />
          {editRole ? 'Edit Role' : 'Create Custom Role'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Name */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-[#595959]">Role Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Senior Agent"
            className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-[#595959]">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe this role's responsibilities..."
            rows={2}
            className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
          />
        </div>

        {/* Color */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 text-xs font-medium text-[#595959]">
            <Palette className="h-3 w-3" />
            Role Color
          </Label>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition-all',
                  color === c ? 'border-[#1a1a1a] scale-110' : 'border-transparent hover:scale-105'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Permission count */}
        <div className="flex items-center justify-between rounded-lg bg-[#fbf9f4] px-3 py-2">
          <span className="text-xs text-[#595959]">Permissions selected</span>
          <Badge variant="secondary" className="bg-[#c9a87c]/10 text-[#c9a87c]">
            {permCount} / {totalPerms}
          </Badge>
        </div>

        {/* Permission categories */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-[#595959]">Permissions</Label>
          {PERMISSION_CATEGORIES.map((cat) => {
            const expanded = expandedCats.has(cat.label);
            const catSelected = cat.perms.filter((p) => selectedPerms.has(p)).length;
            return (
              <div key={cat.label} className="rounded-lg border border-[#e5e0d5] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleCat(cat.label)}
                  className="flex w-full items-center justify-between bg-[#fbf9f4] px-3 py-2 text-left hover:bg-[#f5f3ee]"
                >
                  <span className="text-xs font-medium text-[#1a1a1a]">{cat.label}</span>
                  <div className="flex items-center gap-2">
                    {catSelected > 0 && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px] bg-[#c9a87c]/10 text-[#c9a87c]">
                        {catSelected}
                      </Badge>
                    )}
                    <span className="text-xs text-[#8a8a8a]">{expanded ? '−' : '+'}</span>
                  </div>
                </button>
                {expanded && (
                  <div className="p-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => selectAllInCat(cat.perms)}
                      className="mb-1 text-[10px] text-[#c9a87c] hover:underline"
                    >
                      Toggle All
                    </button>
                    {cat.perms.map((perm) => (
                      <label
                        key={perm}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[#fbf9f4]"
                      >
                        <Switch
                          checked={selectedPerms.has(perm)}
                          onCheckedChange={() => togglePerm(perm)}
                          className="data-[state=checked]:bg-[#c9a87c]"
                          
                        />
                        <span className="text-xs text-[#595959]">{perm}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button variant="outline"  onClick={onCancel} className="border-[#e5e0d5]">
              <X className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          )}
          <Button
            
            onClick={handleSave}
            disabled={!name.trim()}
            className="bg-[#c9a87c] text-white hover:bg-[#b8996c]"
          >
            <Save className="mr-1 h-3 w-3" />
            {editRole ? 'Update Role' : 'Create Role'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
