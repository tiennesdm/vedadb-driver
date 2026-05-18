/**
 * AIDashboard — AI features control panel
 * Auto-categorization, sentiment analysis, smart routing, suggested responses,
 * duplicate detection, auto-summarization, overall AI confidence
 * Route: /ai-dashboard
 */
import { useState, useMemo } from 'react';
import {
  Brain, Tag, MessageCircle, Route, Copy, FileText, Zap,
  TrendingUp, TrendingDown, AlertTriangle
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import AIConfidenceMeter from '@/components/advanced/AIConfidenceMeter';
import SentimentBadge from '@/components/advanced/SentimentBadge';
import DuplicateDetectorPanel, { type DuplicatePair } from '@/components/advanced/DuplicateDetectorPanel';
import AutoSummaryCard, { type TicketSummary } from '@/components/advanced/AutoSummaryCard';
import SuggestedResponseCard, { type SuggestedResponse } from '@/components/advanced/SuggestedResponseCard';

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIZATION_DATA = [
  { category: 'Network', total: 45, correct: 42, incorrect: 3 },
  { category: 'Hardware', total: 38, correct: 35, incorrect: 3 },
  { category: 'Software', total: 52, correct: 50, incorrect: 2 },
  { category: 'Account', total: 67, correct: 65, incorrect: 2 },
  { category: 'Security', total: 28, correct: 26, incorrect: 2 },
  { category: 'Email', total: 33, correct: 31, incorrect: 2 },
];

const ACCURACY_TREND = Array.from({ length: 14 }, (_, i) => ({
  day: `Day ${i + 1}`,
  accuracy: 85 + Math.random() * 12,
}));

const ROUTING_DATA = [
  { day: 'Mon', correct: 28, incorrect: 3 },
  { day: 'Tue', correct: 32, incorrect: 2 },
  { day: 'Wed', correct: 25, incorrect: 5 },
  { day: 'Thu', correct: 35, incorrect: 2 },
  { day: 'Fri', correct: 30, incorrect: 3 },
];

const SUGGESTION_USAGE = [
  { day: 'Mon', shown: 45, used: 32 },
  { day: 'Tue', shown: 50, used: 38 },
  { day: 'Wed', shown: 40, used: 28 },
  { day: 'Thu', shown: 55, used: 42 },
  { day: 'Fri', shown: 48, used: 35 },
];

const MOCK_SUMMARIES: TicketSummary[] = [
  {
    ticketId: 1024,
    summary: 'Customer reports intermittent VPN disconnections when using Wi-Fi. Issue appears to be related to network timeout settings. Customer has tried restarting the client without success.',
    keyPoints: ['VPN disconnects every 10-15 minutes', 'Issue only occurs on Wi-Fi', 'Client restart did not resolve', 'Works fine on wired connection'],
    sentiment: 'negative',
    estimatedResolution: '2 hours',
    confidence: 0.91,
    generatedAt: '2 min ago',
  },
  {
    ticketId: 1025,
    summary: 'Request for Adobe Creative Cloud license upgrade. Customer needs After Effects for an upcoming project deadline next week.',
    keyPoints: ['License upgrade request', 'Specifically needs After Effects', 'Project deadline is next week', 'Currently on standard plan'],
    sentiment: 'neutral',
    estimatedResolution: '1 day',
    confidence: 0.88,
    generatedAt: '5 min ago',
  },
];

const MOCK_SUGGESTIONS: SuggestedResponse[] = [
  {
    id: 's1', ticketId: 1024, source: 'kb', sourceTitle: 'VPN Troubleshooting Guide',
    responseText: 'Thank you for reporting this issue. Please try the following steps:\n\n1. Open VPN client settings\n2. Go to Connection > Advanced\n3. Increase the timeout to 300 seconds\n4. Disable "Reconnect on disconnect"\n5. Save and restart the client\n\nLet me know if this resolves the issue.',
    confidence: 0.92, relevanceScore: 0.95,
  },
  {
    id: 's2', ticketId: 1024, source: 'canned', sourceTitle: 'Network Escalation',
    responseText: 'I understand your frustration. I am going to escalate this to our Network team for deeper investigation. They will contact you within 2 hours.',
    confidence: 0.85, relevanceScore: 0.78,
  },
];

const MOCK_DUPLICATES: DuplicatePair[] = [
  {
    id: 'd1',
    ticketA: { id: 1021, title: 'VPN connection keeps dropping', status: 'open', created_at: '2024-06-15' },
    ticketB: { id: 1024, title: 'VPN disconnects frequently on WiFi', status: 'open', created_at: '2024-06-16' },
    confidence: 0.91,
    reasons: ['Similar title keywords', 'Same category (Network)', 'Same keywords in description'],
  },
  {
    id: 'd2',
    ticketA: { id: 1018, title: 'Printer not responding on floor 3', status: 'in_progress', created_at: '2024-06-14' },
    ticketB: { id: 1022, title: 'HP printer offline in marketing dept', status: 'open', created_at: '2024-06-15' },
    confidence: 0.78,
    reasons: ['Both about printer issues', 'Same department area'],
  },
];

/* ------------------------------------------------------------------ */
/*  AI Feature Toggles                                                 */
/* ------------------------------------------------------------------ */

interface AIFeature {
  id: string;
  name: string;
  description: string;
  icon: typeof Brain;
  enabled: boolean;
  statLabel: string;
  statValue: string;
  statTrend: string;
  statUp: boolean;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function AIDashboard() {
  const [features, setFeatures] = useState<AIFeature[]>([
    { id: 'categorization', name: 'Auto-Categorization', description: 'Automatically categorize incoming tickets', icon: Tag, enabled: true, statLabel: 'Accuracy', statValue: '94.2%', statTrend: '+2.1%', statUp: true },
    { id: 'sentiment', name: 'Sentiment Analysis', description: 'Analyze customer sentiment in real-time', icon: MessageCircle, enabled: true, statLabel: 'Processing', statValue: '1.2k/mo', statTrend: '+15%', statUp: true },
    { id: 'routing', name: 'Smart Routing', description: 'Route tickets to the best agent', icon: Route, enabled: true, statLabel: 'Match Rate', statValue: '91%', statTrend: '+3%', statUp: true },
    { id: 'suggestions', name: 'Suggested Responses', description: 'AI-suggested responses from KB', icon: FileText, enabled: true, statLabel: 'Usage', statValue: '72%', statTrend: '+8%', statUp: true },
    { id: 'duplicates', name: 'Duplicate Detection', description: 'Find and merge duplicate tickets', icon: Copy, enabled: true, statLabel: 'Found', statValue: '23', statTrend: '-5', statUp: false },
    { id: 'summarization', name: 'Auto-Summarization', description: 'Generate ticket summaries', icon: Zap, enabled: true, statLabel: 'Generated', statValue: '156', statTrend: '+22', statUp: true },
  ]);

  const overallConfidence = useMemo(() => {
    const enabled = features.filter((f) => f.enabled).length;
    return 0.75 + (enabled / features.length) * 0.2;
  }, [features]);

  const toggleFeature = (id: string) => {
    setFeatures((prev) => prev.map((f) => f.id === id ? { ...f, enabled: !f.enabled } : f));
  };

  const categorizationAccuracy = Math.round((CATEGORIZATION_DATA.reduce((s, d) => s + d.correct, 0) / CATEGORIZATION_DATA.reduce((s, d) => s + d.total, 0)) * 1000) / 10;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#c9a87c' }}>
            <Brain size={20} className="text-[#1f1f1f]" />
          </div>
          <div>
            <h2 className="text-xl font-medium text-[#1f1f1f]">AI Features Control Panel</h2>
            <p className="text-sm text-[#595959]">Manage and monitor AI-powered ticket processing features</p>
          </div>
        </div>
        <AIConfidenceMeter confidence={overallConfidence} size={90} label="AI Health" />
      </div>

      {/* Feature Toggles */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <motion.div
              key={feature.id}
              whileHover={{ y: -2 }}
              className={`rounded-xl border p-4 transition-all ${
                feature.enabled ? 'border-[#e5e0d5] bg-white' : 'border-[#e5e0d5] bg-[#fbf9f4] opacity-70'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${feature.enabled ? 'bg-[#c9a87c]/15' : 'bg-[#e5e0d5]'}`}>
                    <Icon size={18} style={{ color: feature.enabled ? '#c9a87c' : '#8a8a8a' }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-[#1f1f1f]">{feature.name}</h3>
                    <p className="text-xs text-[#595959]">{feature.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => toggleFeature(feature.id)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${feature.enabled ? 'bg-[#c9a87c]' : 'bg-[#e5e0d5]'}`}
                >
                  <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${feature.enabled ? 'translate-x-5.5 left-0.5' : 'left-0.5'}`}
                    style={{ transform: feature.enabled ? 'translateX(20px)' : 'translateX(2px)' }}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className="text-xs text-[#8a8a8a]">{feature.statLabel}</p>
                  <p className="text-lg font-bold text-[#1f1f1f]">{feature.statValue}</p>
                </div>
                <span className={`flex items-center gap-0.5 text-xs font-medium ${feature.statUp ? 'text-green-600' : 'text-red-500'}`}>
                  {feature.statUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {feature.statTrend}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Auto-Categorization Section */}
      <SectionCard title="Auto-Categorization" icon={Tag} action={<span className="text-sm font-bold text-[#c9a87c]">{categorizationAccuracy}% accuracy</span>}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartContainer>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={CATEGORIZATION_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
                <Bar dataKey="correct" fill="#c9a87c" radius={[4, 4, 0, 0]} name="Correct" />
                <Bar dataKey="incorrect" fill="#f5222d" radius={[4, 4, 0, 0]} name="Incorrect" />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
          <ChartContainer>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={ACCURACY_TREND}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis domain={[80, 100]} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
                <Area type="monotone" dataKey="accuracy" stroke="#c9a87c" fill="#c9a87c" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
        {/* Mis-categorization Queue */}
        <div className="mt-4 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <span className="text-xs font-medium text-[#1f1f1f]">3 tickets flagged for mis-categorization review</span>
            <button className="ml-auto text-xs text-[#1890ff] hover:underline">Review Queue</button>
          </div>
        </div>
      </SectionCard>

      {/* Sentiment Section */}
      <SectionCard title="Sentiment Analysis" icon={MessageCircle} action={
        <div className="flex gap-2">
          <SentimentBadge sentiment="positive" score={0.65} size="sm" />
          <SentimentBadge sentiment="neutral" score={0.12} size="sm" />
          <SentimentBadge sentiment="negative" score={-0.23} size="sm" />
        </div>
      }>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <SentimentStat label="Positive" count={342} percent={68} color="#52c41a" />
          <SentimentStat label="Neutral" count={89} percent={18} color="#8a8a8a" />
          <SentimentStat label="Negative" count={71} percent={14} color="#f5222d" />
        </div>
      </SectionCard>

      {/* Smart Routing */}
      <SectionCard title="Smart Ticket Routing" icon={Route} action={<span className="text-xs text-[#8a8a8a]">91% routing accuracy</span>}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartContainer>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ROUTING_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
                <Bar dataKey="correct" fill="#52c41a" radius={[4, 4, 0, 0]} name="Correct" />
                <Bar dataKey="incorrect" fill="#f5222d" radius={[4, 4, 0, 0]} name="Incorrect" />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
          <div className="space-y-3">
            {[
              { agent: 'Sarah Agent', tickets: 28, skills: ['Network', 'VPN', 'Security'], load: 85 },
              { agent: 'Mike Support', tickets: 22, skills: ['Hardware', 'Printer', 'Software'], load: 68 },
              { agent: 'Lisa Help', tickets: 18, skills: ['Email', 'Account', 'Password'], load: 55 },
              { agent: 'Tom Desk', tickets: 12, skills: ['General', 'Onboarding'], load: 38 },
            ].map((agent) => (
              <div key={agent.agent} className="flex items-center gap-3 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2">
                <div className="h-8 w-8 rounded-full bg-[#c9a87c]/20" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#1f1f1f]">{agent.agent}</p>
                  <div className="flex flex-wrap gap-1">
                    {agent.skills.map((s) => (
                      <span key={s} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-[#595959]">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-[#1f1f1f]">{agent.tickets}</p>
                  <div className="h-1.5 w-16 rounded-full bg-[#e5e0d5]">
                    <div className="h-1.5 rounded-full" style={{ width: `${agent.load}%`, backgroundColor: agent.load > 80 ? '#f5222d' : agent.load > 60 ? '#faad14' : '#52c41a' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Duplicate Detection */}
      <SectionCard title="Duplicate Detection" icon={Copy} action={<span className="text-xs text-[#8a8a8a]">{MOCK_DUPLICATES.length} potential duplicates</span>}>
        <DuplicateDetectorPanel
          pairs={MOCK_DUPLICATES}
          onMerge={(id) => console.log('Merge:', id)}
          onDismiss={(id) => console.log('Dismiss:', id)}
        />
      </SectionCard>

      {/* Auto-Summarization */}
      <SectionCard title="Auto-Summarization" icon={Zap} action={<span className="text-xs text-[#8a8a8a]">{MOCK_SUMMARIES.length} recent summaries</span>}>
        <div className="space-y-4">
          {MOCK_SUMMARIES.map((summary) => (
            <AutoSummaryCard key={summary.ticketId} summary={summary} />
          ))}
        </div>
      </SectionCard>

      {/* Suggested Responses */}
      <SectionCard title="Suggested Responses" icon={FileText} action={<span className="text-xs text-[#8a8a8a]">72% agent usage rate</span>}>
        <div className="space-y-4">
          {MOCK_SUGGESTIONS.map((s) => (
            <SuggestedResponseCard key={s.id} suggestion={s} />
          ))}
        </div>
        <ChartContainer title="Usage Over Time">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={SUGGESTION_USAGE}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', fontSize: 12 }} />
              <Area type="monotone" dataKey="shown" stroke="#8a8a8a" fill="#8a8a8a" fillOpacity={0.1} name="Shown" />
              <Area type="monotone" dataKey="used" stroke="#c9a87c" fill="#c9a87c" fillOpacity={0.15} name="Used" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SectionCard({ title, icon: Icon, action, children }: { title: string; icon: typeof Brain; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white">
      <div className="flex items-center justify-between border-b border-[#e5e0d5] px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon size={16} style={{ color: '#c9a87c' }} />
          <h3 className="text-sm font-medium text-[#1f1f1f]">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ChartContainer({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div>
      {title && <p className="mb-2 text-xs text-[#8a8a8a]">{title}</p>}
      {children}
    </div>
  );
}

function SentimentStat({ label, count, percent, color }: { label: string; count: number; percent: number; color: string }) {
  return (
    <div className="rounded-lg border border-[#e5e0d5] p-4">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-sm text-[#595959]">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold" style={{ color }}>{count}</p>
      <p className="text-xs text-[#8a8a8a]">{percent}% of tickets</p>
      <div className="mt-2 h-2 w-full rounded-full bg-[#e5e0d5]">
        <div className="h-2 rounded-full transition-all" style={{ width: `${percent}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
