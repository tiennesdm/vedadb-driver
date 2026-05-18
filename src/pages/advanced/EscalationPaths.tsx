import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { useIsAdmin } from '@/hooks/useRBAC';
import { ArrowUp, Clock, Plus, Trash2, TrendingUp, AlertCircle } from 'lucide-react';

interface EscalationRule {
  id: number;
  name: string;
  from_status: string;
  hours_threshold: number;
  to_status: string;
  notify_role: string;
  is_active: number;
  created_at: string;
}

const STATUS_OPTIONS = ['open', 'in_progress', 'pending', 'resolved', 'closed', 'rejected'];
const ROLE_OPTIONS = ['agent', 'manager', 'admin', 'super_admin'];

export default function EscalationPaths() {
  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const isAdmin = useIsAdmin();

  const [form, setForm] = useState({
    name: '', from_status: 'open', hours_threshold: 24, to_status: 'in_progress',
    notify_role: 'manager', is_active: true,
  });

  const fetchRules = useCallback(async () => {
    try {
      const res = await vedaQuery(`SELECT * FROM escalation_rules ORDER BY created_at DESC`);
      setRules(toObjects(res) as unknown as EscalationRule[]);
    } catch { setRules([]); }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleSave = async () => {
    try {
      await vedaExec(`INSERT INTO escalation_rules (name, from_status, hours_threshold, to_status, notify_role, is_active, created_at) VALUES ('${form.name.replace(/'/g, "''")}', '${form.from_status}', ${form.hours_threshold}, '${form.to_status}', '${form.notify_role}', ${form.is_active ? 1 : 0}, datetime('now'))`);
      setModalOpen(false);
      setForm({ name: '', from_status: 'open', hours_threshold: 24, to_status: 'in_progress', notify_role: 'manager', is_active: true });
      await fetchRules();
    } catch (err: any) { alert('Error: ' + err.message); }
  };

  const handleToggle = async (id: number, current: number) => {
    await vedaExec(`UPDATE escalation_rules SET is_active = ${current ? 0 : 1} WHERE id=${id}`);
    await fetchRules();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this rule?')) return;
    await vedaExec(`DELETE FROM escalation_rules WHERE id=${id}`);
    await fetchRules();
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f1f1f] tracking-tight">Escalation Paths</h1>
          <p className="text-sm text-[#595959] mt-1">Auto-escalate tickets based on time and status</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setModalOpen(true)} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white gap-2">
            <Plus size={16} /> New Rule
          </Button>
        )}
      </div>

      {/* Visual Escalation Chain */}
      <Card className="p-6 mb-6 border-[#e5e0d5] bg-gradient-to-r from-[#fbf9f4] to-white">
        <h3 className="text-sm font-semibold text-[#1f1f1f] mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-[#c9a87c]" /> Default Escalation Chain
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {['L1 Agent', 'L2 Senior', 'L3 Lead', 'Manager', 'Director'].map((level, i) => (
            <div key={level} className="flex items-center gap-2">
              <div className={`px-4 py-2 rounded-lg text-sm font-medium ${i === 0 ? 'bg-green-50 text-green-700 border border-green-200' : i === 4 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-[#f5f0e8] text-[#1f1f1f] border border-[#e5e0d5]'}`}>
                {level}
              </div>
              {i < 4 && <ArrowUp size={14} className="text-[#8a8a8a]" />}
            </div>
          ))}
        </div>
      </Card>

      {/* Rules List */}
      {rules.length === 0 ? (
        <Card className="p-12 text-center border-[#e5e0d5]">
          <AlertCircle className="mx-auto mb-3 text-[#8a8a8a]" size={40} />
          <p className="text-[#595959]">No escalation rules configured</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map(r => (
            <Card key={r.id} className="p-4 border-[#e5e0d5]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#f5f0e8] flex items-center justify-center">
                    <Clock size={16} className="text-[#c9a87c]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#1f1f1f]">{r.name}</h3>
                    <p className="text-xs text-[#595959]">
                      If <Badge variant="outline" className="text-xs">{r.from_status}</Badge> for{' '}
                      <span className="font-medium text-[#c9a87c]">{r.hours_threshold}h</span> → escalate to{' '}
                      <Badge variant="outline" className="text-xs">{r.to_status}</Badge> → notify{' '}
                      <Badge variant="outline" className="text-xs">{r.notify_role}</Badge>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={r.is_active === 1} onCheckedChange={() => handleToggle(r.id, r.is_active)} />
                    <span className={`text-xs ${r.is_active ? 'text-green-600' : 'text-[#8a8a8a]'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  {isAdmin && (
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(r.id)}><Trash2 size={14} /></Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Escalation Rule</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Rule Name</label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g., Escalate old open tickets" className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-[#595959] uppercase tracking-wider">If Status</label><Select value={form.from_status} onValueChange={v => setForm({ ...form, from_status: v })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
              <div><label className="text-xs font-medium text-[#595959] uppercase tracking-wider">For Hours</label><Input type="number" value={form.hours_threshold} onChange={e => setForm({ ...form, hours_threshold: Number(e.target.value) })} className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Escalate To</label><Select value={form.to_status} onValueChange={v => setForm({ ...form, to_status: v })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
              <div><label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Notify Role</label><Select value={form.notify_role} onValueChange={v => setForm({ ...form, notify_role: v })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{ROLE_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)} className="border-[#e5e0d5]">Cancel</Button>
              <Button onClick={handleSave} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white">Create Rule</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
