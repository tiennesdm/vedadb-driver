/**
 * SmartRouting — AI-powered ticket routing configuration
 * Routing rules, agent skills, workload balancing, routing history, metrics
 * Route: /smart-routing
 */
import { useState } from 'react';
import {
  Route, GitBranch, Users, BarChart3, History, Settings,
  Plus, Trash2, Edit2, Zap, ArrowRight,
  TrendingUp, Target, Clock, Brain
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import AIConfidenceMeter from '@/components/advanced/AIConfidenceMeter';

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const ROUTING_RULES = [
  { id: 1, name: 'Network Issues', condition: 'category = "Network" OR tags contains "VPN"', action: 'Assign to Network Team', priority: 'high', active: true },
  { id: 2, name: 'Password Reset', condition: 'category = "Account" AND title contains "password"', action: 'Assign to Level 1 Agent', priority: 'medium', active: true },
  { id: 3, name: 'Security Escalation', condition: 'priority = "high" AND category = "Security"', action: 'Escalate to Security Team', priority: 'critical', active: true },
  { id: 4, name: 'Hardware Requests', condition: 'category = "Hardware" OR category = "Printer"', action: 'Assign to IT Support', priority: 'medium', active: true },
  { id: 5, name: 'VIP Customers', condition: 'customer_tier = "VIP"', action: 'Assign to Senior Agent', priority: 'high', active: false },
];

const AGENT_SKILLS = [
  { id: 1, name: 'Sarah Agent', skills: ['Network', 'VPN', 'Security', 'Linux'], capacity: 30, current: 24, efficiency: 96, avatar: 'S' },
  { id: 2, name: 'Mike Support', skills: ['Hardware', 'Printer', 'Windows', 'Software'], capacity: 25, current: 18, efficiency: 92, avatar: 'M' },
  { id: 3, name: 'Lisa Help', skills: ['Email', 'Account', 'Password', 'Office 365'], capacity: 28, current: 15, efficiency: 94, avatar: 'L' },
  { id: 4, name: 'Tom Desk', skills: ['General', 'Onboarding', 'Training', 'Mac'], capacity: 20, current: 8, efficiency: 88, avatar: 'T' },
  { id: 5, name: 'Anna Tech', skills: ['Database', 'API', 'Cloud', 'AWS'], capacity: 22, current: 20, efficiency: 90, avatar: 'A' },
];

const ROUTING_HISTORY = [
  { id: 1, ticket: '#1024 "VPN disconnecting"', routedTo: 'Sarah Agent', reason: 'Network skill match (96%)', time: '2 min ago', method: 'auto' },
  { id: 2, ticket: '#1023 "Printer offline"', routedTo: 'Mike Support', reason: 'Hardware skill match (94%)', time: '8 min ago', method: 'auto' },
  { id: 3, ticket: '#1022 "Password reset"', routedTo: 'Lisa Help', reason: 'Account skill match, lowest load', time: '15 min ago', method: 'auto' },
  { id: 4, ticket: '#1021 "Slow database"', routedTo: 'Anna Tech', reason: 'Manual override by admin', time: '32 min ago', method: 'manual' },
  { id: 5, ticket: '#1020 "New hire setup"', routedTo: 'Tom Desk', reason: 'Onboarding skill match (98%)', time: '45 min ago', method: 'auto' },
];

const EFFICIENCY_DATA = [
  { day: 'Mon', auto: 28, manual: 3, accuracy: 92 },
  { day: 'Tue', auto: 32, manual: 2, accuracy: 94 },
  { day: 'Wed', auto: 25, manual: 5, accuracy: 89 },
  { day: 'Thu', auto: 35, manual: 1, accuracy: 96 },
  { day: 'Fri', auto: 30, manual: 4, accuracy: 93 },
];

const CATEGORY_ROUTING = [
  { name: 'Network', value: 28, color: '#1890ff' },
  { name: 'Hardware', value: 22, color: '#52c41a' },
  { name: 'Account', value: 35, color: '#c9a87c' },
  { name: 'Security', value: 15, color: '#722ed1' },
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function SmartRouting() {
  const [rules, setRules] = useState(ROUTING_RULES);
  const [showNewRule, setShowNewRule] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', condition: '', action: '', priority: 'medium' as string });
  const [activeTab, setActiveTab] = useState<'rules' | 'agents' | 'history' | 'metrics'>('rules');
  const [editingRule, setEditingRule] = useState<number | null>(null);

  const autoRouted = ROUTING_HISTORY.filter((h) => h.method === 'auto').length;
  const avgAccuracy = Math.round(EFFICIENCY_DATA.reduce((s, d) => s + d.accuracy, 0) / EFFICIENCY_DATA.length);
  const totalRules = rules.filter((r) => r.active).length;

  const toggleRule = (id: number) => {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, active: !r.active } : r));
  };

  const addRule = () => {
    if (!newRule.name || !newRule.condition) return;
    setRules((prev) => [...prev, { ...newRule, id: Date.now(), active: true }]);
    setNewRule({ name: '', condition: '', action: '', priority: 'medium' });
    setShowNewRule(false);
  };

  const deleteRule = (id: number) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const priorityColors: Record<string, string> = {
    critical: '#f5222d',
    high: '#faad14',
    medium: '#1890ff',
    low: '#52c41a',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#c9a87c' }}>
            <GitBranch size={20} className="text-[#1f1f1f]" />
          </div>
          <div>
            <h2 className="text-xl font-medium text-[#1f1f1f]">Smart Ticket Routing</h2>
            <p className="text-sm text-[#595959]">AI-powered routing rules and workload balancing</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-[#e5e0d5] bg-white px-3 py-2">
            <Brain size={16} style={{ color: '#c9a87c' }} />
            <div>
              <p className="text-[10px] text-[#8a8a8a]">Routing Accuracy</p>
              <p className="text-sm font-bold text-[#c9a87c]">{avgAccuracy}%</p>
            </div>
          </div>
          <AIConfidenceMeter confidence={0.89} size={70} showLabel={false} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Route} label="Active Rules" value={String(totalRules)} color="#c9a87c" />
        <StatCard icon={Zap} label="Auto-Routed" value={`${autoRouted}`} color="#52c41a" />
        <StatCard icon={Users} label="Active Agents" value={String(AGENT_SKILLS.length)} color="#1890ff" />
        <StatCard icon={Target} label="Avg Match" value={`${avgAccuracy}%`} color="#722ed1" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-[#e5e0d5] bg-white p-1">
        {[
          { id: 'rules' as const, label: 'Routing Rules', icon: Route },
          { id: 'agents' as const, label: 'Agent Skills', icon: Users },
          { id: 'history' as const, label: 'Routing History', icon: History },
          { id: 'metrics' as const, label: 'Metrics', icon: BarChart3 },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-[#c9a87c]/15 text-[#1f1f1f]' : 'text-[#595959] hover:bg-[#fbf9f4]'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {/* --- Routing Rules --- */}
        {activeTab === 'rules' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setShowNewRule(!showNewRule)}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#c9a87c', color: '#1f1f1f' }}
              >
                <Plus size={16} />
                Add Rule
              </button>
            </div>

            <AnimatePresence>
              {showNewRule && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
                    <h4 className="mb-3 text-sm font-medium text-[#1f1f1f]">New Routing Rule</h4>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <input
                        value={newRule.name}
                        onChange={(e) => setNewRule((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Rule name"
                        className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                      />
                      <select
                        value={newRule.priority}
                        onChange={(e) => setNewRule((p) => ({ ...p, priority: e.target.value }))}
                        className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                      >
                        <option value="low">Low Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="high">High Priority</option>
                        <option value="critical">Critical</option>
                      </select>
                      <input
                        value={newRule.condition}
                        onChange={(e) => setNewRule((p) => ({ ...p, condition: e.target.value }))}
                        placeholder="Condition (e.g., category = 'Network')"
                        className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c] md:col-span-2"
                      />
                      <input
                        value={newRule.action}
                        onChange={(e) => setNewRule((p) => ({ ...p, action: e.target.value }))}
                        placeholder="Action (e.g., Assign to Network Team)"
                        className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c] md:col-span-2"
                      />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={addRule} className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90" style={{ backgroundColor: '#c9a87c', color: '#1f1f1f' }}>Save Rule</button>
                      <button onClick={() => setShowNewRule(false)} className="rounded-lg border border-[#e5e0d5] bg-white px-4 py-2 text-sm text-[#595959] transition-colors hover:bg-[#fbf9f4]">Cancel</button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-2">
              {rules.map((rule, idx) => (
                <motion.div
                  key={rule.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`rounded-xl border p-4 transition-colors ${rule.active ? 'border-[#e5e0d5] bg-white' : 'border-[#e5e0d5] bg-[#fbf9f4] opacity-60'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleRule(rule.id)}
                        className={`relative h-5 w-9 rounded-full transition-colors ${rule.active ? 'bg-[#c9a87c]' : 'bg-[#e5e0d5]'}`}
                      >
                        <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${rule.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-medium text-[#1f1f1f]">{rule.name}</h4>
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: `${priorityColors[rule.priority]}15`, color: priorityColors[rule.priority] }}
                          >
                            {rule.priority}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-[#595959]"><span className="text-[#8a8a8a]">IF</span> {rule.condition}</p>
                        <p className="text-xs text-[#595959]"><span className="text-[#8a8a8a]">THEN</span> {rule.action}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingRule(editingRule === rule.id ? null : rule.id); }} className="rounded p-1.5 text-[#8a8a8a] transition-colors hover:bg-[#fbf9f4]">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => deleteRule(rule.id)} className="rounded p-1.5 text-[#8a8a8a] transition-colors hover:bg-red-50">
                        <Trash2 size={14} className="text-red-400" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* --- Agent Skills --- */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {AGENT_SKILLS.map((agent) => {
                const loadPercent = (agent.current / agent.capacity) * 100;
                return (
                  <motion.div
                    key={agent.id}
                    whileHover={{ y: -2 }}
                    className="rounded-xl border border-[#e5e0d5] bg-white p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: '#c9a87c' }}>
                        {agent.avatar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-medium text-[#1f1f1f]">{agent.name}</h4>
                        <p className="text-xs text-[#8a8a8a]">Efficiency: {agent.efficiency}%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-[#1f1f1f]">{agent.current}/{agent.capacity}</p>
                        <p className="text-[10px] text-[#8a8a8a]">tickets</p>
                      </div>
                    </div>

                    {/* Workload bar */}
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[10px] text-[#8a8a8a]">
                        <span>Workload</span>
                        <span className={loadPercent > 85 ? 'text-red-500' : loadPercent > 60 ? 'text-amber-500' : 'text-green-600'}>
                          {Math.round(loadPercent)}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#e5e0d5]">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${loadPercent}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-2 rounded-full"
                          style={{ backgroundColor: loadPercent > 85 ? '#f5222d' : loadPercent > 60 ? '#faad14' : '#52c41a' }}
                        />
                      </div>
                    </div>

                    {/* Skills */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {agent.skills.map((skill) => (
                        <span key={skill} className="rounded-full bg-[#c9a87c]/10 px-2.5 py-1 text-[11px] font-medium text-[#1f1f1f]">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Workload Overview Chart */}
            <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
              <h3 className="mb-4 text-sm font-medium text-[#1f1f1f]">Team Workload Distribution</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={AGENT_SKILLS}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
                  <Bar dataKey="current" fill="#c9a87c" radius={[4, 4, 0, 0]} name="Current" />
                  <Bar dataKey="capacity" fill="#e5e0d5" radius={[4, 4, 0, 0]} name="Capacity" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* --- Routing History --- */}
        {activeTab === 'history' && (
          <div className="rounded-xl border border-[#e5e0d5] bg-white">
            <div className="border-b border-[#e5e0d5] px-5 py-3">
              <h3 className="text-sm font-medium text-[#1f1f1f]">Recent Routing Decisions</h3>
            </div>
            <div className="divide-y divide-[#e5e0d5]/50">
              {ROUTING_HISTORY.map((entry) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-[#fbf9f4]"
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${entry.method === 'auto' ? 'bg-[#c9a87c]/15' : 'bg-[#1890ff]/15'}`}>
                    {entry.method === 'auto' ? <Zap size={14} style={{ color: '#c9a87c' }} /> : <Settings size={14} style={{ color: '#1890ff' }} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#1f1f1f]">{entry.ticket}</p>
                    <p className="text-xs text-[#595959]">
                      <ArrowRight size={10} className="inline text-[#8a8a8a]" /> {entry.routedTo}
                      <span className="ml-2 text-[#8a8a8a]">{entry.reason}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: entry.method === 'auto' ? '#c9a87c15' : '#1890ff15', color: entry.method === 'auto' ? '#c9a87c' : '#1890ff' }}
                    >
                      {entry.method}
                    </span>
                    <p className="mt-0.5 text-xs text-[#8a8a8a]">{entry.time}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* --- Metrics --- */}
        {activeTab === 'metrics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
                <h3 className="mb-4 text-sm font-medium text-[#1f1f1f]">Routing Efficiency (5 Days)</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={EFFICIENCY_DATA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
                    <Area type="monotone" dataKey="accuracy" stroke="#c9a87c" fill="#c9a87c" fillOpacity={0.15} name="Accuracy %" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
                <h3 className="mb-4 text-sm font-medium text-[#1f1f1f]">Tickets by Category</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={CATEGORY_ROUTING} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {CATEGORY_ROUTING.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricCard icon={TrendingUp} label="Auto vs Manual" value="89%" sub="auto-routed" />
              <MetricCard icon={Target} label="Skill Match" value="93%" sub="avg accuracy" />
              <MetricCard icon={Clock} label="Avg Assignment" value="12s" sub="response time" />
              <MetricCard icon={Users} label="Balanced Load" value="Yes" sub="within 15%" />
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Route; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon size={16} style={{ color }} />
        <span className="text-xs text-[#595959]">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-[#1f1f1f]">{value}</p>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub }: { icon: typeof TrendingUp; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white p-4 text-center">
      <Icon size={18} className="mx-auto mb-2" style={{ color: '#c9a87c' }} />
      <p className="text-xl font-bold text-[#1f1f1f]">{value}</p>
      <p className="text-xs text-[#1f1f1f]">{label}</p>
      <p className="text-[10px] text-[#8a8a8a]">{sub}</p>
    </div>
  );
}
