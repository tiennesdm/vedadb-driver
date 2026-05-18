import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { useIsAdmin } from '@/hooks/useRBAC';
import {
  FileText, Plus, Search, Pencil, Trash2, Copy,
  AlertTriangle, Monitor, Shield
} from 'lucide-react';

interface TicketTemplate {
  id: number;
  name: string;
  description: string;
  default_title: string;
  default_description: string;
  default_priority: string;
  default_category: string;
  default_type: string;
  custom_fields: string;
  is_active: number;
  created_at: string;
}

const BUILTIN_TEMPLATES: Omit<TicketTemplate, 'id' | 'created_at'>[] = [
  { name: 'Password Reset', description: 'Request for password reset', default_title: 'Password Reset Request', default_description: 'User needs password reset for account.', default_priority: 'medium', default_category: 'Access', default_type: 'service_request', custom_fields: '{"system": "text", "urgency_reason": "textarea"}', is_active: 1 },
  { name: 'New Laptop', description: 'Request new laptop/device', default_title: 'New Laptop Request', default_description: 'Employee needs a new laptop for work.', default_priority: 'medium', default_category: 'Hardware', default_type: 'service_request', custom_fields: '{"device_type": "select:Laptop,Desktop,Tablet", "justification": "textarea"}', is_active: 1 },
  { name: 'VPN Access', description: 'Request VPN access', default_title: 'VPN Access Request', default_description: 'Request VPN access for remote work.', default_priority: 'medium', default_category: 'Network', default_type: 'service_request', custom_fields: '{"duration": "select:Temporary,Permanent", "access_level": "select:Full,Limited"}', is_active: 1 },
  { name: 'Software Install', description: 'Request software installation', default_title: 'Software Installation Request', default_description: 'Need software installed on workstation.', default_priority: 'low', default_category: 'Software', default_type: 'service_request', custom_fields: '{"software_name": "text", "license_required": "checkbox"}', is_active: 1 },
  { name: 'Network Issue', description: 'Report network connectivity problem', default_title: 'Network Connectivity Issue', default_description: 'Experiencing network connectivity issues.', default_priority: 'high', default_category: 'Network', default_type: 'incident', custom_fields: '{"affected_systems": "textarea", "error_message": "text"}', is_active: 1 },
];

const TYPE_ICON: Record<string, typeof FileText> = {
  incident: AlertTriangle,
  service_request: FileText,
  problem: Monitor,
  change: Shield,
};

const TYPE_COLOR: Record<string, string> = {
  incident: 'bg-red-50 text-red-700 border-red-200',
  service_request: 'bg-blue-50 text-blue-700 border-blue-200',
  problem: 'bg-orange-50 text-orange-700 border-orange-200',
  change: 'bg-purple-50 text-purple-700 border-purple-200',
};

export default function TicketTemplates() {
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TicketTemplate | null>(null);
  const isAdmin = useIsAdmin();

  const [form, setForm] = useState({
    name: '', description: '', default_title: '', default_description: '',
    default_priority: 'medium', default_category: 'General', default_type: 'incident',
    custom_fields: '',
  });

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await vedaQuery("SELECT * FROM ticket_templates ORDER BY name");
      let data = toObjects(res) as unknown as TicketTemplate[];
      if (data.length === 0) {
        // Seed built-in templates
        for (const t of BUILTIN_TEMPLATES) {
          await vedaExec(`INSERT INTO ticket_templates (name, description, default_title, default_description, default_priority, default_category, default_type, custom_fields, is_active) VALUES ('${t.name}', '${t.description}', '${t.default_title}', '${t.default_description}', '${t.default_priority}', '${t.default_category}', '${t.default_type}', '${t.custom_fields}', 1)`);
        }
        const res2 = await vedaQuery("SELECT * FROM ticket_templates ORDER BY name");
        data = toObjects(res2) as unknown as TicketTemplate[];
      }
      setTemplates(data);
    } catch {
      setTemplates([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description.toLowerCase().includes(search.toLowerCase()) ||
    t.default_category.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', default_title: '', default_description: '', default_priority: 'medium', default_category: 'General', default_type: 'incident', custom_fields: '' });
    setModalOpen(true);
  };

  const openEdit = (t: TicketTemplate) => {
    setEditing(t);
    setForm({
      name: t.name, description: t.description, default_title: t.default_title,
      default_description: t.default_description, default_priority: t.default_priority,
      default_category: t.default_category, default_type: t.default_type,
      custom_fields: t.custom_fields || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      if (editing) {
        await vedaExec(`UPDATE ticket_templates SET name='${form.name.replace(/'/g, "''")}', description='${form.description.replace(/'/g, "''")}', default_title='${form.default_title.replace(/'/g, "''")}', default_description='${form.default_description.replace(/'/g, "''")}', default_priority='${form.default_priority}', default_category='${form.default_category}', default_type='${form.default_type}', custom_fields='${form.custom_fields.replace(/'/g, "''")}' WHERE id=${editing.id}`);
      } else {
        await vedaExec(`INSERT INTO ticket_templates (name, description, default_title, default_description, default_priority, default_category, default_type, custom_fields, is_active) VALUES ('${form.name.replace(/'/g, "''")}', '${form.description.replace(/'/g, "''")}', '${form.default_title.replace(/'/g, "''")}', '${form.default_description.replace(/'/g, "''")}', '${form.default_priority}', '${form.default_category}', '${form.default_type}', '${form.custom_fields.replace(/'/g, "''")}', 1)`);
      }
      setModalOpen(false);
      await fetchTemplates();
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this template?')) return;
    await vedaExec(`DELETE FROM ticket_templates WHERE id=${id}`);
    await fetchTemplates();
  };

  const handleUse = (t: TicketTemplate) => {
    alert(`Template "${t.name}" ready to use. Navigate to Tickets → Create to apply.`);
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f1f1f] tracking-tight">Ticket Templates</h1>
          <p className="text-sm text-[#595959] mt-1">Pre-defined templates for common ticket types</p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white gap-2">
            <Plus size={16} /> New Template
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" size={18} />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates..." className="pl-10 bg-white border-[#e5e0d5]" />
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="text-center py-20 text-[#8a8a8a]">Loading templates...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center border-[#e5e0d5]">
          <FileText className="mx-auto mb-3 text-[#8a8a8a]" size={40} />
          <p className="text-[#595959]">No templates found</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => {
            const TypeIcon = TYPE_ICON[t.default_type] || FileText;
            return (
              <Card key={t.id} className="p-5 border-[#e5e0d5] hover:border-[#c9a87c] transition-colors">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-[#f5f0e8] flex items-center justify-center flex-shrink-0">
                    <TypeIcon size={20} className="text-[#c9a87c]" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-[#1f1f1f] text-sm truncate">{t.name}</h3>
                    <p className="text-xs text-[#595959] truncate">{t.description}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  <Badge variant="outline" className={TYPE_COLOR[t.default_type] || 'bg-gray-50 text-gray-700'}>{t.default_type.replace('_', ' ')}</Badge>
                  <Badge variant="outline" className="text-[#595959]">{t.default_priority}</Badge>
                  <Badge variant="outline" className="text-[#595959]">{t.default_category}</Badge>
                </div>
                <div className="text-xs text-[#8a8a8a] mb-3 bg-[#fbf9f4] p-2 rounded">
                  <span className="font-medium">Title:</span> {t.default_title}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 text-xs border-[#e5e0d5]" onClick={() => handleUse(t)}>
                    <Copy size={12} className="mr-1" /> Use
                  </Button>
                  {isAdmin && (
                    <>
                      <Button variant="outline" size="sm" className="border-[#e5e0d5]" onClick={() => openEdit(t)}><Pencil size={12} /></Button>
                      <Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => handleDelete(t.id)}><Trash2 size={12} /></Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{editing ? 'Edit Template' : 'New Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Name</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Template name" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Description</label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description" className="mt-1" rows={2} />
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Default Title</label>
              <Input value={form.default_title} onChange={e => setForm({ ...form, default_title: e.target.value })} placeholder="Default ticket title" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Default Description</label>
              <Textarea value={form.default_description} onChange={e => setForm({ ...form, default_description: e.target.value })} placeholder="Default description" className="mt-1" rows={3} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Priority</label>
                <Select value={form.default_priority} onValueChange={v => setForm({ ...form, default_priority: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Category</label>
                <Input value={form.default_category} onChange={e => setForm({ ...form, default_category: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Type</label>
                <Select value={form.default_type} onValueChange={v => setForm({ ...form, default_type: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="incident">Incident</SelectItem>
                    <SelectItem value="service_request">Service Request</SelectItem>
                    <SelectItem value="problem">Problem</SelectItem>
                    <SelectItem value="change">Change</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Custom Fields (JSON)</label>
              <Textarea value={form.custom_fields} onChange={e => setForm({ ...form, custom_fields: e.target.value })} placeholder='{"field_name": "text|select:opt1,opt2|textarea|checkbox|date"}' className="mt-1 font-mono text-xs" rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)} className="border-[#e5e0d5]">Cancel</Button>
              <Button onClick={handleSave} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white">{editing ? 'Update' : 'Create'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
