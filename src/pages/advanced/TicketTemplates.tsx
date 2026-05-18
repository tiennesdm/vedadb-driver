/**
 * TicketTemplates — Manage ticket templates (CRUD)
 * Pre-built: Password Reset, New Laptop, VPN Access, Software Install, Network Issue
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { usePermission } from '@/hooks/useRBAC';
import { Permission } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  FileText,
  X,
  Save,
  Copy,
  LayoutTemplate,
} from 'lucide-react';
/* formatDistanceToNow available if needed */

export interface TicketTemplate {
  id: number;
  name: string;
  description: string;
  default_title: string;
  default_description: string;
  default_priority: 'low' | 'medium' | 'high' | 'critical';
  default_category: string;
  custom_fields_json: string;
  is_prebuilt: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const PRIORITIES: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical'];
const CATEGORIES = ['General', 'Hardware', 'Software', 'Network', 'Access', 'Security', 'Other'];

const PREBUILT_TEMPLATES: Omit<TicketTemplate, 'id' | 'created_at' | 'updated_at'>[] = [
  {
    name: 'Password Reset',
    description: 'Request a password reset for user account',
    default_title: 'Password Reset Request',
    default_description: 'User requires password reset for their account.\n\nUsername: \nApplication: \nUrgency: ',
    default_priority: 'medium',
    default_category: 'Access',
    custom_fields_json: JSON.stringify([
      { name: 'username', label: 'Username', type: 'text', required: true },
      { name: 'application', label: 'Application/System', type: 'text', required: true },
    ]),
    is_prebuilt: 1,
    is_active: 1,
  },
  {
    name: 'New Laptop',
    description: 'Request a new laptop for employee',
    default_title: 'New Laptop Request',
    default_description: 'Employee requires a new laptop.\n\nEmployee Name: \nDepartment: \nJustification: \nPreferred Model: ',
    default_priority: 'medium',
    default_category: 'Hardware',
    custom_fields_json: JSON.stringify([
      { name: 'employee_name', label: 'Employee Name', type: 'text', required: true },
      { name: 'department', label: 'Department', type: 'text', required: true },
      { name: 'preferred_model', label: 'Preferred Model', type: 'text', required: false },
    ]),
    is_prebuilt: 1,
    is_active: 1,
  },
  {
    name: 'VPN Access',
    description: 'Request VPN access for remote work',
    default_title: 'VPN Access Request',
    default_description: 'Employee needs VPN access.\n\nEmployee Name: \nEmail: \nDuration: \nReason: ',
    default_priority: 'high',
    default_category: 'Access',
    custom_fields_json: JSON.stringify([
      { name: 'employee_email', label: 'Employee Email', type: 'text', required: true },
      { name: 'duration', label: 'Access Duration', type: 'select', options: ['1 week', '1 month', 'Permanent'], required: true },
    ]),
    is_prebuilt: 1,
    is_active: 1,
  },
  {
    name: 'Software Install',
    description: 'Request software installation',
    default_title: 'Software Installation Request',
    default_description: 'Request to install software on workstation.\n\nSoftware Name: \nVersion: \nLicense Key: \nBusiness Justification: ',
    default_priority: 'low',
    default_category: 'Software',
    custom_fields_json: JSON.stringify([
      { name: 'software_name', label: 'Software Name', type: 'text', required: true },
      { name: 'version', label: 'Version', type: 'text', required: false },
      { name: 'license_key', label: 'License Key', type: 'text', required: false },
    ]),
    is_prebuilt: 1,
    is_active: 1,
  },
  {
    name: 'Network Issue',
    description: 'Report a network connectivity problem',
    default_title: 'Network Issue Report',
    default_description: 'Experiencing network connectivity issues.\n\nLocation: \nDevice(s) Affected: \nIssue Description: \nStarted At: ',
    default_priority: 'high',
    default_category: 'Network',
    custom_fields_json: JSON.stringify([
      { name: 'location', label: 'Location', type: 'text', required: true },
      { name: 'device_count', label: 'Devices Affected', type: 'number', required: true },
    ]),
    is_prebuilt: 1,
    is_active: 1,
  },
];

const BLANK_TEMPLATE: Omit<TicketTemplate, 'id' | 'created_at' | 'updated_at'> = {
  name: '',
  description: '',
  default_title: '',
  default_description: '',
  default_priority: 'medium',
  default_category: 'General',
  custom_fields_json: '[]',
  is_prebuilt: 0,
  is_active: 1,
};

export default function TicketTemplates() {
  const navigate = useNavigate();
  const canManage = usePermission(Permission.TICKET_EDIT_ALL);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TicketTemplate | null>(null);
  const [form, setForm] = useState(BLANK_TEMPLATE);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const sql = `SELECT * FROM ticket_templates ORDER BY is_prebuilt DESC, name ASC`;
      const res = await vedaQuery(sql);
      const rows = toObjects(res) as unknown as TicketTemplate[];
      if (rows.length === 0) {
        // Seed pre-built templates
        for (const t of PREBUILT_TEMPLATES) {
          await vedaExec(
            `INSERT INTO ticket_templates (name, description, default_title, default_description, default_priority, default_category, custom_fields_json, is_prebuilt, is_active, created_at, updated_at) VALUES ('${t.name}', '${t.description}', '${t.default_title}', '${t.default_description}', '${t.default_priority}', '${t.default_category}', '${t.custom_fields_json}', ${t.is_prebuilt}, ${t.is_active}, datetime('now'), datetime('now'))`
          );
        }
        const res2 = await vedaQuery(sql);
        setTemplates(toObjects(res2) as unknown as TicketTemplate[]);
      } else {
        setTemplates(rows);
      }
    } catch {
      setTemplates([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filtered = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.default_category.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...BLANK_TEMPLATE });
    setModalOpen(true);
  };

  const openEdit = (t: TicketTemplate) => {
    setEditing(t);
    setForm({ ...t });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      if (editing) {
        await vedaExec(
          `UPDATE ticket_templates SET name='${form.name}', description='${form.description}', default_title='${form.default_title}', default_description='${form.default_description}', default_priority='${form.default_priority}', default_category='${form.default_category}', custom_fields_json='${form.custom_fields_json}', is_active=${form.is_active}, updated_at=datetime('now') WHERE id=${editing.id}`
        );
      } else {
        await vedaExec(
          `INSERT INTO ticket_templates (name, description, default_title, default_description, default_priority, default_category, custom_fields_json, is_prebuilt, is_active, created_at, updated_at) VALUES ('${form.name}', '${form.description}', '${form.default_title}', '${form.default_description}', '${form.default_priority}', '${form.default_category}', '${form.custom_fields_json}', 0, ${form.is_active}, datetime('now'), datetime('now'))`
        );
      }
      setModalOpen(false);
      fetchTemplates();
    } catch {
      // silent
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await vedaExec(`DELETE FROM ticket_templates WHERE id=${id} AND is_prebuilt=0`);
      fetchTemplates();
    } catch {
      // silent
    }
  };

  const handleDuplicate = async (t: TicketTemplate) => {
    try {
      await vedaExec(
        `INSERT INTO ticket_templates (name, description, default_title, default_description, default_priority, default_category, custom_fields_json, is_prebuilt, is_active, created_at, updated_at) VALUES ('${t.name} (Copy)', '${t.description}', '${t.default_title}', '${t.default_description}', '${t.default_priority}', '${t.default_category}', '${t.custom_fields_json}', 0, 1, datetime('now'), datetime('now'))`
      );
      fetchTemplates();
    } catch {
      // silent
    }
  };

  const useTemplate = (t: TicketTemplate) => {
    const params = new URLSearchParams({
      template: t.id.toString(),
      title: t.default_title,
      description: t.default_description,
      priority: t.default_priority,
      category: t.default_category,
    });
    navigate(`/tickets?${params.toString()}`);
  };

  return (
    <div className="space-y-4 p-6 bg-[#fbf9f4] min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#262626]">Ticket Templates</h1>
          <p className="text-xs text-[#8a8a8a] mt-0.5">Pre-built and custom templates for quick ticket creation</p>
        </div>
        {canManage && (
          <Button
            onClick={openCreate}
            className="bg-[#c9a87c] hover:bg-[#b8996a] text-white text-xs h-8"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Template
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8a8a]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="pl-8 text-sm h-8 border-[#e5e0d5] bg-white focus:border-[#c9a87c] focus:ring-[#c9a87c]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <X className="h-3 w-3 text-[#8a8a8a]" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[#e5e0d5] bg-white overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#e5e0d5] border-t-[#c9a87c]" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fbf9f4] hover:bg-[#fbf9f4]">
                <TableHead className="text-xs font-medium text-[#595959]">Template</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Category</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Priority</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Type</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Status</TableHead>
                <TableHead className="text-xs font-medium text-[#595959] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id} className="hover:bg-[#fbf9f4]">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <LayoutTemplate className="h-3.5 w-3.5 text-[#c9a87c]" />
                      <div>
                        <p className="text-sm font-medium text-[#262626]">{t.name}</p>
                        <p className="text-[11px] text-[#8a8a8a] truncate max-w-[200px]">{t.description}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f3ef] text-[#595959]">
                      {t.default_category}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full capitalize',
                      t.default_priority === 'critical' && 'bg-red-50 text-red-600',
                      t.default_priority === 'high' && 'bg-orange-50 text-orange-600',
                      t.default_priority === 'medium' && 'bg-blue-50 text-blue-600',
                      t.default_priority === 'low' && 'bg-gray-50 text-gray-600',
                    )}>
                      {t.default_priority}
                    </span>
                  </TableCell>
                  <TableCell>
                    {t.is_prebuilt ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#c9a87c]/10 text-[#c9a87c]">Pre-built</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f3ef] text-[#595959]">Custom</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'text-xs',
                      t.is_active ? 'text-green-600' : 'text-[#8a8a8a]'
                    )}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-[#c9a87c] hover:text-[#b8996a] hover:bg-[#f5f3ef]"
                        onClick={() => useTemplate(t)}
                      >
                        <FileText className="h-3 w-3 mr-0.5" />
                        Use
                      </Button>
                      {canManage && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-[#8a8a8a] hover:text-[#262626]"
                            onClick={() => openEdit(t)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-[#8a8a8a] hover:text-[#c9a87c]"
                            onClick={() => handleDuplicate(t)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          {!t.is_prebuilt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-[#8a8a8a] hover:text-red-500"
                              onClick={() => handleDelete(t.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-sm text-[#8a8a8a]">
                    No templates found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg bg-white border-[#e5e0d5] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#262626]">
              {editing ? 'Edit Template' : 'New Template'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-[#595959]">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Template name"
                className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Brief description"
                className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Default Title</Label>
              <Input
                value={form.default_title}
                onChange={(e) => setForm((p) => ({ ...p, default_title: e.target.value }))}
                placeholder="Default ticket title"
                className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Default Description</Label>
              <Textarea
                value={form.default_description}
                onChange={(e) => setForm((p) => ({ ...p, default_description: e.target.value }))}
                placeholder="Default ticket description"
                className="mt-1 text-sm min-h-[80px] border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-[#595959]">Priority</Label>
                <Select
                  value={form.default_priority}
                  onValueChange={(v: 'low' | 'medium' | 'high' | 'critical') =>
                    setForm((p) => ({ ...p, default_priority: v }))
                  }
                >
                  <SelectTrigger className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-[#595959]">Category</Label>
                <Select
                  value={form.default_category}
                  onValueChange={(v) => setForm((p) => ({ ...p, default_category: v }))}
                >
                  <SelectTrigger className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={!!form.is_active}
                onCheckedChange={(v) => setForm((p) => ({ ...p, is_active: v ? 1 : 0 }))}
              />
              <Label className="text-xs text-[#595959]">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)} className="border-[#e5e0d5]">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!form.name.trim()}
              className="bg-[#c9a87c] hover:bg-[#b8996a] text-white"
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
