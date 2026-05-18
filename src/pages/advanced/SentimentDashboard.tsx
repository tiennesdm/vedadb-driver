/**
 * SentimentDashboard — Real-time sentiment monitoring
 * Sentiment distribution, trends, negative ticket alerts, agent/category breakdown
 * Route: /sentiment
 */
import { useState } from 'react';
import {
  AlertTriangle, Bell
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from 'recharts';
import { SentimentDot } from '@/components/advanced/SentimentBadge';
import type { SentimentType } from '@/components/advanced/SentimentBadge';

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const SENTIMENT_DISTRIBUTION = [
  { name: 'Positive', value: 342, color: '#52c41a' },
  { name: 'Neutral', value: 89, color: '#8a8a8a' },
  { name: 'Negative', value: 71, color: '#faad14' },
];

const TREND_DATA = Array.from({ length: 30 }, (_, i) => ({
  date: `Jun ${i + 1}`,
  positive: 10 + Math.floor(Math.random() * 8),
  neutral: 3 + Math.floor(Math.random() * 5),
  negative: 1 + Math.floor(Math.random() * 6),
}));

const NEGATIVE_TICKETS = [
  { id: 1021, customer: 'Alice Johnson', subject: 'VPN keeps disconnecting', sentiment: 'negative' as SentimentType, score: -0.72, agent: 'Sarah Agent', time: '10 min ago', priority: 'high' },
  { id: 1019, customer: 'Bob Smith', subject: 'Printer not working for 3 days', sentiment: 'negative' as SentimentType, score: -0.68, agent: 'Mike Support', time: '25 min ago', priority: 'medium' },
  { id: 1015, customer: 'Carol White', subject: 'Account locked again', sentiment: 'negative' as SentimentType, score: -0.85, agent: 'Lisa Help', time: '1 hour ago', priority: 'high' },
  { id: 1012, customer: 'David Lee', subject: 'Slow response on critical issue', sentiment: 'negative' as SentimentType, score: -0.55, agent: 'Sarah Agent', time: '2 hours ago', priority: 'high' },
  { id: 1008, customer: 'Emma Brown', subject: 'Software license expired', sentiment: 'negative' as SentimentType, score: -0.45, agent: 'Tom Desk', time: '3 hours ago', priority: 'medium' },
];

const AGENT_SENTIMENT = [
  { agent: 'Sarah Agent', positive: 45, neutral: 12, negative: 8, avgScore: 0.42 },
  { agent: 'Mike Support', positive: 38, neutral: 10, negative: 5, avgScore: 0.51 },
  { agent: 'Lisa Help', positive: 52, neutral: 8, negative: 6, avgScore: 0.55 },
  { agent: 'Tom Desk', positive: 28, neutral: 15, negative: 12, avgScore: 0.18 },
];

const CATEGORY_SENTIMENT = [
  { category: 'Network', positive: 35, neutral: 8, negative: 18 },
  { category: 'Hardware', positive: 28, neutral: 12, negative: 6 },
  { category: 'Software', positive: 42, neutral: 10, negative: 4 },
  { category: 'Account', positive: 55, neutral: 15, negative: 5 },
  { category: 'Security', positive: 22, neutral: 5, negative: 8 },
  { category: 'Email', positive: 30, neutral: 8, negative: 3 },
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function SentimentDashboard() {
  const [alertThreshold, setAlertThreshold] = useState(-0.5);
  const [alertEnabled] = useState(true);
  const [filterPriority, setFilterPriority] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  const filteredNegative = NEGATIVE_TICKETS.filter((t) => filterPriority === 'all' || t.priority === filterPriority);
  const totalTickets = SENTIMENT_DISTRIBUTION.reduce((s, d) => s + d.value, 0);
  const avgSentiment = (SENTIMENT_DISTRIBUTION[0].value * 1 + SENTIMENT_DISTRIBUTION[1].value * 0 + SENTIMENT_DISTRIBUTION[2].value * -1) / totalTickets;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-medium text-[#1f1f1f]">Sentiment Monitoring</h2>
          <p className="mt-0.5 text-sm text-[#595959]">Real-time analysis of customer sentiment across tickets</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-center">
            <p className="text-xs text-[#8a8a8a]">Avg Sentiment</p>
            <p className={`text-lg font-bold ${avgSentiment > 0 ? 'text-green-600' : avgSentiment < 0 ? 'text-amber-500' : 'text-[#8a8a8a]'}`}>
              {avgSentiment > 0 ? '+' : ''}{avgSentiment.toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-center">
            <p className="text-xs text-[#8a8a8a]">Negative Alerts</p>
            <p className="text-lg font-bold text-red-500">{NEGATIVE_TICKETS.length}</p>
          </div>
        </div>
      </div>

      {/* Sentiment Distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pie Chart */}
        <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
          <h3 className="mb-4 text-sm font-medium text-[#1f1f1f]">Sentiment Distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={SENTIMENT_DISTRIBUTION}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={4}
                dataKey="value"
              >
                {SENTIMENT_DISTRIBUTION.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex justify-center gap-4">
            {SENTIMENT_DISTRIBUTION.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-xs text-[#595959]">{s.name} ({s.value})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trend Chart */}
        <div className="lg:col-span-2 rounded-xl border border-[#e5e0d5] bg-white p-5">
          <h3 className="mb-4 text-sm font-medium text-[#1f1f1f]">Sentiment Trend (30 Days)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={TREND_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
              <Line type="monotone" dataKey="positive" stroke="#52c41a" strokeWidth={2} dot={false} name="Positive" />
              <Line type="monotone" dataKey="neutral" stroke="#8a8a8a" strokeWidth={2} dot={false} name="Neutral" />
              <Line type="monotone" dataKey="negative" stroke="#faad14" strokeWidth={2} dot={false} name="Negative" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Negative Tickets Alert */}
      <div className="rounded-xl border border-red-200 bg-red-50/50">
        <div className="flex items-center justify-between border-b border-red-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <h3 className="text-sm font-medium text-red-800">Most Negative Tickets</h3>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">{NEGATIVE_TICKETS.length} flagged</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as any)}
              className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-800 outline-none"
            >
              <option value="all">All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
            </select>
          </div>
        </div>
        <div className="divide-y divide-red-100">
          {filteredNegative.map((ticket) => (
            <motion.div
              key={ticket.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-4 px-5 py-3"
            >
              <SentimentDot sentiment={ticket.sentiment} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#1f1f1f]">#{ticket.id}</span>
                  <span className="truncate text-sm text-[#1f1f1f]">{ticket.subject}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-[#8a8a8a]">
                  <span>{ticket.customer}</span>
                  <span>Agent: {ticket.agent}</span>
                  <span>{ticket.time}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-red-500">{ticket.score.toFixed(2)}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: ticket.priority === 'high' ? '#f5222d15' : '#faad1415',
                    color: ticket.priority === 'high' ? '#f5222d' : '#faad14',
                  }}
                >
                  {ticket.priority}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Agent & Category Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* By Agent */}
        <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
          <h3 className="mb-4 text-sm font-medium text-[#1f1f1f]">Sentiment by Agent</h3>
          <div className="space-y-3">
            {AGENT_SENTIMENT.map((a) => (
              <div key={a.agent} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#1f1f1f]">{a.agent}</span>
                  <span className={`text-xs font-medium ${a.avgScore > 0.3 ? 'text-green-600' : 'text-amber-500'}`}>
                    avg {a.avgScore > 0 ? '+' : ''}{a.avgScore.toFixed(2)}
                  </span>
                </div>
                <div className="flex h-5 overflow-hidden rounded-full">
                  <div style={{ width: `${(a.positive / (a.positive + a.neutral + a.negative)) * 100}%`, backgroundColor: '#52c41a' }} />
                  <div style={{ width: `${(a.neutral / (a.positive + a.neutral + a.negative)) * 100}%`, backgroundColor: '#8a8a8a' }} />
                  <div style={{ width: `${(a.negative / (a.positive + a.neutral + a.negative)) * 100}%`, backgroundColor: '#faad14' }} />
                </div>
                <div className="flex gap-3 text-[10px] text-[#8a8a8a]">
                  <span className="text-green-600">{a.positive} pos</span>
                  <span>{a.neutral} neu</span>
                  <span className="text-amber-500">{a.negative} neg</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Category */}
        <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
          <h3 className="mb-4 text-sm font-medium text-[#1f1f1f]">Sentiment by Category</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={CATEGORY_SENTIMENT} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={70} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
              <Bar dataKey="positive" stackId="a" fill="#52c41a" radius={[0, 4, 4, 0]} name="Positive" />
              <Bar dataKey="neutral" stackId="a" fill="#8a8a8a" name="Neutral" />
              <Bar dataKey="negative" stackId="a" fill="#faad14" name="Negative" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Alert Configuration */}
      <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Bell size={16} style={{ color: '#c9a87c' }} />
          <h3 className="text-sm font-medium text-[#1f1f1f]">Alert Configuration</h3>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex cursor-pointer items-center gap-2">
            <div className={`relative h-5 w-9 rounded-full transition-colors ${alertEnabled ? 'bg-[#c9a87c]' : 'bg-[#e5e0d5]'}`}>
              <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${alertEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-[#1f1f1f]">Enable negative sentiment alerts</span>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[#595959]">Alert threshold:</span>
            <input
              type="range"
              min={-1}
              max={0}
              step={0.1}
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(parseFloat(e.target.value))}
              className="w-32 accent-[#c9a87c]"
              disabled={!alertEnabled}
            />
            <span className="text-sm font-medium text-red-500">{alertThreshold.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#595959]">Notify:</span>
            <select className="rounded-md border border-[#e5e0d5] bg-[#fbf9f4] px-2 py-1 text-sm outline-none focus:border-[#c9a87c]">
              <option>All Managers</option>
              <option>Assigned Agent</option>
              <option>Both</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
