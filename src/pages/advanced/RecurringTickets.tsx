import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { useIsAdmin } from '@/hooks/useRBAC';
import { RotateCcw, Plus, Calendar, Trash2, CheckCircle } from 'lucide-react';

interface RecurringTicket {
  id: number;
  name: string;
  description: string;
  frequency: string;
  template_id: number;
  assigned_to: number;
  department_id: number;
  is_active: number;
  last_run: string;
  next_run: string;
  created_at: string;
  template_name?: string;
  assignee_name?: string;
}

const FREQUENCY_LABELS: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const BUILTIN_RECURRING = [
  { name: 'Weekly Backup Check', description: 'Verify all system backups completed successfully', frequency: 'weekly', template_id: 0 },
  { name: 'Monthly Patch Review', description: 'Review and approve pending security patches', frequency: 'monthly', template_id: 0 },
  { name: 'Daily SLA Review', description: 'Check tickets approaching SLA breach', frequency: 'daily', template_id: 0 },
];

export default function RecurringTickets() {
  const [recurring, setRecurring] = useState<RecurringTicket[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const isAdmin = useIsAdmin();

  const [form, setForm] = useState({
    name: '', description: '', frequency: 'weekly', template_id: '',
    assigned_to: '', department_id: '', is_active: true,
  });

  const fetchRecurring = useCallback(async () => {
    try {
      const res = await vedaQuery(`SELECT r.*, t.name as template_name, u.name as assignee_name FROM recurring_tickets r LEFT JOIN ticket_templates t ON r.template_id = t.id LEFT JOIN users u ON r.assigned_to = u.id ORDER BY r.created_at DESC`);
      let data = toObjects(res) as unknown as RecurringTicket[];
      if (data.length === 0) {
        for (const b of BUILTIN_RECURRING) {
          await vedaExec(`INSERT INTO recurring_tickets (name, description, frequency, template_id, assigned_to, department_id, is_active, next_run, created_at) VALUES ('${b.name}', '${b.description}', '${b.frequency}', 0, 0, 1, 1, datetime('now', '+1 day'), datetime('now'))`);
        }
        const res2 = await vedaQuery(`SELECT r.*, t.name as template_name, u.name as assignee_name FROM recurring_tickets r LEFT JOIN ticket_templates t ON r.template_id = t.id LEFT JOIN users u ON r.assigned_to = u.id ORDER BY r.created_at DESC`);
        data = toObjects(res2) as unknown as RecurringTicket[];
      }
      setRecurring(data);
    } catch { setRecurring([]); }
  }, []);

  useEffect(() => { fetchRecurring(); }, [fetchRecurring]);

  const handleSave = async () => {
    try {
      await vedaExec(`INSERT INTO recurring_tickets (name, description, frequency, template_id, assigned_to, department_id, is_active, next_run, created_at) VALUES ('${form.name.replace(/'/g, "''")}', '${form.description.replace(/'/g, "''")}', '${form.frequency}', ${form.template_id || 0}, ${form.assigned_to || 0}, ${form.department_id || 1}, ${form.is_active ? 1 : 0}, datetime('now', '+1 day'), datetime('now'))`);
      setModalOpen(false);
      setForm({ name: '', description: '', frequency: 'weekly', template_id: '', assigned_to: '', department_id: '', is_active: true });
      await fetchRecurring();
    } catch (err: any) { alert('Error: ' + err.message); }
  };

  const handleToggle = async (id: number, current: number) => {
    await vedaExec(`UPDATE recurring_tickets SET is_active = ${current ? 0 : 1} WHERE id=${id}`);
    await fetchRecurring();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this recurring ticket?')) return;
    await vedaExec(`DELETE FROM recurring_tickets WHERE id=${id}`);
    await fetchRecurring();
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f1f1f] tracking-tight">Recurring Tickets</h1>
          <p className="text-sm text-[#595959] mt-1">Automatically create tickets on a schedule</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setModalOpen(true)} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white gap-2">
            <Plus size={16} /> New Recurring
          </Button>
        )}
      </div>

      {recurring.length === 0 ? (
        <Card className="p-12 text-center border-[#e5e0d5]">
          <RotateCcw className="mx-auto mb-3 text-[#8a8a8a]" size={40} />
          <p className="text-[#595959]">No recurring tickets configured</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recurring.map(r => (
            <Card key={r.id} className="p-4 border-[#e5e0d5]">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#f5f0e8] flex items-center justify-center">
                    <RotateCcw size={18} className="text-[#c9a87c]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#1f1f1f]">{r.name}</h3>
                    <p className="text-xs text-[#595959]">{r.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.is_active === 1} onCheckedChange={() => handleToggle(r.id, r.is_active)} />
                  {isAdmin && <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDelete(r.id)}><Trash2 size={14} /></Button>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge variant="outline" className="text-[#c9a87c] capitalize">{FREQUENCY_LABELS[r.frequency] || r.frequency}</Badge>
                <Badge variant="outline" className="text-[#595959]">{r.is_active ? 'Active' : 'Paused'}</Badge>
                {r.assignee_name && <Badge variant="outline" className="text-[#595959]">{r.assignee_name}</Badge>}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-[#8a8a8a]">
                {r.last_run && <span className="flex items-center gap-1"><CheckCircle size={10} /> Last: {r.last_run}</span>}
                {r.next_run && <span className="flex items-center gap-1"><Calendar size={10} /> Next: {r.next_run}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Recurring Ticket</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Name</label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g., Weekly Backup Check" className="mt-1" /></div>
            <div><label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Description</label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1" rows={2} /></div>
            <div><label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Frequency</label>
              <Select value={form.frequency} onValueChange={v => setForm({ ...form, frequency: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)} className="border-[#e5e0d5]">Cancel</Button>
              <Button onClick={handleSave} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white">Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
