/**
 * Time Tracking — Track time spent on tickets with a timer widget,
 * manual entries, summary cards, and weekly timesheet view.
 */
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Timer,
  Play,
  Square,
  Plus,
  Clock,
  Calendar,
  Coffee,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Save,
  Trash2,
  Edit3,
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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TimeEntry {
  id: number;
  date: string;
  ticketId: string;
  ticketTitle: string;
  description: string;
  duration: number; // minutes
  billable: boolean;
  user: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTimer(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getWeekDates(offset: number) {
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay();
  const diff = start.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  start.setDate(diff);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_ENTRIES: TimeEntry[] = [
  { id: 1, date: '2024-12-04', ticketId: 'T-1042', ticketTitle: 'Server downtime in production', description: 'Investigated root cause and applied hotfix', duration: 180, billable: true, user: 'John Doe' },
  { id: 2, date: '2024-12-04', ticketId: 'T-1045', ticketTitle: 'Email sync issues on mobile', description: 'Configured IMAP settings and tested', duration: 45, billable: true, user: 'John Doe' },
  { id: 3, date: '2024-12-04', ticketId: 'T-1038', ticketTitle: 'WiFi intermittent disconnections', description: 'Site survey and access point adjustment', duration: 120, billable: false, user: 'John Doe' },
  { id: 4, date: '2024-12-03', ticketId: 'T-1035', ticketTitle: 'VPN access for remote team', description: 'Created VPN profiles and sent credentials', duration: 60, billable: true, user: 'John Doe' },
  { id: 5, date: '2024-12-03', ticketId: 'T-1031', ticketTitle: 'Database backup failure', description: 'Resolved storage issue and re-ran backup', duration: 90, billable: true, user: 'John Doe' },
  { id: 6, date: '2024-12-02', ticketId: 'T-1028', ticketTitle: 'Printer jam in Floor 3', description: 'Cleaned rollers and replaced toner', duration: 30, billable: false, user: 'John Doe' },
  { id: 7, date: '2024-12-02', ticketId: 'T-1025', ticketTitle: 'New hire laptop request', description: 'Imaged laptop and installed standard apps', duration: 150, billable: true, user: 'John Doe' },
  { id: 8, date: '2024-12-02', ticketId: 'T-1022', ticketTitle: 'Software license renewal', description: 'Processed renewal and updated records', duration: 20, billable: true, user: 'John Doe' },
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function TimeTracking() {
  const [entries, setEntries] = useState<TimeEntry[]>(INITIAL_ENTRIES);
  const [view, setView] = useState<'entries' | 'timesheet'>('entries');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  // Timer state
  const [isRunning, setIsRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [activeTicket, setActiveTicket] = useState('');

  const [form, setForm] = useState<Partial<TimeEntry>>({
    date: new Date().toISOString().split('T')[0],
    ticketId: '',
    ticketTitle: '',
    description: '',
    duration: 0,
    billable: true,
    user: 'John Doe',
  });

  // Timer effect
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const today = new Date().toISOString().split('T')[0];

  const summary = useMemo(() => {
    const todayEntries = entries.filter((e) => e.date === today);
    const weekEntries = entries.filter((e) => {
      const d = new Date(e.date);
      const weekStart = getWeekDates(weekOffset)[0];
      const weekEnd = getWeekDates(weekOffset)[6];
      return d >= weekStart && d <= weekEnd;
    });
    return {
      todayTotal: todayEntries.reduce((s, e) => s + e.duration, 0),
      todayBillable: todayEntries.filter((e) => e.billable).reduce((s, e) => s + e.duration, 0),
      weekTotal: weekEntries.reduce((s, e) => s + e.duration, 0),
      weekBillable: weekEntries.filter((e) => e.billable).reduce((s, e) => s + e.duration, 0),
    };
  }, [entries, today, weekOffset]);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const timesheetData = useMemo(() => {
    return DAY_LABELS.map((label, idx) => {
      const dateStr = weekDates[idx].toISOString().split('T')[0];
      const dayEntries = entries.filter((e) => e.date === dateStr);
      return {
        label,
        date: dateStr,
        total: dayEntries.reduce((s, e) => s + e.duration, 0),
        billable: dayEntries.filter((e) => e.billable).reduce((s, e) => s + e.duration, 0),
      };
    });
  }, [weekDates, entries]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      date: today,
      ticketId: '',
      ticketTitle: '',
      description: '',
      duration: 0,
      billable: true,
      user: 'John Doe',
    });
    setModalOpen(true);
  };

  const openEdit = (entry: TimeEntry) => {
    setEditing(entry);
    setForm({ ...entry });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.date || !form.ticketId || !form.description) return;
    if (editing) {
      setEntries((prev) => prev.map((e) => (e.id === editing.id ? { ...e, ...form } as TimeEntry : e)));
    } else {
      const newEntry: TimeEntry = {
        ...form as TimeEntry,
        id: Date.now(),
      };
      setEntries((prev) => [newEntry, ...prev]);
    }
    setModalOpen(false);
  };

  const handleDelete = (id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const stopTimer = () => {
    if (timerSeconds > 0) {
      const newEntry: TimeEntry = {
        id: Date.now(),
        date: today,
        ticketId: activeTicket || 'T-TIMER',
        ticketTitle: activeTicket || 'Timer Session',
        description: `Tracked ${formatTimer(timerSeconds)} via timer`,
        duration: Math.floor(timerSeconds / 60),
        billable: true,
        user: 'John Doe',
      };
      setEntries((prev) => [newEntry, ...prev]);
    }
    setIsRunning(false);
    setTimerSeconds(0);
    setActiveTicket('');
  };

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <Timer className="w-6 h-6" style={{ color: '#c9a87c' }} />
            Time Tracking
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Track and manage time spent on tickets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={view === 'entries' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('entries')}
            className="rounded-lg"
            style={view === 'entries' ? { background: '#c9a87c', color: '#fff' } : { borderColor: '#e5e0d5' }}
          >
            <Clock className="w-4 h-4 mr-1" /> Entries
          </Button>
          <Button
            variant={view === 'timesheet' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('timesheet')}
            className="rounded-lg"
            style={view === 'timesheet' ? { background: '#c9a87c', color: '#fff' } : { borderColor: '#e5e0d5' }}
          >
            <Calendar className="w-4 h-4 mr-1" /> Timesheet
          </Button>
        </div>
      </div>

      {/* Timer Widget */}
      <Card className="mb-6" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-3 flex-1 w-full">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: isRunning ? '#f5222d10' : '#c9a87c15' }}
              >
                <Timer className="w-6 h-6" style={{ color: isRunning ? '#f5222d' : '#c9a87c' }} />
              </div>
              <div className="flex-1 min-w-0">
                <Input
                  placeholder="What are you working on? (Ticket ID or description)"
                  value={activeTicket}
                  onChange={(e) => setActiveTicket(e.target.value)}
                  disabled={isRunning}
                  className="rounded-lg border-[#e5e0d5] text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-mono font-bold text-[#1f1f1f] tabular-nums">
                {formatTimer(timerSeconds)}
              </div>
              {!isRunning ? (
                <Button
                  onClick={() => setIsRunning(true)}
                  className="rounded-lg"
                  style={{ background: '#52c41a', color: '#fff' }}
                  disabled={!activeTicket.trim()}
                >
                  <Play className="w-4 h-4 mr-1" /> Start
                </Button>
              ) : (
                <Button onClick={stopTimer} className="rounded-lg" style={{ background: '#f5222d', color: '#fff' }}>
                  <Square className="w-4 h-4 mr-1" /> Stop
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4" style={{ color: '#c9a87c' }} />
                <span className="text-xs" style={{ color: '#595959' }}>Today</span>
              </div>
              <div className="text-2xl font-bold text-[#1f1f1f]">{formatDuration(summary.todayTotal)}</div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4" style={{ color: '#52c41a' }} />
                <span className="text-xs" style={{ color: '#595959' }}>Billable Today</span>
              </div>
              <div className="text-2xl font-bold" style={{ color: '#52c41a' }}>{formatDuration(summary.todayBillable)}</div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4" style={{ color: '#1890ff' }} />
                <span className="text-xs" style={{ color: '#595959' }}>This Week</span>
              </div>
              <div className="text-2xl font-bold text-[#1f1f1f]">{formatDuration(summary.weekTotal)}</div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Coffee className="w-4 h-4" style={{ color: '#8c8c8c' }} />
                <span className="text-xs" style={{ color: '#595959' }}>Non-Billable Week</span>
              </div>
              <div className="text-2xl font-bold" style={{ color: '#8c8c8c' }}>{formatDuration(summary.weekTotal - summary.weekBillable)}</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'entries' ? (
          <motion.div key="entries" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-[#1f1f1f]">Time Entries</h2>
              <Button onClick={openCreate} size="sm" className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
                <Plus className="w-4 h-4 mr-1" /> Add Entry
              </Button>
            </div>
            <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e0d5' }}>
                        <th className="text-left py-3 px-3 font-medium text-[#595959]">Date</th>
                        <th className="text-left py-3 px-3 font-medium text-[#595959]">Ticket</th>
                        <th className="text-left py-3 px-3 font-medium text-[#595959]">Description</th>
                        <th className="text-center py-3 px-3 font-medium text-[#595959]">Duration</th>
                        <th className="text-center py-3 px-3 font-medium text-[#595959]">Billable</th>
                        <th className="text-right py-3 px-3 font-medium text-[#595959]">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-[#f5f0e8]/50 transition-colors" style={{ borderBottom: '1px solid #f5f0e8' }}>
                          <td className="py-3 px-3 text-xs whitespace-nowrap" style={{ color: '#595959' }}>
                            {new Date(entry.date).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-xs font-medium text-[#1f1f1f]">{entry.ticketId}</span>
                            <span className="block text-[10px] truncate max-w-[150px]" style={{ color: '#8c8c8c' }}>{entry.ticketTitle}</span>
                          </td>
                          <td className="py-3 px-3 text-xs max-w-[300px] truncate" style={{ color: '#595959' }}>
                            {entry.description}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="font-medium text-xs text-[#1f1f1f]">{formatDuration(entry.duration)}</span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <Badge
                              style={{
                                background: entry.billable ? '#52c41a20' : '#f5f5f5',
                                color: entry.billable ? '#52c41a' : '#8c8c8c',
                                border: 'none',
                              }}
                              className="text-[10px]"
                            >
                              {entry.billable ? 'Billable' : 'Non-Bill'}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => openEdit(entry)}>
                              <Edit3 className="w-3 h-3" style={{ color: '#595959' }} />
                            </Button>
                            <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => handleDelete(entry.id)}>
                              <Trash2 className="w-3 h-3" style={{ color: '#f5222d' }} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div key="timesheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Week Navigation */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-[#1f1f1f]">Weekly Timesheet</h2>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o - 1)} className="rounded-lg h-8 w-8 p-0 border-[#e5e0d5]">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs font-medium text-[#1f1f1f]">
                  {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o + 1)} className="rounded-lg h-8 w-8 p-0 border-[#e5e0d5]">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-3">
              {timesheetData.map((day, idx) => {
                const isToday = day.date === today;
                const hours = day.total / 60;
                const billableHours = day.billable / 60;
                return (
                  <motion.div
                    key={day.date}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                  >
                    <Card
                      className="text-center"
                      style={{
                        background: isToday ? '#c9a87c10' : '#ffffff',
                        borderRadius: 12,
                        border: isToday ? '1px solid #c9a87c' : '1px solid #e5e0d5',
                      }}
                    >
                      <CardContent className="p-3">
                        <div className="text-[10px] font-medium uppercase" style={{ color: isToday ? '#c9a87c' : '#8c8c8c' }}>
                          {day.label}
                        </div>
                        <div className="text-lg font-bold mt-1 text-[#1f1f1f]">{hours.toFixed(1)}h</div>
                        <div className="text-[10px] mt-0.5" style={{ color: '#52c41a' }}>
                          {billableHours.toFixed(1)}h bill
                        </div>
                        {/* Mini bar */}
                        <div className="w-full h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: '#f5f0e8' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, (hours / 8) * 100)}%`,
                              background: isToday ? '#c9a87c' : '#1890ff',
                            }}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>

            {/* Total Row */}
            <Card className="mt-3" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#1f1f1f]">Week Total</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm" style={{ color: '#595959' }}>
                      {(summary.weekTotal / 60).toFixed(1)}h total
                    </span>
                    <span className="text-sm font-semibold" style={{ color: '#52c41a' }}>
                      {(summary.weekBillable / 60).toFixed(1)}h billable
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add/Edit Entry Modal */}
      <Dialog open={modalOpen} onOpenChange={(v) => !v && setModalOpen(false)}>
        <DialogContent className="sm:max-w-lg" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
              <Clock className="w-4 h-4" style={{ color: '#c9a87c' }} />
              {editing ? 'Edit Entry' : 'Add Time Entry'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.date || ''} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-lg border-[#e5e0d5]" />
              </div>
              <div className="space-y-2">
                <Label>Duration (minutes)</Label>
                <Input type="number" value={form.duration || ''} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} className="rounded-lg border-[#e5e0d5]" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ticket ID</Label>
                <Input value={form.ticketId || ''} onChange={(e) => setForm({ ...form, ticketId: e.target.value })} placeholder="e.g., T-1042" className="rounded-lg border-[#e5e0d5]" />
              </div>
              <div className="space-y-2">
                <Label>Ticket Title</Label>
                <Input value={form.ticketTitle || ''} onChange={(e) => setForm({ ...form, ticketTitle: e.target.value })} placeholder="Brief title" className="rounded-lg border-[#e5e0d5]" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What did you work on?" rows={2} className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="flex items-center justify-between">
              <Label>Billable</Label>
              <Switch checked={form.billable} onCheckedChange={(v) => setForm({ ...form, billable: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} className="rounded-lg border-[#e5e0d5]">Cancel</Button>
            <Button onClick={handleSave} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
              <Save className="w-4 h-4 mr-1" /> Save Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
