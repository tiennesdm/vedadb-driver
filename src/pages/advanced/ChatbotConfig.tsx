/**
 * ChatbotConfig — Virtual Agent / Chatbot configuration
 * Intent management, training phrases, response configuration, analytics
 * Route: /chatbot
 */
import { useState } from 'react';
import {
  Bot, TrendingUp, MessageSquare, ArrowUpRight, Users, Brain,
  Activity, Play, Pause, Settings, BarChart3
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import ChatbotDesigner, { type Intent } from '@/components/advanced/ChatbotDesigner';
import ChatWindow from '@/components/advanced/ChatWindow';
import AIConfidenceMeter from '@/components/advanced/AIConfidenceMeter';

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_INTENTS: Intent[] = [
  {
    id: 'intent-1', name: 'Password Reset', trainingPhrases: [
      'I forgot my password', 'reset password', 'cannot login', 'password expired',
      'forgot credentials', 'need new password', 'locked out of account',
    ], responseType: 'kb_article', responseText: '', kbArticleId: 'password-reset-guide', confidence: 0.92,
  },
  {
    id: 'intent-2', name: 'VPN Help', trainingPhrases: [
      'VPN not working', 'cannot connect to VPN', 'VPN error', 'remote access issue',
      'VPN keeps disconnecting', 'need VPN access',
    ], responseType: 'text', responseText: 'Please try: 1) Restart the VPN client 2) Check your connection 3) Clear DNS cache. If the issue persists, I can escalate to an agent.', confidence: 0.88,
  },
  {
    id: 'intent-3', name: 'Printer Issue', trainingPhrases: [
      'printer not working', 'cannot print', 'paper jam', 'printer offline',
      'print quality is bad', 'printer error',
    ], responseType: 'escalate', responseText: 'I will connect you with the IT support team for printer assistance.', confidence: 0.85,
  },
  {
    id: 'intent-4', name: 'Software Install', trainingPhrases: [
      'install software', 'need application', 'download program', 'software request',
      'install license', 'app not installed',
    ], responseType: 'text', responseText: 'You can request software through the self-service portal. Go to Services > Software Installation and fill out the form.', confidence: 0.80,
  },
  {
    id: 'intent-5', name: 'Account Unlock', trainingPhrases: [
      'account locked', 'user locked out', 'cannot access account', 'account disabled',
      'unlock my account', 'account suspended',
    ], responseType: 'escalate', responseText: 'I am escalating this to an agent who can unlock your account.', confidence: 0.90,
  },
];

const CONVERSATION_LOGS = [
  { id: 1, customer: 'Alice J.', intent: 'Password Reset', confidence: 0.95, result: 'resolved', time: '2 min ago' },
  { id: 2, customer: 'Bob S.', intent: 'VPN Help', confidence: 0.88, result: 'escalated', time: '5 min ago' },
  { id: 3, customer: 'Carol W.', intent: 'Printer Issue', confidence: 0.82, result: 'escalated', time: '12 min ago' },
  { id: 4, customer: 'David L.', intent: 'Password Reset', confidence: 0.97, result: 'resolved', time: '18 min ago' },
  { id: 5, customer: 'Emma B.', intent: 'Software Install', confidence: 0.79, result: 'resolved', time: '25 min ago' },
  { id: 6, customer: 'Frank M.', intent: 'VPN Help', confidence: 0.91, result: 'resolved', time: '32 min ago' },
];

const HOURLY_DATA = Array.from({ length: 24 }, (_, i) => ({
  hour: `${i}:00`,
  conversations: Math.floor(Math.random() * 20) + 5,
  escalations: Math.floor(Math.random() * 8) + 1,
}));

const WEEKLY_DATA = [
  { day: 'Mon', handled: 45, escalated: 8 },
  { day: 'Tue', handled: 52, escalated: 6 },
  { day: 'Wed', handled: 38, escalated: 12 },
  { day: 'Thu', handled: 61, escalated: 9 },
  { day: 'Fri', handled: 55, escalated: 7 },
  { day: 'Sat', handled: 22, escalated: 3 },
  { day: 'Sun', handled: 18, escalated: 2 },
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'designer', label: 'Intent Designer', icon: Settings },
  { id: 'test', label: 'Test Bot', icon: Play },
  { id: 'logs', label: 'Conversation Logs', icon: MessageSquare },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

export default function ChatbotConfig() {
  const [intents, setIntents] = useState<Intent[]>(INITIAL_INTENTS);
  const [activeTab, setActiveTab] = useState('designer');
  const [globalThreshold, setGlobalThreshold] = useState(0.75);
  const [isBotActive, setIsBotActive] = useState(true);

  const resolvedCount = CONVERSATION_LOGS.filter((l) => l.result === 'resolved').length;
  const escalationRate = Math.round(((CONVERSATION_LOGS.length - resolvedCount) / CONVERSATION_LOGS.length) * 100);
  const avgConfidence = Math.round((CONVERSATION_LOGS.reduce((s, l) => s + l.confidence, 0) / CONVERSATION_LOGS.length) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#c9a87c' }}>
            <Bot size={20} className="text-[#1f1f1f]" />
          </div>
          <div>
            <h2 className="text-xl font-medium text-[#1f1f1f]">Virtual Agent Configuration</h2>
            <p className="text-sm text-[#595959]">Configure intents, responses, and monitor bot performance</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${isBotActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {isBotActive ? <Play size={12} /> : <Pause size={12} />}
            {isBotActive ? 'Active' : 'Paused'}
          </span>
          <button
            onClick={() => setIsBotActive(!isBotActive)}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: isBotActive ? '#f5222d' : '#c9a87c', color: '#fff' }}
          >
            {isBotActive ? 'Pause Bot' : 'Activate Bot'}
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={MessageSquare} label="Conversations Today" value="273" trend="+12%" />
        <StatCard icon={ArrowUpRight} label="Escalation Rate" value={`${escalationRate}%`} trend="-3%" negative />
        <StatCard icon={Brain} label="Avg Confidence" value={`${avgConfidence}%`} trend="+5%" />
        <StatCard icon={Users} label="Intents Configured" value={String(intents.length)} trend="+2" />
      </div>

      {/* Global Confidence Threshold */}
      <div className="flex items-center gap-4 rounded-xl border border-[#e5e0d5] bg-white px-5 py-4">
        <AIConfidenceMeter confidence={globalThreshold} size={80} showLabel={false} />
        <div className="flex-1">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium text-[#1f1f1f]">Global Confidence Threshold</label>
            <span className="text-sm font-bold" style={{ color: '#c9a87c' }}>{Math.round(globalThreshold * 100)}%</span>
          </div>
          <p className="mb-2 text-xs text-[#595959]">Conversations below this threshold will be escalated to a human agent</p>
          <input
            type="range"
            min={0.5}
            max={0.99}
            step={0.01}
            value={globalThreshold}
            onChange={(e) => setGlobalThreshold(parseFloat(e.target.value))}
            className="w-full accent-[#c9a87c]"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-[#e5e0d5] bg-white p-1">
        {TABS.map((tab) => {
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
        {activeTab === 'designer' && <ChatbotDesigner intents={intents} onIntentsChange={setIntents} />}

        {activeTab === 'test' && (
          <div className="flex items-start justify-center gap-8 py-8">
            <ChatWindow />
            <div className="w-64 space-y-3 rounded-xl border border-[#e5e0d5] bg-white p-4">
              <h4 className="text-sm font-medium text-[#1f1f1f]">Test Controls</h4>
              <p className="text-xs text-[#595959]">Type messages in the chat window to test bot responses.</p>
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#1f1f1f]">Try these test phrases:</p>
                {['I forgot my password', 'VPN not working', 'printer issue', 'install software'].map((phrase) => (
                  <div key={phrase} className="rounded-md bg-[#fbf9f4] px-2 py-1.5 text-xs text-[#595959]">{phrase}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="rounded-xl border border-[#e5e0d5] bg-white">
            <div className="border-b border-[#e5e0d5] px-4 py-3">
              <h3 className="text-sm font-medium text-[#1f1f1f]">Recent Conversations</h3>
            </div>
            <div className="divide-y divide-[#e5e0d5]/50">
              {CONVERSATION_LOGS.map((log) => (
                <div key={log.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c9a87c]/20 text-xs font-medium text-[#1f1f1f]">
                    {log.customer.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1f1f1f]">{log.customer}</p>
                    <p className="text-xs text-[#595959]">Intent: <span className="text-[#c9a87c]">{log.intent}</span></p>
                  </div>
                  <div className="text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${log.result === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {log.result}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-[#8a8a8a]">{log.time}</span>
                    <div className="mt-0.5 text-xs" style={{ color: '#c9a87c' }}>{Math.round(log.confidence * 100)}% confidence</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChartCard title="Hourly Conversation Volume" icon={Activity}>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={HOURLY_DATA.slice(-12)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
                    <Area type="monotone" dataKey="conversations" stroke="#c9a87c" fill="#c9a87c" fillOpacity={0.15} />
                    <Area type="monotone" dataKey="escalations" stroke="#f5222d" fill="#f5222d" fillOpacity={0.1} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Weekly Performance" icon={TrendingUp}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={WEEKLY_DATA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
                    <Bar dataKey="handled" fill="#c9a87c" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="escalated" fill="#f5222d" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
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

function StatCard({ icon: Icon, label, value, trend, negative }: { icon: typeof MessageSquare; label: string; value: string; trend: string; negative?: boolean }) {
  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon size={16} style={{ color: '#c9a87c' }} />
        <span className="text-xs text-[#595959]">{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-2xl font-bold text-[#1f1f1f]">{value}</span>
        <span className={`mb-1 text-xs font-medium ${negative ? 'text-red-500' : 'text-green-600'}`}>{trend}</span>
      </div>
    </div>
  );
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: typeof Activity; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon size={16} style={{ color: '#c9a87c' }} />
        <h4 className="text-sm font-medium text-[#1f1f1f]">{title}</h4>
      </div>
      {children}
    </div>
  );
}
