/**
 * Departments — Department management with color-coded cards,
 * member lists, ticket stats, and full CRUD.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Users,
  Ticket,
  Clock,
  ChevronDown,
  ChevronUp,
  Save,
  AlertTriangle,
  X,
  TrendingUp,
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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Department {
  id: number;
  name: string;
  description: string;
  head: string;
  color: string;
  members: string[];
  ticketCount: number;
  ticketsResolvedThisMonth: number;
  avgResolutionTime: number; // hours
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_DEPARTMENTS: Department[] = [
  {
    id: 1,
    name: 'IT Support',
    description: 'Technical support, troubleshooting, and infrastructure management',
    head: 'John Doe',
    color: '#c9a87c',
    members: ['John Doe', 'Sarah Chen', 'Mike Ross', 'Emily Wang', 'David Kim'],
    ticketCount: 142,
    ticketsResolvedThisMonth: 118,
    avgResolutionTime: 4.2,
  },
  {
    id: 2,
    name: 'Human Resources',
    description: 'Employee relations, benefits, recruitment, and onboarding',
    head: 'Sarah Chen',
    color: '#1890ff',
    members: ['Sarah Chen', 'Lisa Park', 'Tom Wilson'],
    ticketCount: 38,
    ticketsResolvedThisMonth: 32,
    avgResolutionTime: 8.5,
  },
  {
    id: 3,
    name: 'Facilities',
    description: 'Office maintenance, equipment, and workspace management',
    head: 'Mike Ross',
    color: '#52c41a',
    members: ['Mike Ross', 'James Lee', 'Anna Garcia'],
    ticketCount: 52,
    ticketsResolvedThisMonth: 45,
    avgResolutionTime: 12.3,
  },
  {
    id: 4,
    name: 'Finance',
    description: 'Budgeting, invoicing, procurement, and expense management',
    head: 'Emily Wang',
    color: '#faad14',
    members: ['Emily Wang', 'Robert Brown'],
    ticketCount: 24,
    ticketsResolvedThisMonth: 20,
    avgResolutionTime: 24.1,
  },
  {
    id: 5,
    name: 'Engineering',
    description: 'Software development, DevOps, and technical architecture',
    head: 'David Kim',
    color: '#722ed1',
    members: ['David Kim', 'Alex Johnson', 'Chris Martinez', 'Sophie Taylor'],
    ticketCount: 89,
    ticketsResolvedThisMonth: 76,
    avgResolutionTime: 6.8,
  },
  {
    id: 6,
    name: 'Sales',
    description: 'Customer acquisition, account management, and sales operations',
    head: 'Lisa Park',
    color: '#13c2c2',
    members: ['Lisa Park', 'Tom Wilson', 'Karen White'],
    ticketCount: 31,
    ticketsResolvedThisMonth: 28,
    avgResolutionTime: 15.2,
  },
];

const PRESET_COLORS = [
  '#c9a87c', '#1890ff', '#52c41a', '#faad14', '#722ed1',
  '#13c2c2', '#f5222d', '#eb2f96', '#ff7a45', '#8c8c8c',
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function Departments() {
  const [departments, setDepartments] = useState<Department[]>(INITIAL_DEPARTMENTS);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Department | null>(null);

  const [form, setForm] = useState<Partial<Department>>({
    name: '',
    description: '',
    head: '',
    color: '#c9a87c',
    members: [],
  });
  const [memberInput, setMemberInput] = useState('');

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', head: '', color: '#c9a87c', members: [] });
    setMemberInput('');
    setModalOpen(true);
  };

  const openEdit = (d: Department) => {
    setEditing(d);
    setForm({ ...d });
    setMemberInput('');
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.name || !form.head) return;
    if (editing) {
      setDepartments((prev) => prev.map((d) => (d.id === editing.id ? { ...d, ...form } as Department : d)));
    } else {
      const newDept: Department = {
        ...form as Department,
        id: Date.now(),
        ticketCount: 0,
        ticketsResolvedThisMonth: 0,
        avgResolutionTime: 0,
      };
      setDepartments((prev) => [...prev, newDept]);
    }
    setModalOpen(false);
  };

  const handleDelete = () => {
    if (deleteConfirm) {
      setDepartments((prev) => prev.filter((d) => d.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    }
  };

  const addMember = () => {
    if (memberInput.trim() && !(form.members || []).includes(memberInput.trim())) {
      setForm({ ...form, members: [...(form.members || []), memberInput.trim()] });
      setMemberInput('');
    }
  };

  const removeMember = (m: string) => {
    setForm({ ...form, members: (form.members || []).filter((x) => x !== m) });
  };

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <Building2 className="w-6 h-6" style={{ color: '#c9a87c' }} />
            Departments
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Manage departments, teams, and organizational structure
          </p>
        </div>
        <Button onClick={openCreate} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
          <Plus className="w-4 h-4 mr-1" /> Add Department
        </Button>
      </div>

      {/* Department Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <AnimatePresence>
          {departments.map((dept, idx) => (
            <motion.div
              key={dept.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: idx * 0.06 }}
            >
              <Card
                className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}
                onClick={() => setExpandedId(expandedId === dept.id ? null : dept.id)}
              >
                {/* Color strip */}
                <div className="h-1.5 w-full" style={{ background: dept.color }} />
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ background: dept.color + '15' }}
                      >
                        <Building2 className="w-5 h-5" style={{ color: dept.color }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm text-[#1f1f1f]">{dept.name}</h3>
                        <p className="text-xs" style={{ color: '#595959' }}>Head: {dept.head}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7"
                        onClick={(e) => { e.stopPropagation(); openEdit(dept); }}
                      >
                        <Pencil className="w-3.5 h-3.5" style={{ color: '#595959' }} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7"
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(dept); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" style={{ color: '#f5222d' }} />
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs mt-3 leading-relaxed" style={{ color: '#595959' }}>
                    {dept.description}
                  </p>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <div className="text-center p-2 rounded-lg" style={{ background: '#fbf9f4' }}>
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <Users className="w-3 h-3" style={{ color: dept.color }} />
                        <span className="text-lg font-bold text-[#1f1f1f]">{dept.members.length}</span>
                      </div>
                      <span className="text-[10px]" style={{ color: '#595959' }}>Members</span>
                    </div>
                    <div className="text-center p-2 rounded-lg" style={{ background: '#fbf9f4' }}>
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <Ticket className="w-3 h-3" style={{ color: '#1890ff' }} />
                        <span className="text-lg font-bold text-[#1f1f1f]">{dept.ticketCount}</span>
                      </div>
                      <span className="text-[10px]" style={{ color: '#595959' }}>Tickets</span>
                    </div>
                    <div className="text-center p-2 rounded-lg" style={{ background: '#fbf9f4' }}>
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <TrendingUp className="w-3 h-3" style={{ color: '#52c41a' }} />
                        <span className="text-lg font-bold text-[#1f1f1f]">{dept.ticketsResolvedThisMonth}</span>
                      </div>
                      <span className="text-[10px]" style={{ color: '#595959' }}>This Month</span>
                    </div>
                  </div>

                  {/* Avg Resolution */}
                  <div className="flex items-center justify-between mt-3 text-xs" style={{ color: '#595959' }}>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Avg resolution: <strong className="text-[#1f1f1f]">{dept.avgResolutionTime}h</strong></span>
                    {expandedId === dept.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>

                  {/* Expanded Members */}
                  <AnimatePresence>
                    {expandedId === dept.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: '1px solid #f5f0e8' }}>
                          <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#8c8c8c' }}>Team Members</span>
                          {dept.members.map((m) => (
                            <div key={m} className="flex items-center gap-2 py-1">
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium"
                                style={{ background: dept.color + '20', color: dept.color }}
                              >
                                {m.split(' ').map((n) => n[0]).join('')}
                              </div>
                              <span className="text-xs text-[#1f1f1f]">{m}</span>
                              {m === dept.head && (
                                <Badge className="text-[9px] ml-auto" style={{ background: dept.color + '20', color: dept.color, border: 'none' }}>
                                  Head
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={(v) => !v && setModalOpen(false)}>
        <DialogContent className="sm:max-w-lg" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
              <Building2 className="w-4 h-4" style={{ color: '#c9a87c' }} />
              {editing ? 'Edit Department' : 'New Department'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Department name" className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description..." rows={2} className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="space-y-2">
              <Label>Department Head</Label>
              <Input value={form.head || ''} onChange={(e) => setForm({ ...form, head: e.target.value })} placeholder="Head name" className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      background: c,
                      borderColor: form.color === c ? '#1f1f1f' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Members</Label>
              <div className="flex gap-2">
                <Input
                  value={memberInput}
                  onChange={(e) => setMemberInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addMember())}
                  placeholder="Add member name"
                  className="rounded-lg border-[#e5e0d5]"
                />
                <Button onClick={addMember} variant="outline" className="rounded-lg border-[#e5e0d5]">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {(form.members || []).map((m) => (
                  <Badge key={m} variant="outline" className="gap-1 rounded-md" style={{ borderColor: '#e5e0d5' }}>
                    {m}
                    <button onClick={() => removeMember(m)}><X className="w-3 h-3" /></button>
                  </Badge>
                ))}
              </div>
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
              Delete Department
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm" style={{ color: '#595959' }}>
            Delete <strong className="text-[#1f1f1f]">{deleteConfirm?.name}</strong>? This will not delete associated tickets.
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
