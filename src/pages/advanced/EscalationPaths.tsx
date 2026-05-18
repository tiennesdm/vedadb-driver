/**
 * EscalationPaths — Define escalation: if status=X for Y hours → escalate to Z
 * Visual chain: L1 → L2 → L3 → Manager → Director
 */
import { useState, useEffect, useCallback } from 'react';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { usePermission } from '@/hooks/useRBAC';
import { Permission } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  AlertTriangle,
  ArrowRight,
  Clock,
  TrendingUp,
  History,
  Zap,
} from 'lucide-react';
import EscalationChain from '@/components/advanced/EscalationChain';
import type { EscalationLevel } from '@/components/advanced/EscalationChain';
import { formatDistanceToNow } from 'date-fns';

export type { EscalationLevel };

interface EscalationRule {
  id: number;
  name: string;
  from_status: string;
  to_status: string;
  hours_threshold: number;
  escalate_to_role: string;
  notify_assignee: number;
  notify_manager: number;
  is_active: number;
  order_index: number;
  created_at: string;
}

interface EscalationHistory {
  id: number;
  rule_id: number;
  ticket_id: number;
  triggered_at: string;
  from_level: string;
  to_level: string;
  ticket_title?: string;
}

const STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed', 'rejected'];
const ROLES = ['L1', 'L2', 'L3', 'MANAGER', 'DIRECTOR'];

export default function EscalationPaths() {
  const canManage = usePermission(Permission.AUTOMATION_MANAGE);
  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [history, setHistory] = useState<EscalationHistory[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EscalationRule | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [form, setForm] = useState<Partial<EscalationRule>>({
    name: '',
    from_status: 'open',
    to_status: 'in_progress',
    hours_threshold: 24,
    escalate_to_role: 'L2',
    notify_assignee: 1,
    notify_manager: 1,
    is_active: 1,
    order_index: 0,
  });

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await vedaQuery(`SELECT * FROM escalation_rules ORDER BY order_index ASC, created_at ASC`);
      setRules(toObjects(res) as unknown as EscalationRule[]);
    } catch {
      setRules([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const sql = `
        SELECT eh.*, t.title as ticket_title
        FROM escalation_history eh
        LEFT JOIN tickets t ON t.id = eh.ticket_id
        ORDER BY eh.triggered_at DESC
        LIMIT 50
      `;
      const res = await vedaQuery(sql);
      setHistory(toObjects(res) as unknown as EscalationHistory[]);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchHistory();
  }, [fetchRules, fetchHistory]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      from_status: 'open',
      to_status: 'in_progress',
      hours_threshold: 24,
      escalate_to_role: 'L2',
      notify_assignee: 1,
      notify_manager: 1,
      is_active: 1,
      order_index: rules.length,
    });
    setModalOpen(true);
  };

  const openEdit = (r: EscalationRule) => {
    setEditing(r);
    setForm({ ...r });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) return;
    try {
      if (editing) {
        await vedaExec(
          `UPDATE escalation_rules SET name='${form.name}', from_status='${form.from_status}', to_status='${form.to_status}', hours_threshold=${form.hours_threshold}, escalate_to_role='${form.escalate_to_role}', notify_assignee=${form.notify_assignee}, notify_manager=${form.notify_manager}, is_active=${form.is_active}, order_index=${form.order_index} WHERE id=${editing.id}`
        );
      } else {
        await vedaExec(
          `INSERT INTO escalation_rules (name, from_status, to_status, hours_threshold, escalate_to_role, notify_assignee, notify_manager, is_active, order_index, created_at) VALUES ('${form.name}', '${form.from_status}', '${form.to_status}', ${form.hours_threshold}, '${form.escalate_to_role}', ${form.notify_assignee}, ${form.notify_manager}, ${form.is_active}, ${form.order_index ?? rules.length}, datetime('now'))`
        );
      }
      setModalOpen(false);
      fetchRules();
    } catch {
      // silent
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await vedaExec(`DELETE FROM escalation_rules WHERE id=${id}`);
      fetchRules();
    } catch {
      // silent
    }
  };

  const toggleActive = async (r: EscalationRule) => {
    try {
      const newVal = r.is_active ? 0 : 1;
      await vedaExec(`UPDATE escalation_rules SET is_active=${newVal} WHERE id=${r.id}`);
      fetchRules();
    } catch {
      // silent
    }
  };

  // Build chain steps for visualization
  const chainSteps = rules
    .filter((r) => r.is_active)
    .sort((a, b) => a.order_index - b.order_index)
    .map((r) => ({
      level: r.escalate_to_role as EscalationLevel,
      name: r.name,
      hours: r.hours_threshold,
      assigned: true,
    }));

  // Ensure we have at minimum the standard levels
  const standardLevels: EscalationLevel[] = ['L1', 'L2', 'L3', 'MANAGER', 'DIRECTOR'];
  const filledSteps = standardLevels.map((level) => {
    const existing = chainSteps.find((s) => s.level === level);
    return existing ?? { level, name: undefined, hours: 24, assigned: false };
  });

  return (
    <div className="space-y-4 p-6 bg-[#fbf9f4] min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#262626]">Escalation Paths</h1>
          <p className="text-xs text-[#8a8a8a] mt-0.5">Define rules for automatic ticket escalation</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="bg-[#c9a87c] hover:bg-[#b8996a] text-white text-xs h-8">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Rule
          </Button>
        )}
      </div>

      {/* Visual chain */}
      <div className="rounded-lg border border-[#e5e0d5] bg-white p-4">
        <h3 className="text-sm font-medium text-[#262626] mb-3 flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-[#c9a87c]" />
          Escalation Chain
        </h3>
        <EscalationChain steps={filledSteps} currentLevel="L1" />
        <p className="text-[11px] text-[#8a8a8a] mt-3">
          Tickets escalate automatically based on status duration. Configure rules below.
        </p>
      </div>

      {/* Rules table */}
      <div className="rounded-lg border border-[#e5e0d5] bg-white overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#e5e0d5] border-t-[#c9a87c]" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fbf9f4] hover:bg-[#fbf9f4]">
                <TableHead className="text-xs font-medium text-[#595959]">Rule</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Trigger</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Escalate To</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Time</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Active</TableHead>
                <TableHead className="text-xs font-medium text-[#595959] w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} className={cn('hover:bg-[#fbf9f4]', !r.is_active && 'opacity-60')}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5 text-[#c9a87c]" />
                      <div>
                        <p className="text-sm font-medium text-[#262626]">{r.name}</p>
                        <p className="text-[10px] text-[#8a8a8a]">Order: {r.order_index}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-[#262626]">
                      <span className="capitalize px-1.5 py-0.5 rounded bg-[#f5f3ef]">{r.from_status}</span>
                      <ArrowRight className="h-3 w-3 inline mx-1 text-[#8a8a8a]" />
                      <span className="capitalize px-1.5 py-0.5 rounded bg-[#f5f3ef]">{r.to_status}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-semibold text-[#c9a87c]">{r.escalate_to_role}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-xs text-[#595959]">
                      <Clock className="h-3 w-3 text-[#8a8a8a]" />
                      {r.hours_threshold}h
                    </div>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggleActive(r)}
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full',
                        r.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'
                      )}
                    >
                      {r.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-[#8a8a8a] hover:text-[#262626]"
                          onClick={() => openEdit(r)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-[#8a8a8a] hover:text-red-500"
                          onClick={() => handleDelete(r.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-sm text-[#8a8a8a]">
                    No escalation rules defined
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <Accordion type="single" collapsible className="rounded-lg border border-[#e5e0d5] bg-white">
          <AccordionItem value="history" className="border-0">
            <AccordionTrigger className="px-4 py-3 text-sm font-medium text-[#262626] hover:no-underline">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-[#c9a87c]" />
                Escalation History ({history.length})
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="max-h-60 overflow-y-auto space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 p-2 rounded-md bg-[#fbf9f4] text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#c9a87c] shrink-0" />
                    <span className="text-[#c9a87c] font-mono">#{h.ticket_id}</span>
                    <span className="text-[#262626] truncate flex-1">{h.ticket_title}</span>
                    <ArrowRight className="h-3 w-3 text-[#8a8a8a]" />
                    <span className="text-[#8a8a8a]">{h.from_level} → {h.to_level}</span>
                    <span className="text-[#8a8a8a] ml-auto">
                      {formatDistanceToNow(new Date(h.triggered_at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-[#262626]">
              {editing ? 'Edit Escalation Rule' : 'New Escalation Rule'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-[#595959]">Rule Name</Label>
              <Input
                value={form.name ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. L1 to L2 Escalation"
                className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-[#595959]">From Status</Label>
                <Select
                  value={form.from_status ?? 'open'}
                  onValueChange={(v) => setForm((p) => ({ ...p, from_status: v }))}
                >
                  <SelectTrigger className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-[#595959]">To Status</Label>
                <Select
                  value={form.to_status ?? 'in_progress'}
                  onValueChange={(v) => setForm((p) => ({ ...p, to_status: v }))}
                >
                  <SelectTrigger className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-[#595959]">Hours Threshold</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.hours_threshold ?? 24}
                  onChange={(e) => setForm((p) => ({ ...p, hours_threshold: parseInt(e.target.value) || 24 }))}
                  className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
                />
              </div>
              <div>
                <Label className="text-xs text-[#595959]">Escalate To Role</Label>
                <Select
                  value={form.escalate_to_role ?? 'L2'}
                  onValueChange={(v) => setForm((p) => ({ ...p, escalate_to_role: v }))}
                >
                  <SelectTrigger className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Order Index</Label>
              <Input
                type="number"
                min={0}
                value={form.order_index ?? 0}
                onChange={(e) => setForm((p) => ({ ...p, order_index: parseInt(e.target.value) || 0 }))}
                className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs text-[#595959] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.notify_assignee}
                  onChange={(e) => setForm((p) => ({ ...p, notify_assignee: e.target.checked ? 1 : 0 }))}
                  className="accent-[#c9a87c]"
                />
                Notify Assignee
              </label>
              <label className="flex items-center gap-2 text-xs text-[#595959] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.notify_manager}
                  onChange={(e) => setForm((p) => ({ ...p, notify_manager: e.target.checked ? 1 : 0 }))}
                  className="accent-[#c9a87c]"
                />
                Notify Manager
              </label>
              <label className="flex items-center gap-2 text-xs text-[#595959] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.is_active}
                  onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked ? 1 : 0 }))}
                  className="accent-[#c9a87c]"
                />
                Active
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)} className="border-[#e5e0d5]">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!form.name?.trim()}
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
