/**
 * ScheduledReports - Schedule saved reports for automatic delivery
 * Route: /scheduled-reports
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  CalendarClock,
  Plus,
  Save,
  Clock,
  Mail,
  FileSpreadsheet,
  FileText,
  Code,
  CheckCircle,
  XCircle,
  CalendarDays,
  Hourglass,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ScheduledReport {
  id: string;
  name: string;
  reportName: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: string;
  dayOfMonth?: string;
  time: string;
  recipients: string[];
  format: 'csv' | 'pdf' | 'html';
  enabled: boolean;
  lastRun: string;
  nextRun: string;
}

interface DeliveryHistory {
  id: string;
  scheduleId: string;
  scheduleName: string;
  sentAt: string;
  status: 'success' | 'failed';
  recipients: number;
  format: string;
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_SCHEDULES: ScheduledReport[] = [
  {
    id: 'sch_1',
    name: 'Daily Ticket Summary',
    reportName: 'Ticket Volume Report',
    frequency: 'daily',
    time: '08:00',
    recipients: ['manager@company.com', 'admin@company.com'],
    format: 'html',
    enabled: true,
    lastRun: '2024-01-15 08:00',
    nextRun: '2024-01-16 08:00',
  },
  {
    id: 'sch_2',
    name: 'Weekly Performance',
    reportName: 'Agent Performance',
    frequency: 'weekly',
    dayOfWeek: 'monday',
    time: '09:00',
    recipients: ['director@company.com'],
    format: 'pdf',
    enabled: true,
    lastRun: '2024-01-08 09:00',
    nextRun: '2024-01-22 09:00',
  },
  {
    id: 'sch_3',
    name: 'Monthly Analytics',
    reportName: 'Full Analytics Dashboard',
    frequency: 'monthly',
    dayOfMonth: '1',
    time: '07:00',
    recipients: ['cfo@company.com', 'cto@company.com'],
    format: 'csv',
    enabled: false,
    lastRun: '2023-12-01 07:00',
    nextRun: '2024-02-01 07:00',
  },
];

const INITIAL_HISTORY: DeliveryHistory[] = [
  {
    id: 'dh_1',
    scheduleId: 'sch_1',
    scheduleName: 'Daily Ticket Summary',
    sentAt: '2024-01-15 08:00',
    status: 'success',
    recipients: 2,
    format: 'html',
  },
  {
    id: 'dh_2',
    scheduleId: 'sch_1',
    scheduleName: 'Daily Ticket Summary',
    sentAt: '2024-01-14 08:00',
    status: 'success',
    recipients: 2,
    format: 'html',
  },
  {
    id: 'dh_3',
    scheduleId: 'sch_2',
    scheduleName: 'Weekly Performance',
    sentAt: '2024-01-08 09:00',
    status: 'failed',
    recipients: 1,
    format: 'pdf',
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ScheduledReports() {
  const [schedules, setSchedules] = useState<ScheduledReport[]>(INITIAL_SCHEDULES);
  const [history] = useState<DeliveryHistory[]>(INITIAL_HISTORY);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduledReport | null>(null);

  // Form state
  const [newName, setNewName] = useState('');
  const [newReportName, setNewReportName] = useState('');
  const [newFrequency, setNewFrequency] = useState<'hourly' | 'daily' | 'weekly' | 'monthly'>('daily');
  const [newDayOfWeek, setNewDayOfWeek] = useState('monday');
  const [newDayOfMonth, setNewDayOfMonth] = useState('1');
  const [newTime, setNewTime] = useState('08:00');
  const [newRecipients, setNewRecipients] = useState('');
  const [newFormat, setNewFormat] = useState<'csv' | 'pdf' | 'html'>('html');

  const createSchedule = () => {
    if (!newName.trim() || !newReportName.trim() || !newTime) {
      toast.error('Name, Report, and Time are required');
      return;
    }
    const recipients = newRecipients.split(',').map((e) => e.trim()).filter(Boolean);
    if (recipients.length === 0) {
      toast.error('Enter at least one recipient');
      return;
    }

    const schedule: ScheduledReport = {
      id: `sch_${Date.now()}`,
      name: newName,
      reportName: newReportName,
      frequency: newFrequency,
      dayOfWeek: newFrequency === 'weekly' ? newDayOfWeek : undefined,
      dayOfMonth: newFrequency === 'monthly' ? newDayOfMonth : undefined,
      time: newTime,
      recipients,
      format: newFormat,
      enabled: true,
      lastRun: 'Never',
      nextRun: computeNextRun(newFrequency, newDayOfWeek, newDayOfMonth, newTime),
    };
    setSchedules([...schedules, schedule]);
    resetForm();
    setShowCreateDialog(false);
    toast.success('Schedule created');
  };

  const resetForm = () => {
    setNewName('');
    setNewReportName('');
    setNewFrequency('daily');
    setNewDayOfWeek('monday');
    setNewDayOfMonth('1');
    setNewTime('08:00');
    setNewRecipients('');
    setNewFormat('html');
  };

  const computeNextRun = (freq: string, dow?: string, dom?: string, time?: string): string => {
    const now = new Date();
    const [hours, mins] = (time || '08:00').split(':').map(Number);
    now.setHours(hours, mins, 0, 0);

    if (freq === 'hourly') {
      now.setHours(now.getHours() + 1);
    } else if (freq === 'daily') {
      now.setDate(now.getDate() + 1);
    } else if (freq === 'weekly') {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = days.indexOf(dow || 'monday');
      const currentDay = now.getDay();
      const diff = (targetDay - currentDay + 7) % 7 || 7;
      now.setDate(now.getDate() + diff);
    } else if (freq === 'monthly') {
      now.setMonth(now.getMonth() + 1);
      now.setDate(parseInt(dom || '1'));
    }

    return now.toLocaleString();
  };

  const toggleSchedule = (id: string) => {
    setSchedules(
      schedules.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const deleteSchedule = (id: string) => {
    setSchedules(schedules.filter((s) => s.id !== id));
    toast.success('Schedule deleted');
  };

  const viewHistory = (schedule: ScheduledReport) => {
    setSelectedSchedule(schedule);
    setShowHistoryDialog(true);
  };

  const frequencyIcons: Record<string, React.ElementType> = {
    hourly: Hourglass,
    daily: Clock,
    weekly: CalendarDays,
    monthly: CalendarClock,
  };

  const formatIcons: Record<string, React.ElementType> = {
    csv: FileSpreadsheet,
    pdf: FileText,
    html: Code,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f5f2eb] flex items-center justify-center">
            <CalendarClock className="w-5 h-5 text-[#c9a87c]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#262626]">Scheduled Reports</h1>
            <p className="text-xs text-[#8a8a8a]">Automate report delivery on a schedule</p>
          </div>
        </div>
        <Button
          size="sm"
          className="h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
          onClick={() => setShowCreateDialog(true)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          New Schedule
        </Button>
      </div>

      {/* Schedule Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {schedules.map((schedule) => {
          const FreqIcon = frequencyIcons[schedule.frequency];
          const FormatIcon = formatIcons[schedule.format];
          return (
            <Card
              key={schedule.id}
              className={`border bg-white transition-all ${
                schedule.enabled ? 'border-[#e5e0d5]' : 'border-gray-200 opacity-60'
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-[#f5f2eb] flex items-center justify-center">
                      <FreqIcon className="w-4 h-4 text-[#c9a87c]" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[#262626]">
                        {schedule.name}
                      </div>
                      <div className="text-[10px] text-[#8a8a8a]">
                        {schedule.reportName}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={schedule.enabled}
                    onCheckedChange={() => toggleSchedule(schedule.id)}
                    className="scale-75"
                  />
                </div>

                <div className="space-y-1.5 text-xs text-[#595959]">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-[#8a8a8a]" />
                    <span className="capitalize">
                      {schedule.frequency}
                      {schedule.frequency === 'weekly' && schedule.dayOfWeek && ` - ${schedule.dayOfWeek}`}
                      {schedule.frequency === 'monthly' && schedule.dayOfMonth && ` - Day ${schedule.dayOfMonth}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-3 h-3 text-[#8a8a8a]" />
                    <span>{schedule.recipients.length} recipients</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FormatIcon className="w-3 h-3 text-[#8a8a8a]" />
                    <span className="uppercase">{schedule.format}</span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-[#f0ece3] flex items-center justify-between">
                  <div className="text-[10px] text-[#8a8a8a]">
                    Next: {schedule.nextRun}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => viewHistory(schedule)}
                    >
                      <CalendarClock className="w-3 h-3 text-[#8a8a8a]" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => deleteSchedule(schedule.id)}
                    >
                      <Save className="w-3 h-3 text-red-400" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Delivery History */}
      <Card className="border border-[#e5e0d5] bg-white">
        <CardHeader className="p-4 pb-2">
          <h3 className="text-sm font-semibold text-[#262626]">Recent Deliveries</h3>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[250px]">
            <div className="divide-y divide-[#f0ece3]">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                  {h.status === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[#262626]">
                      {h.scheduleName}
                    </div>
                    <div className="text-[10px] text-[#8a8a8a]">
                      {h.sentAt} - {h.recipients} recipients - {h.format.toUpperCase()}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-4 ${
                      h.status === 'success'
                        ? 'border-emerald-200 text-emerald-600'
                        : 'border-red-200 text-red-600'
                    }`}
                  >
                    {h.status}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              New Schedule
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Schedule Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Daily Summary"
                className="h-8 text-xs border-[#e5e0d5] mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Report Name</Label>
              <Input
                value={newReportName}
                onChange={(e) => setNewReportName(e.target.value)}
                placeholder="e.g. Ticket Volume Report"
                className="h-8 text-xs border-[#e5e0d5] mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Frequency</Label>
              <Select value={newFrequency} onValueChange={(v: 'hourly' | 'daily' | 'weekly' | 'monthly') => setNewFrequency(v)}>
                <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly" className="text-xs">Hourly</SelectItem>
                  <SelectItem value="daily" className="text-xs">Daily</SelectItem>
                  <SelectItem value="weekly" className="text-xs">Weekly</SelectItem>
                  <SelectItem value="monthly" className="text-xs">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newFrequency === 'weekly' && (
              <div>
                <Label className="text-[10px] text-[#8a8a8a] uppercase">Day of Week</Label>
                <Select value={newDayOfWeek} onValueChange={setNewDayOfWeek}>
                  <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
                      (d) => (
                        <SelectItem key={d} value={d} className="text-xs capitalize">
                          {d}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {newFrequency === 'monthly' && (
              <div>
                <Label className="text-[10px] text-[#8a8a8a] uppercase">Day of Month</Label>
                <Select value={newDayOfMonth} onValueChange={setNewDayOfMonth}>
                  <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)} className="text-xs">
                        {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Time</Label>
              <Input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="h-8 text-xs border-[#e5e0d5] mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Recipients (comma-separated)</Label>
              <Input
                value={newRecipients}
                onChange={(e) => setNewRecipients(e.target.value)}
                placeholder="user1@company.com, user2@company.com"
                className="h-8 text-xs border-[#e5e0d5] mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Format</Label>
              <Select value={newFormat} onValueChange={(v: 'csv' | 'pdf' | 'html') => setNewFormat(v)}>
                <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv" className="text-xs">CSV</SelectItem>
                  <SelectItem value="pdf" className="text-xs">PDF</SelectItem>
                  <SelectItem value="html" className="text-xs">HTML</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="w-full h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
              onClick={createSchedule}
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              Create Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-lg bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              Delivery History: {selectedSchedule?.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[300px] mt-2">
            <div className="space-y-2">
              {history
                .filter((h) => h.scheduleId === selectedSchedule?.id)
                .map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 p-2 rounded-md border border-[#f0ece3]"
                  >
                    {h.status === 'success' ? (
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <div className="flex-1">
                      <div className="text-xs text-[#262626]">{h.sentAt}</div>
                      <div className="text-[10px] text-[#8a8a8a]">
                        {h.recipients} recipients - {h.format.toUpperCase()}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-4 ${
                        h.status === 'success'
                          ? 'border-emerald-200 text-emerald-600'
                          : 'border-red-200 text-red-600'
                      }`}
                    >
                      {h.status}
                    </Badge>
                  </div>
                ))}
              {history.filter((h) => h.scheduleId === selectedSchedule?.id).length === 0 && (
                <div className="text-center text-sm text-[#8a8a8a] py-8">
                  No delivery history for this schedule
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
