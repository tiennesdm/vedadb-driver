/**
 * SLA Dashboard — Full SLA management with policies, compliance tracking,
 * breach alerts, response time charts, and policy editor.
 */
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Timer,
  TrendingUp,
  Shield,
  Pencil,
  Plus,
  Save,
  Gauge,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SLAPolicy {
  id: number;
  name: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  responseTime: number; // minutes
  resolutionTime: number; // minutes
  businessHours: boolean;
  color: string;
}

interface Ticket {
  id: number;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
  respondedAt?: string;
  resolvedAt?: string;
  assignee: string;
}

interface BreachAlert {
  id: number;
  ticketId: number;
  title: string;
  priority: string;
  breachType: 'response' | 'resolution';
  overdueBy: string;
  assignee: string;
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_POLICIES: SLAPolicy[] = [
  { id: 1, name: 'Critical Priority', priority: 'Critical', responseTime: 15, resolutionTime: 240, businessHours: false, color: '#f5222d' },
  { id: 2, name: 'High Priority', priority: 'High', responseTime: 60, resolutionTime: 480, businessHours: true, color: '#faad14' },
  { id: 3, name: 'Medium Priority', priority: 'Medium', responseTime: 240, resolutionTime: 1440, businessHours: true, color: '#1890ff' },
  { id: 4, name: 'Low Priority', priority: 'Low', responseTime: 480, resolutionTime: 2880, businessHours: true, color: '#52c41a' },
  { id: 5, name: 'Info Priority', priority: 'Info', responseTime: 1440, resolutionTime: 5760, businessHours: true, color: '#8c8c8c' },
];

const MOCK_TICKETS: Ticket[] = [
  { id: 101, title: 'Server downtime in production', priority: 'Critical', status: 'Open', createdAt: '2024-12-04T08:00:00Z', assignee: 'John Doe' },
  { id: 102, title: 'VPN not connecting for remote team', priority: 'High', status: 'In Progress', createdAt: '2024-12-04T06:00:00Z', respondedAt: '2024-12-04T07:30:00Z', assignee: 'Sarah Chen' },
  { id: 103, title: 'Email sync issues on mobile', priority: 'Medium', status: 'Open', createdAt: '2024-12-03T14:00:00Z', assignee: 'Mike Ross' },
  { id: 104, title: 'Printer jam in Floor 3', priority: 'Low', status: 'Open', createdAt: '2024-12-02T10:00:00Z', assignee: 'Emily Wang' },
  { id: 105, title: 'Database backup failure', priority: 'Critical', status: 'In Progress', createdAt: '2024-12-04T09:00:00Z', respondedAt: '2024-12-04T09:20:00Z', assignee: 'John Doe' },
  { id: 106, title: 'New hire laptop request', priority: 'Medium', status: 'Resolved', createdAt: '2024-12-01T08:00:00Z', respondedAt: '2024-12-01T10:00:00Z', resolvedAt: '2024-12-03T16:00:00Z', assignee: 'Sarah Chen' },
  { id: 107, title: 'WiFi intermittent disconnections', priority: 'High', status: 'Open', createdAt: '2024-12-04T05:00:00Z', assignee: 'Mike Ross' },
  { id: 108, title: 'Software license renewal', priority: 'Info', status: 'Resolved', createdAt: '2024-11-28T08:00:00Z', respondedAt: '2024-11-29T08:00:00Z', resolvedAt: '2024-12-02T08:00:00Z', assignee: 'Emily Wang' },
];

const BREACH_ALERTS: BreachAlert[] = [
  { id: 1, ticketId: 101, title: 'Server downtime in production', priority: 'Critical', breachType: 'response', overdueBy: '45 min', assignee: 'John Doe' },
  { id: 2, ticketId: 107, title: 'WiFi intermittent disconnections', priority: 'High', breachType: 'response', overdueBy: '30 min', assignee: 'Mike Ross' },
  { id: 3, ticketId: 103, title: 'Email sync issues on mobile', priority: 'Medium', breachType: 'resolution', overdueBy: '2h 15m', assignee: 'Mike Ross' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const PRIORITY_COLORS: Record<string, string> = {
  Critical: '#f5222d',
  High: '#faad14',
  Medium: '#1890ff',
  Low: '#52c41a',
  Info: '#8c8c8c',
};

function getPolicyForPriority(priority: string): SLAPolicy | undefined {
  return INITIAL_POLICIES.find((p) => p.priority === priority);
}

function computeAvgResponseTime(tickets: Ticket[], priority: string): number {
  const relevant = tickets.filter(
    (t) => t.priority === priority && t.respondedAt && t.createdAt
  );
  if (relevant.length === 0) return 0;
  const total = relevant.reduce((sum, t) => {
    const diff =
      new Date(t.respondedAt!).getTime() - new Date(t.createdAt).getTime();
    return sum + diff / 60000; // minutes
  }, 0);
  return Math.round(total / relevant.length);
}

function computeCompliance(tickets: Ticket[]): number {
  let met = 0;
  let total = 0;
  tickets.forEach((t) => {
    const policy = getPolicyForPriority(t.priority);
    if (!policy) return;
    if (t.respondedAt && t.createdAt) {
      total++;
      const diff = new Date(t.respondedAt).getTime() - new Date(t.createdAt).getTime();
      if (diff / 60000 <= policy.responseTime) met++;
    }
    if (t.resolvedAt && t.createdAt) {
      total++;
      const diff = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime();
      if (diff / 60000 <= policy.resolutionTime) met++;
    }
  });
  return total === 0 ? 100 : Math.round((met / total) * 100);
}

/* ------------------------------------------------------------------ */
/*  Policy Editor Modal                                                */
/* ------------------------------------------------------------------ */

function PolicyEditorModal({
  open,
  onClose,
  policy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  policy: SLAPolicy | null;
  onSave: (policy: SLAPolicy) => void;
}) {
  const [form, setForm] = useState<SLAPolicy>({
    id: 0,
    name: '',
    priority: 'Medium',
    responseTime: 60,
    resolutionTime: 480,
    businessHours: true,
    color: '#1890ff',
  });

  useState(() => {
    if (policy) setForm({ ...policy });
  });

  const handleSubmit = () => {
    onSave(form);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
            <Pencil className="w-4 h-4" style={{ color: '#c9a87c' }} />
            {policy ? 'Edit SLA Policy' : 'Create SLA Policy'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Policy Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Critical Priority"
              className="rounded-lg border-[#e5e0d5]"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Response Time (min)</Label>
              <Input
                type="number"
                value={form.responseTime}
                onChange={(e) => setForm({ ...form, responseTime: Number(e.target.value) })}
                className="rounded-lg border-[#e5e0d5]"
              />
            </div>
            <div className="space-y-2">
              <Label>Resolution Time (min)</Label>
              <Input
                type="number"
                value={form.resolutionTime}
                onChange={(e) => setForm({ ...form, resolutionTime: Number(e.target.value) })}
                className="rounded-lg border-[#e5e0d5]"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label>Business Hours Only</Label>
            <Switch
              checked={form.businessHours}
              onCheckedChange={(v) => setForm({ ...form, businessHours: v })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg border-[#e5e0d5]">
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
            <Save className="w-4 h-4 mr-1" /> Save Policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function SLADashboard() {
  const [policies, setPolicies] = useState<SLAPolicy[]>(INITIAL_POLICIES);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<SLAPolicy | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const compliancePct = useMemo(() => computeCompliance(MOCK_TICKETS), []);

  const responseTimeData = useMemo(
    () =>
      policies.map((p) => ({
        name: p.priority,
        target: p.responseTime,
        actual: computeAvgResponseTime(MOCK_TICKETS, p.priority),
        color: p.color,
      })),
    [policies]
  );

  const performanceData = useMemo(
    () =>
      policies.map((p) => {
        const relevant = MOCK_TICKETS.filter((t) => t.priority === p.priority);
        const breaches = BREACH_ALERTS.filter((b) => b.priority === p.priority).length;
        return {
          name: p.name,
          tickets: relevant.length,
          target: `${p.responseTime}m / ${p.resolutionTime}m`,
          actual: `${computeAvgResponseTime(MOCK_TICKETS, p.priority)}m avg`,
          met: relevant.length > 0 ? Math.round(((relevant.length - breaches) / relevant.length) * 100) : 100,
          breaches,
          color: p.color,
        };
      }),
    [policies]
  );

  const handleEditPolicy = useCallback((policy: SLAPolicy) => {
    setEditingPolicy(policy);
    setEditorOpen(true);
  }, []);

  const handleSavePolicy = useCallback(
    (updated: SLAPolicy) => {
      setPolicies((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
    },
    []
  );

  const donutData = [
    { name: 'Compliant', value: compliancePct, color: '#52c41a' },
    { name: 'Breached', value: 100 - compliancePct, color: '#f5222d' },
  ];

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <Shield className="w-6 h-6" style={{ color: '#c9a87c' }} />
            SLA Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Monitor and manage service level agreements
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingPolicy(null);
            setEditorOpen(true);
          }}
          className="rounded-lg"
          style={{ background: '#c9a87c', color: '#fff' }}
        >
          <Plus className="w-4 h-4 mr-1" /> New Policy
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList className="rounded-lg" style={{ background: '#ffffff', border: '1px solid #e5e0d5' }}>
          <TabsTrigger value="overview" className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            Overview
          </TabsTrigger>
          <TabsTrigger value="performance" className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            Performance
          </TabsTrigger>
          <TabsTrigger value="breaches" className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            Breaches
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Top Row: Policy Cards + Compliance Gauge */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Policy Cards */}
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {policies.map((policy, idx) => (
                  <motion.div
                    key={policy.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.08 }}
                  >
                    <Card
                      className="cursor-pointer hover:shadow-lg transition-shadow"
                      style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}
                      onClick={() => handleEditPolicy(policy)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <Badge style={{ background: policy.color + '20', color: policy.color, borderColor: policy.color }} variant="outline">
                            {policy.priority}
                          </Badge>
                          <Pencil className="w-3.5 h-3.5 text-[#595959]" />
                        </div>
                        <CardTitle className="text-sm font-medium mt-2 text-[#1f1f1f]">
                          {policy.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1" style={{ color: '#595959' }}>
                            <Clock className="w-3 h-3" /> Response
                          </span>
                          <span className="font-semibold text-[#1f1f1f]">{policy.responseTime}m</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1" style={{ color: '#595959' }}>
                            <Timer className="w-3 h-3" /> Resolution
                          </span>
                          <span className="font-semibold text-[#1f1f1f]">{policy.resolutionTime}m</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1" style={{ color: '#595959' }}>
                            <Gauge className="w-3 h-3" /> 24/7
                          </span>
                          <span className="font-semibold" style={{ color: policy.businessHours ? '#595959' : '#52c41a' }}>
                            {policy.businessHours ? 'Business Hours' : 'Always On'}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              {/* Compliance Gauge */}
              <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
                    <CheckCircle className="w-4 h-4" style={{ color: '#c9a87c' }} />
                    Overall Compliance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={85}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {donutData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="text-center -mt-4">
                    <div className="text-3xl font-bold" style={{ color: compliancePct >= 90 ? '#52c41a' : compliancePct >= 70 ? '#faad14' : '#f5222d' }}>
                      {compliancePct}%
                    </div>
                    <p className="text-xs" style={{ color: '#595959' }}>SLA compliance this period</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Response Time Chart */}
            <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
                  <TrendingUp className="w-4 h-4" style={{ color: '#c9a87c' }} />
                  Average Response Time vs Target
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={responseTimeData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                    <XAxis dataKey="name" tick={{ fill: '#595959', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#595959', fontSize: 12 }} label={{ value: 'Minutes', angle: -90, position: 'insideLeft', style: { fill: '#595959', fontSize: 12 } }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', background: '#fff' }}
                    />
                    <Legend />
                    <Bar dataKey="target" name="Target (min)" fill="#c9a87c" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="actual" name="Actual Avg (min)" fill="#1890ff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {activeTab === 'performance' && (
          <motion.div
            key="performance"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-[#1f1f1f]">SLA Performance by Policy</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e0d5' }}>
                        <th className="text-left py-3 px-2 font-medium text-[#595959]">Policy</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">Tickets</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">Target</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">Actual</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">% Met</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">Breaches</th>
                      </tr>
                    </thead>
                    <tbody>
                      {performanceData.map((row) => (
                        <tr key={row.name} className="hover:bg-[#f5f0e8]/50 transition-colors" style={{ borderBottom: '1px solid #e5e0d5' }}>
                          <td className="py-3 px-2 font-medium text-[#1f1f1f] flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: row.color }} />
                            {row.name}
                          </td>
                          <td className="text-center py-3 px-2 text-[#1f1f1f]">{row.tickets}</td>
                          <td className="text-center py-3 px-2" style={{ color: '#595959' }}>{row.target}</td>
                          <td className="text-center py-3 px-2" style={{ color: '#595959' }}>{row.actual}</td>
                          <td className="text-center py-3 px-2">
                            <Badge
                              style={{
                                background: row.met >= 90 ? '#52c41a20' : row.met >= 70 ? '#faad1420' : '#f5222d20',
                                color: row.met >= 90 ? '#52c41a' : row.met >= 70 ? '#faad14' : '#f5222d',
                                border: 'none',
                              }}
                            >
                              {row.met}%
                            </Badge>
                          </td>
                          <td className="text-center py-3 px-2">
                            <span className="font-semibold" style={{ color: row.breaches > 0 ? '#f5222d' : '#52c41a' }}>
                              {row.breaches}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {activeTab === 'breaches' && (
          <motion.div
            key="breaches"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
                  <AlertTriangle className="w-4 h-4 text-[#f5222d]" />
                  Active Breach Alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {BREACH_ALERTS.map((alert) => (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-start gap-3 p-4 rounded-lg"
                    style={{ background: '#fff2f0', border: '1px solid #ffccc7' }}
                  >
                    <XCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#f5222d' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-[#1f1f1f]">#{alert.ticketId}</span>
                        <span className="text-sm text-[#1f1f1f] truncate">{alert.title}</span>
                        <Badge style={{ background: PRIORITY_COLORS[alert.priority] + '20', color: PRIORITY_COLORS[alert.priority], border: 'none' }}>
                          {alert.priority}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: '#595959' }}>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {alert.breachType === 'response' ? 'Response overdue' : 'Resolution overdue'}
                        </span>
                        <span className="font-semibold" style={{ color: '#f5222d' }}>+{alert.overdueBy}</span>
                        <span>Assignee: {alert.assignee}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
                {BREACH_ALERTS.length === 0 && (
                  <div className="text-center py-8 text-sm" style={{ color: '#595959' }}>
                    <CheckCircle className="w-8 h-8 mx-auto mb-2" style={{ color: '#52c41a' }} />
                    No active breaches. All SLAs are being met!
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <PolicyEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        policy={editingPolicy}
        onSave={handleSavePolicy}
      />
    </div>
  );
}
