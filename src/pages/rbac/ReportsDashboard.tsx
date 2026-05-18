/**
 * Reports Dashboard — Comprehensive reporting with ticket volume,
 * agent performance, SLA compliance, CSAT, and resolution time analytics.
 */
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  Download,
  Calendar,
  TrendingUp,
  Users,
  CheckCircle,
  Smile,
  Clock,
  Filter,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentPerf {
  name: string;
  ticketsResolved: number;
  avgResolutionTime: number; // hours
  csat: number;
  slaPct: number;
}

/* ------------------------------------------------------------------ */
/*  Mock Data Generators                                               */
/* ------------------------------------------------------------------ */

function generateDailyData(days: number) {
  const data = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    data.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      created: Math.floor(Math.random() * 25) + 5,
      resolved: Math.floor(Math.random() * 20) + 3,
    });
  }
  return data;
}

const AGENT_PERFORMANCE: AgentPerf[] = [
  { name: 'John Doe', ticketsResolved: 142, avgResolutionTime: 4.2, csat: 4.6, slaPct: 96 },
  { name: 'Sarah Chen', ticketsResolved: 128, avgResolutionTime: 3.8, csat: 4.8, slaPct: 98 },
  { name: 'Mike Ross', ticketsResolved: 115, avgResolutionTime: 5.1, csat: 4.3, slaPct: 91 },
  { name: 'Emily Wang', ticketsResolved: 98, avgResolutionTime: 4.5, csat: 4.7, slaPct: 94 },
  { name: 'David Kim', ticketsResolved: 87, avgResolutionTime: 6.2, csat: 4.1, slaPct: 88 },
];

const CATEGORY_DATA = [
  { name: 'Hardware', value: 35, color: '#c9a87c' },
  { name: 'Software', value: 28, color: '#1890ff' },
  { name: 'Network', value: 18, color: '#722ed1' },
  { name: 'Access', value: 12, color: '#52c41a' },
  { name: 'General', value: 7, color: '#8c8c8c' },
];

const DEPARTMENT_DATA = [
  { name: 'IT Support', tickets: 142, color: '#c9a87c' },
  { name: 'HR', tickets: 38, color: '#1890ff' },
  { name: 'Facilities', tickets: 52, color: '#52c41a' },
  { name: 'Finance', tickets: 24, color: '#faad14' },
  { name: 'Engineering', tickets: 89, color: '#722ed1' },
  { name: 'Sales', tickets: 31, color: '#13c2c2' },
];

const SLA_COMPLIANCE_DATA = [
  { name: 'Critical', met: 92, breached: 8 },
  { name: 'High', met: 95, breached: 5 },
  { name: 'Medium', met: 88, breached: 12 },
  { name: 'Low', met: 96, breached: 4 },
  { name: 'Info', met: 99, breached: 1 },
];

const CSAT_DATA = [
  { name: 'Mon', rating: 4.2 },
  { name: 'Tue', rating: 4.5 },
  { name: 'Wed', rating: 4.3 },
  { name: 'Thu', rating: 4.6 },
  { name: 'Fri', rating: 4.8 },
  { name: 'Sat', rating: 4.4 },
  { name: 'Sun', rating: 4.7 },
];

/* ------------------------------------------------------------------ */
/*  CSV Export Helper                                                  */
/* ------------------------------------------------------------------ */

function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function ReportsDashboard() {
  const [reportTab, setReportTab] = useState('volume');
  const [dateRange, setDateRange] = useState('30d');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const dailyData = useMemo(() => {
    const days = dateRange === '7d' ? 7 : dateRange === '90d' ? 90 : 30;
    return generateDailyData(days);
  }, [dateRange]);

  const handleExport = useCallback(() => {
    let data: Record<string, unknown>[] = [];
    if (reportTab === 'volume') data = dailyData as Record<string, unknown>[];
    else if (reportTab === 'agents') data = AGENT_PERFORMANCE.map(a => ({ ...a })) as Record<string, unknown>[];
    else if (reportTab === 'categories') data = CATEGORY_DATA as Record<string, unknown>[];
    else if (reportTab === 'departments') data = DEPARTMENT_DATA as Record<string, unknown>[];
    else if (reportTab === 'sla') data = SLA_COMPLIANCE_DATA as Record<string, unknown>[];
    else if (reportTab === 'csat') data = CSAT_DATA as Record<string, unknown>[];
    downloadCSV(`report-${reportTab}-${dateRange}.csv`, data);
  }, [reportTab, dateRange, dailyData]);

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <BarChart3 className="w-6 h-6" style={{ color: '#c9a87c' }} />
            Reports Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Analytics and insights across your service desk
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date Range */}
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[140px] rounded-lg border-[#e5e0d5]" style={{ background: '#ffffff' }}>
              <Calendar className="w-4 h-4 mr-1" style={{ color: '#c9a87c' }} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={handleExport}
            variant="outline"
            className="rounded-lg border-[#e5e0d5]"
            style={{ background: '#ffffff' }}
          >
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-6" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium text-[#1f1f1f]">
            <Filter className="w-4 h-4" style={{ color: '#c9a87c' }} /> Filters
          </div>
          <div className="flex flex-wrap gap-3">
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[140px] rounded-lg border-[#e5e0d5]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] rounded-lg border-[#e5e0d5]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Report Type Tabs */}
      <Tabs value={reportTab} onValueChange={setReportTab} className="mb-6">
        <TabsList className="rounded-lg flex-wrap h-auto gap-1 p-1" style={{ background: '#ffffff', border: '1px solid #e5e0d5' }}>
          <TabsTrigger value="volume" className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <TrendingUp className="w-3.5 h-3.5 mr-1" /> Ticket Volume
          </TabsTrigger>
          <TabsTrigger value="agents" className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Users className="w-3.5 h-3.5 mr-1" /> Agent Performance
          </TabsTrigger>
          <TabsTrigger value="sla" className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <CheckCircle className="w-3.5 h-3.5 mr-1" /> SLA Compliance
          </TabsTrigger>
          <TabsTrigger value="csat" className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Smile className="w-3.5 h-3.5 mr-1" /> CSAT
          </TabsTrigger>
          <TabsTrigger value="resolution" className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Clock className="w-3.5 h-3.5 mr-1" /> Resolution Time
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AnimatePresence mode="wait">
        {/* TICKET VOLUME */}
        {reportTab === 'volume' && (
          <motion.div
            key="volume"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-[#1f1f1f]">Created vs Resolved Tickets</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                      <XAxis dataKey="date" tick={{ fill: '#595959', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#595959', fontSize: 11 }} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', background: '#fff' }} />
                      <Legend />
                      <Line type="monotone" dataKey="created" name="Created" stroke="#c9a87c" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#52c41a" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-[#1f1f1f]">By Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={CATEGORY_DATA} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} strokeWidth={0}>
                        {CATEGORY_DATA.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-2 justify-center mt-2">
                    {CATEGORY_DATA.map((c) => (
                      <Badge key={c.name} style={{ background: c.color + '20', color: c.color, border: 'none' }} className="text-xs">
                        {c.name} ({c.value}%)
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {/* AGENT PERFORMANCE */}
        {reportTab === 'agents' && (
          <motion.div
            key="agents"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
                  <Users className="w-4 h-4" style={{ color: '#c9a87c' }} />
                  Agent Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e0d5' }}>
                        <th className="text-left py-3 px-2 font-medium text-[#595959]">Agent</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">Tickets Resolved</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">Avg Resolution</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">CSAT</th>
                        <th className="text-center py-3 px-2 font-medium text-[#595959]">SLA %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {AGENT_PERFORMANCE.map((agent) => (
                        <tr key={agent.name} className="hover:bg-[#f5f0e8]/50 transition-colors" style={{ borderBottom: '1px solid #e5e0d5' }}>
                          <td className="py-3 px-2 font-medium text-[#1f1f1f]">{agent.name}</td>
                          <td className="text-center py-3 px-2 text-[#1f1f1f]">{agent.ticketsResolved}</td>
                          <td className="text-center py-3 px-2" style={{ color: '#595959' }}>{agent.avgResolutionTime}h</td>
                          <td className="text-center py-3 px-2">
                            <span className="font-semibold" style={{ color: agent.csat >= 4.5 ? '#52c41a' : agent.csat >= 4.0 ? '#faad14' : '#f5222d' }}>
                              {agent.csat.toFixed(1)}
                            </span>
                          </td>
                          <td className="text-center py-3 px-2">
                            <Badge style={{ background: agent.slaPct >= 95 ? '#52c41a20' : '#faad1420', color: agent.slaPct >= 95 ? '#52c41a' : '#faad14', border: 'none' }}>
                              {agent.slaPct}%
                            </Badge>
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

        {/* SLA COMPLIANCE */}
        {reportTab === 'sla' && (
          <motion.div
            key="sla"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-[#1f1f1f]">SLA Compliance by Priority</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={SLA_COMPLIANCE_DATA}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                      <XAxis dataKey="name" tick={{ fill: '#595959', fontSize: 12 }} />
                      <YAxis tick={{ fill: '#595959', fontSize: 12 }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', background: '#fff' }} />
                      <Legend />
                      <Bar dataKey="met" name="Met SLA %" fill="#52c41a" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="breached" name="Breached %" fill="#f5222d" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-[#1f1f1f]">Department Workload</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={DEPARTMENT_DATA} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                      <XAxis type="number" tick={{ fill: '#595959', fontSize: 12 }} />
                      <YAxis dataKey="name" type="category" tick={{ fill: '#595959', fontSize: 12 }} width={100} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', background: '#fff' }} />
                      <Bar dataKey="tickets" name="Tickets" radius={[0, 4, 4, 0]}>
                        {DEPARTMENT_DATA.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {/* CSAT */}
        {reportTab === 'csat' && (
          <motion.div
            key="csat"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
                  <Smile className="w-4 h-4" style={{ color: '#c9a87c' }} />
                  Customer Satisfaction Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={CSAT_DATA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                    <XAxis dataKey="name" tick={{ fill: '#595959', fontSize: 12 }} />
                    <YAxis domain={[3, 5]} tick={{ fill: '#595959', fontSize: 12 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', background: '#fff' }} />
                    <Line type="monotone" dataKey="rating" name="CSAT Rating" stroke="#c9a87c" strokeWidth={3} dot={{ fill: '#c9a87c', r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* RESOLUTION TIME */}
        {reportTab === 'resolution' && (
          <motion.div
            key="resolution"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
                  <Clock className="w-4 h-4" style={{ color: '#c9a87c' }} />
                  Average Resolution Time by Agent
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={AGENT_PERFORMANCE}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                    <XAxis dataKey="name" tick={{ fill: '#595959', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#595959', fontSize: 12 }} label={{ value: 'Hours', angle: -90, position: 'insideLeft', style: { fill: '#595959', fontSize: 12 } }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', background: '#fff' }} />
                    <Bar dataKey="avgResolutionTime" name="Avg Resolution (hours)" fill="#c9a87c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
