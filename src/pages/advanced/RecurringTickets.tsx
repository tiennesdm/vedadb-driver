/**
 * RecurringTickets — Schedule recurring: daily, weekly, monthly
 * Templates: Weekly Backup Check, Monthly Patch Review
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
  Play,
  Pause,
  Calendar,
  RotateCw,
  History,
  FileText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

interface RecurringTicket {
  id: number;
  name: string;
  description: string;
  frequency: RecurringFrequency;
  day_of_week?: number;
  day_of_month?: number;
  hour_of_day: number;
  template_id?: number;
  default_title: string;
  default_description: string;
  default_priority: string;
  default_category: string;
  assigned_to?: number;
  is_active: number;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
}

interface RecurringHistory {
  id: number;
  recurring_id: number;
  ticket_id: number;
  created_ticket_title?: string;
  created_at: string;
}

const FREQUENCIES: { value: RecurringFrequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const CATEGORIES = ['General', 'Hardware', 'Software', 'Network', 'Access', 'Security', 'Maintenance', 'Other'];

const PREBUILT_RECURRING: Omit<RecurringTicket, 'id' | 'last_run_at' | 'next_run_at' | 'created_at'>[] = [
  {
    name: 'Weekly Backup Check',
    description: 'Verify all system backups completed successfully',
    frequency: 'weekly',
    day_of_week: 1,
    hour_of_day: 9,
    default_title: 'Weekly Backup Verification',
    default_description: 'Verify all system backups from the past week.\n\nSystems to check:\n- Database backups\n- File server backups\n- Application backups\n\nNotes:',
    default_priority: 'high',
    default_category: 'Maintenance',
    is_active: 1,
  },
  {
    name: 'Monthly Patch Review',
    description: 'Review and apply pending security patches',
    frequency: 'monthly',
    day_of_month: 1,
    hour_of_day: 10,
    default_title: 'Monthly Security Patch Review',
    default_description: 'Review all pending security patches and updates.\n\nSystems:\n- Windows servers\n- Linux servers\n- Network equipment\n- Applications\n\nAction items:',
    default_priority: 'critical',
    default_category: 'Security',
    is_active: 1,
  },
];

export default function RecurringTickets() {
  const canManage = usePermission(Permission.AUTOMATION_MANAGE);
  const [items, setItems] = useState<RecurringTicket[]>([]);
  const [history, setHistory] = useState<RecurringHistory[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTicket | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [form, setForm] = useState<Partial<RecurringTicket>>({
    name: '',
    description: '',
    frequency: 'weekly',
    day_of_week: 1,
    day_of_month: 1,
    hour_of_day: 9,
    default_title: '',
    default_description: '',
    default_priority: 'medium',
    default_category: 'General',
    is_active: 1,
  });

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await vedaQuery(`SELECT * FROM recurring_tickets ORDER BY created_at DESC`);
      const rows = toObjects(res) as unknown as RecurringTicket[];
      if (rows.length === 0) {
        // Seed pre-built recurring tickets
        for (const t of PREBUILT_RECURRING) {
          await vedaExec(
            `INSERT INTO recurring_tickets (name, description, frequency, day_of_week, day_of_month, hour_of_day, default_title, default_description, default_priority, default_category, is_active, created_at) VALUES ('${t.name}', '${t.description}', '${t.frequency}', ${t.day_of_week ?? 'NULL'}, ${t.day_of_month ?? 'NULL'}, ${t.hour_of_day}, '${t.default_title}', '${t.default_description}', '${t.default_priority}', '${t.default_category}', ${t.is_active}, datetime('now'))`
          );
        }
        const res2 = await vedaQuery(`SELECT * FROM recurring_tickets ORDER BY created_at DESC`);
        setItems(toObjects(res2) as unknown as RecurringTicket[]);
      } else {
        setItems(rows);
      }
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const sql = `
        SELECT rh.*, t.title as created_ticket_title
        FROM recurring_history rh
        LEFT JOIN tickets t ON t.id = rh.ticket_id
        ORDER BY rh.created_at DESC
        LIMIT 50
      `;
      const res = await vedaQuery(sql);
      setHistory(toObjects(res) as unknown as RecurringHistory[]);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    fetchHistory();
  }, [fetchItems, fetchHistory]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      description: '',
      frequency: 'weekly',
      day_of_week: 1,
      day_of_month: 1,
      hour_of_day: 9,
      default_title: '',
      default_description: '',
      default_priority: 'medium',
      default_category: 'General',
      is_active: 1,
    });
    setModalOpen(true);
  };

  const openEdit = (r: RecurringTicket) => {
    setEditing(r);
    setForm({ ...r });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) return;
    try {
      if (editing) {
        await vedaExec(
          `UPDATE recurring_tickets SET name='${form.name}', description='${form.description}', frequency='${form.frequency}', day_of_week=${form.day_of_week ?? 'NULL'}, day_of_month=${form.day_of_month ?? 'NULL'}, hour_of_day=${form.hour_of_day}, default_title='${form.default_title}', default_description='${form.default_description}', default_priority='${form.default_priority}', default_category='${form.default_category}', is_active=${form.is_active} WHERE id=${editing.id}`
        );
      } else {
        await vedaExec(
          `INSERT INTO recurring_tickets (name, description, frequency, day_of_week, day_of_month, hour_of_day, default_title, default_description, default_priority, default_category, is_active, created_at) VALUES ('${form.name}', '${form.description}', '${form.frequency}', ${form.day_of_week ?? 'NULL'}, ${form.day_of_month ?? 'NULL'}, ${form.hour_of_day}, '${form.default_title}', '${form.default_description}', '${form.default_priority}', '${form.default_category}', ${form.is_active}, datetime('now'))`
        );
      }
      setModalOpen(false);
      fetchItems();
    } catch {
      // silent
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await vedaExec(`DELETE FROM recurring_tickets WHERE id=${id}`);
      fetchItems();
    } catch {
      // silent
    }
  };

  const toggleActive = async (r: RecurringTicket) => {
    try {
      const newVal = r.is_active ? 0 : 1;
      await vedaExec(`UPDATE recurring_tickets SET is_active=${newVal} WHERE id=${r.id}`);
      fetchItems();
    } catch {
      // silent
    }
  };

  const getFrequencyLabel = (r: RecurringTicket) => {
    const f = FREQUENCIES.find((x) => x.value === r.frequency);
    let detail = '';
    if (r.frequency === 'weekly' && r.day_of_week !== undefined && r.day_of_week !== null) {
      detail = ` on ${DAYS_OF_WEEK[r.day_of_week]}`;
    }
    if ((r.frequency === 'monthly' || r.frequency === 'quarterly') && r.day_of_month) {
      detail = ` on day ${r.day_of_month}`;
    }
    return `${f?.label ?? r.frequency}${detail} at ${String(r.hour_of_day).padStart(2, '0')}:00`;
  };

  return (
    <div className="space-y-4 p-6 bg-[#fbf9f4] min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#262626]">Recurring Tickets</h1>
          <p className="text-xs text-[#8a8a8a] mt-0.5">Schedule tickets to be created automatically</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="bg-[#c9a87c] hover:bg-[#b8996a] text-white text-xs h-8">
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Schedule
          </Button>
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
                <TableHead className="text-xs font-medium text-[#595959]">Schedule</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Frequency</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Priority</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Last Run</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Status</TableHead>
                <TableHead className="text-xs font-medium text-[#595959] w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id} className={cn('hover:bg-[#fbf9f4]', !r.is_active && 'opacity-60')}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <RotateCw className="h-3.5 w-3.5 text-[#c9a87c]" />
                      <div>
                        <p className="text-sm font-medium text-[#262626]">{r.name}</p>
                        <p className="text-[10px] text-[#8a8a8a] truncate max-w-[180px]">{r.description}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-xs text-[#595959]">
                      <Calendar className="h-3 w-3 text-[#8a8a8a]" />
                      {getFrequencyLabel(r)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full capitalize',
                      r.default_priority === 'critical' && 'bg-red-50 text-red-600',
                      r.default_priority === 'high' && 'bg-orange-50 text-orange-600',
                      r.default_priority === 'medium' && 'bg-blue-50 text-blue-600',
                      r.default_priority === 'low' && 'bg-gray-50 text-gray-600',
                    )}>
                      {r.default_priority}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.last_run_at ? (
                      <span className="text-xs text-[#595959]">
                        {formatDistanceToNow(new Date(r.last_run_at), { addSuffix: true })}
                      </span>
                    ) : (
                      <span className="text-xs text-[#8a8a8a]">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggleActive(r)}
                      className={cn(
                        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
                        r.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'
                      )}
                    >
                      {r.is_active ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
                      {r.is_active ? 'Active' : 'Paused'}
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
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-sm text-[#8a8a8a]">
                    No recurring tickets scheduled
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
                Creation History ({history.length})
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="max-h-60 overflow-y-auto space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 p-2 rounded-md bg-[#fbf9f4] text-xs">
                    <FileText className="h-3.5 w-3.5 text-[#c9a87c] shrink-0" />
                    <span className="text-[#c9a87c] font-mono">#{h.ticket_id}</span>
                    <span className="text-[#262626] truncate flex-1">{h.created_ticket_title}</span>
                    <span className="text-[#8a8a8a]">
                      {formatDistanceToNow(new Date(h.created_at), { addSuffix: true })}
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
        <DialogContent className="sm:max-w-lg bg-white border-[#e5e0d5] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#262626]">
              {editing ? 'Edit Recurring Ticket' : 'New Recurring Ticket'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-[#595959]">Name</Label>
              <Input
                value={form.name ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Weekly Backup Check"
                className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Description</Label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Brief description of the recurring task"
                className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Default Title</Label>
              <Input
                value={form.default_title ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, default_title: e.target.value }))}
                placeholder="Title for generated tickets"
                className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Default Description</Label>
              <textarea
                value={form.default_description ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, default_description: e.target.value }))}
                placeholder="Description for generated tickets"
                className="mt-1 w-full text-sm border border-[#e5e0d5] rounded-md bg-[#fbf9f4] p-2 focus:border-[#c9a87c] focus:ring-1 focus:ring-[#c9a87c] outline-none min-h-[80px]"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-[#595959]">Frequency</Label>
                <Select
                  value={form.frequency ?? 'weekly'}
                  onValueChange={(v: RecurringFrequency) => setForm((p) => ({ ...p, frequency: v }))}
                >
                  <SelectTrigger className="mt-1 text-xs border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-[#595959]">
                  {form.frequency === 'weekly' ? 'Day' : form.frequency === 'daily' ? '—' : 'Day of Month'}
                </Label>
                {form.frequency === 'weekly' ? (
                  <Select
                    value={String(form.day_of_week ?? 1)}
                    onValueChange={(v) => setForm((p) => ({ ...p, day_of_week: parseInt(v) }))}
                  >
                    <SelectTrigger className="mt-1 text-xs border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map((d, i) => (
                        <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : form.frequency !== 'daily' ? (
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={form.day_of_month ?? 1}
                    onChange={(e) => setForm((p) => ({ ...p, day_of_month: parseInt(e.target.value) || 1 }))}
                    className="mt-1 text-xs border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c]"
                  />
                ) : (
                  <div className="mt-1 h-[29px] flex items-center text-xs text-[#8a8a8a]">Every day</div>
                )}
              </div>
              <div>
                <Label className="text-xs text-[#595959]">Hour (0-23)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.hour_of_day ?? 9}
                  onChange={(e) => setForm((p) => ({ ...p, hour_of_day: parseInt(e.target.value) || 0 }))}
                  className="mt-1 text-xs border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c]"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-[#595959]">Priority</Label>
                <Select
                  value={form.default_priority ?? 'medium'}
                  onValueChange={(v) => setForm((p) => ({ ...p, default_priority: v }))}
                >
                  <SelectTrigger className="mt-1 text-xs border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
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
                  value={form.default_category ?? 'General'}
                  onValueChange={(v) => setForm((p) => ({ ...p, default_category: v }))}
                >
                  <SelectTrigger className="mt-1 text-xs border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
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
              <input
                type="checkbox"
                checked={!!form.is_active}
                onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked ? 1 : 0 }))}
                className="accent-[#c9a87c]"
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
