/**
 * Announcements — Manage system announcements with active banner,
 * CRUD operations, role targeting, and scheduling.
 */
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Megaphone,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Save,
  Eye,
  Calendar,
  CheckCircle,
  Info,
  Wrench,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Announcement {
  id: number;
  title: string;
  content: string;
  type: 'info' | 'warning' | 'maintenance';
  targetRoles: string[];
  targetDepartments: string[];
  active: boolean;
  publishDate: string;
  expiryDate: string;
  createdBy: string;
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 1,
    title: 'Scheduled Maintenance Window',
    content: 'The VedaDesk portal will be under maintenance on December 8, 2024 from 02:00 to 06:00 UTC. During this time, ticket creation and updates may be unavailable. Please plan accordingly.',
    type: 'maintenance',
    targetRoles: ['admin', 'agent', 'user'],
    targetDepartments: ['All'],
    active: true,
    publishDate: '2024-12-03T08:00:00Z',
    expiryDate: '2024-12-08T08:00:00Z',
    createdBy: 'Emily Wang',
  },
  {
    id: 2,
    title: 'New SLA Policies Effective Jan 1',
    content: 'Updated SLA policies will take effect starting January 1, 2025. Critical priority response time is now 15 minutes. Please review the updated documentation.',
    type: 'info',
    targetRoles: ['admin', 'agent'],
    targetDepartments: ['IT Support', 'Engineering'],
    active: true,
    publishDate: '2024-12-01T08:00:00Z',
    expiryDate: '2025-01-15T08:00:00Z',
    createdBy: 'John Doe',
  },
  {
    id: 3,
    title: 'Password Reset Required',
    content: 'All users are required to reset their passwords by December 15, 2024 as part of our quarterly security policy. Please visit your profile settings to update your password.',
    type: 'warning',
    targetRoles: ['admin', 'agent', 'user'],
    targetDepartments: ['All'],
    active: false,
    publishDate: '2024-12-02T08:00:00Z',
    expiryDate: '2024-12-15T08:00:00Z',
    createdBy: 'Sarah Chen',
  },
  {
    id: 4,
    title: 'Knowledge Base Update',
    content: 'We have added 25 new articles to the knowledge base covering common VPN, email, and hardware issues. Check them out to find quick solutions.',
    type: 'info',
    targetRoles: ['agent', 'user'],
    targetDepartments: ['All'],
    active: true,
    publishDate: '2024-11-28T08:00:00Z',
    expiryDate: '2024-12-31T08:00:00Z',
    createdBy: 'Mike Ross',
  },
];

const ALL_ROLES = ['admin', 'agent', 'user'];
const ALL_DEPARTMENTS = ['IT Support', 'Engineering', 'HR', 'Facilities', 'Finance', 'Sales', 'All'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
  info: { icon: <Info className="w-4 h-4" />, color: '#1890ff', bg: '#e6f7ff', border: '#91d5ff' },
  warning: { icon: <AlertCircle className="w-4 h-4" />, color: '#faad14', bg: '#fffbe6', border: '#ffe58f' },
  maintenance: { icon: <Wrench className="w-4 h-4" />, color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7' },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function Announcements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>(INITIAL_ANNOUNCEMENTS);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Announcement | null>(null);

  const [form, setForm] = useState<Partial<Announcement>>({
    title: '',
    content: '',
    type: 'info',
    targetRoles: ['user'],
    targetDepartments: ['All'],
    active: true,
    publishDate: '',
    expiryDate: '',
  });

  const activeAnnouncements = announcements.filter((a) => a.active);

  const openCreate = () => {
    setEditing(null);
    setForm({
      title: '',
      content: '',
      type: 'info',
      targetRoles: ['user'],
      targetDepartments: ['All'],
      active: true,
      publishDate: new Date().toISOString().split('T')[0] + 'T08:00:00Z',
      expiryDate: '',
    });
    setModalOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setForm({ ...a });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.title || !form.content) return;
    if (editing) {
      setAnnouncements((prev) => prev.map((a) => (a.id === editing.id ? { ...a, ...form } as Announcement : a)));
    } else {
      const newItem: Announcement = {
        ...form as Announcement,
        id: Date.now(),
        createdBy: 'Current User',
      };
      setAnnouncements((prev) => [newItem, ...prev]);
    }
    setModalOpen(false);
  };

  const handleToggleActive = useCallback((id: number) => {
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === id ? { ...a, active: !a.active } : a))
    );
  }, []);

  const handleDelete = () => {
    if (deleteConfirm) {
      setAnnouncements((prev) => prev.filter((a) => a.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    }
  };

  const toggleRole = (role: string) => {
    const current = form.targetRoles || [];
    setForm({
      ...form,
      targetRoles: current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    });
  };

  const toggleDept = (dept: string) => {
    const current = form.targetDepartments || [];
    setForm({
      ...form,
      targetDepartments: current.includes(dept) ? current.filter((d) => d !== dept) : [...current, dept],
    });
  };

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <Megaphone className="w-6 h-6" style={{ color: '#c9a87c' }} />
            Announcements
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Manage system-wide announcements and notices
          </p>
        </div>
        <Button onClick={openCreate} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
          <Plus className="w-4 h-4 mr-1" /> New Announcement
        </Button>
      </div>

      {/* Active Banner */}
      <AnimatePresence>
        {activeAnnouncements.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-3 mb-6"
          >
            {activeAnnouncements.slice(0, 2).map((a) => {
              const cfg = TYPE_CONFIG[a.type];
              return (
                <motion.div
                  key={a.id}
                  layout
                  className="flex items-start gap-3 p-4 rounded-xl"
                  style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
                >
                  <div style={{ color: cfg.color }} className="mt-0.5 flex-shrink-0">{cfg.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" style={{ color: cfg.color }}>{a.title}</span>
                      <Badge style={{ background: cfg.color + '20', color: cfg.color, border: 'none' }} className="text-[10px] capitalize">
                        {a.type}
                      </Badge>
                      <Badge style={{ background: '#52c41a20', color: '#52c41a', border: 'none' }} className="text-[10px]">
                        <CheckCircle className="w-2.5 h-2.5 mr-0.5" /> Active
                      </Badge>
                    </div>
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: '#1f1f1f' }}>
                      {a.content}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: '#595959' }}>
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDate(a.publishDate)} – {formatDate(a.expiryDate)}</span>
                      <span>By {a.createdBy}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Announcement List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnimatePresence>
          {announcements.map((a, idx) => {
            const cfg = TYPE_CONFIG[a.type];
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card
                  className="h-full hover:shadow-md transition-shadow"
                  style={{
                    background: '#ffffff',
                    borderRadius: 12,
                    border: a.active ? `1px solid ${cfg.border}` : '1px solid #e5e0d5',
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ color: cfg.color }}>{cfg.icon}</span>
                        <h3 className="font-semibold text-sm text-[#1f1f1f]">{a.title}</h3>
                        <Badge style={{ background: cfg.color + '20', color: cfg.color, border: 'none' }} className="text-[10px] capitalize">
                          {a.type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => openEdit(a)}>
                          <Pencil className="w-3.5 h-3.5" style={{ color: '#595959' }} />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => setDeleteConfirm(a)}>
                          <Trash2 className="w-3.5 h-3.5" style={{ color: '#f5222d' }} />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs mt-2 line-clamp-2 leading-relaxed" style={{ color: '#595959' }}>
                      {a.content}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Badge variant="outline" className="text-[10px]" style={{ borderColor: '#e5e0d5', color: '#595959' }}>
                        <Eye className="w-2.5 h-2.5 mr-1" />
                        {a.targetRoles.join(', ')}
                      </Badge>
                      {a.targetDepartments.slice(0, 2).map((d) => (
                        <Badge key={d} variant="outline" className="text-[10px]" style={{ borderColor: '#e5e0d5', color: '#595959' }}>
                          {d}
                        </Badge>
                      ))}
                      {a.targetDepartments.length > 2 && (
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: '#e5e0d5', color: '#595959' }}>
                          +{a.targetDepartments.length - 2}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid #f5f0e8' }}>
                      <div className="flex items-center gap-2 text-[10px]" style={{ color: '#8c8c8c' }}>
                        <Calendar className="w-3 h-3" />
                        {formatDate(a.publishDate)} – {formatDate(a.expiryDate)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px]" style={{ color: a.active ? '#52c41a' : '#8c8c8c' }}>
                          {a.active ? 'Active' : 'Inactive'}
                        </span>
                        <Switch
                          checked={a.active}
                          onCheckedChange={() => handleToggleActive(a.id)}
                          className="scale-75"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={(v) => !v && setModalOpen(false)}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
              <Megaphone className="w-4 h-4" style={{ color: '#c9a87c' }} />
              {editing ? 'Edit Announcement' : 'Create Announcement'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Announcement title" className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea value={form.content || ''} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Announcement content..." rows={4} className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as 'info' | 'warning' | 'maintenance' })}>
                <SelectTrigger className="rounded-lg border-[#e5e0d5]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info"><span className="flex items-center gap-2"><Info className="w-3.5 h-3.5" style={{ color: '#1890ff' }} /> Info</span></SelectItem>
                  <SelectItem value="warning"><span className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" style={{ color: '#faad14' }} /> Warning</span></SelectItem>
                  <SelectItem value="maintenance"><span className="flex items-center gap-2"><Wrench className="w-3.5 h-3.5" style={{ color: '#722ed1' }} /> Maintenance</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Roles</Label>
              <div className="flex flex-wrap gap-3">
                {ALL_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={(form.targetRoles || []).includes(role)} onCheckedChange={() => toggleRole(role)} />
                    <span className="capitalize text-[#1f1f1f]">{role}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Target Departments</Label>
              <div className="flex flex-wrap gap-3">
                {ALL_DEPARTMENTS.map((dept) => (
                  <label key={dept} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={(form.targetDepartments || []).includes(dept)} onCheckedChange={() => toggleDept(dept)} />
                    <span className="text-[#1f1f1f]">{dept}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Publish Date</Label>
                <Input type="datetime-local" value={(form.publishDate || '').replace('Z', '')} onChange={(e) => setForm({ ...form, publishDate: e.target.value + 'Z' })} className="rounded-lg border-[#e5e0d5]" />
              </div>
              <div className="space-y-2">
                <Label>Expiry Date</Label>
                <Input type="datetime-local" value={(form.expiryDate || '').replace('Z', '')} onChange={(e) => setForm({ ...form, expiryDate: e.target.value + 'Z' })} className="rounded-lg border-[#e5e0d5]" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} className="rounded-lg border-[#e5e0d5]">Cancel</Button>
            <Button onClick={handleSave} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
              <Save className="w-4 h-4 mr-1" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
              <AlertTriangle className="w-5 h-5 text-[#f5222d]" />
              Delete Announcement
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm" style={{ color: '#595959' }}>
            Are you sure you want to delete <strong className="text-[#1f1f1f]">{deleteConfirm?.title}</strong>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="rounded-lg border-[#e5e0d5]">Cancel</Button>
            <Button onClick={handleDelete} className="rounded-lg" style={{ background: '#f5222d', color: '#fff' }}>
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
