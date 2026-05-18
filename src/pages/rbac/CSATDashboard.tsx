/**
 * CSAT Dashboard — Customer satisfaction analytics with overall score,
 * NPS gauge, rating distribution, agent rankings, and trend charts.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Star,
  TrendingUp,
  Users,
  MessageSquare,
  Trophy,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const FEEDBACK_DATA = [
  { id: 1, ticketId: 'T-1042', rating: 5, comment: 'Amazing support! John was incredibly helpful and resolved my issue within minutes.', customer: 'Alice Johnson', date: '2024-12-04', agent: 'John Doe' },
  { id: 2, ticketId: 'T-1038', rating: 4, comment: 'Good response time, but had to follow up once. Overall satisfied.', customer: 'Bob Smith', date: '2024-12-04', agent: 'Sarah Chen' },
  { id: 3, ticketId: 'T-1035', rating: 5, comment: 'Sarah went above and beyond. Really appreciate the detailed explanation.', customer: 'Carol White', date: '2024-12-03', agent: 'Sarah Chen' },
  { id: 4, ticketId: 'T-1031', rating: 3, comment: 'Took longer than expected, but issue was eventually resolved.', customer: 'Dan Brown', date: '2024-12-03', agent: 'Mike Ross' },
  { id: 5, ticketId: 'T-1028', rating: 2, comment: 'Had to explain my issue multiple times. Frustrating experience.', customer: 'Eve Davis', date: '2024-12-02', agent: 'David Kim' },
  { id: 6, ticketId: 'T-1025', rating: 5, comment: 'Quick and efficient. Emily knew exactly what the problem was.', customer: 'Frank Miller', date: '2024-12-02', agent: 'Emily Wang' },
  { id: 7, ticketId: 'T-1022', rating: 4, comment: 'Satisfactory resolution. Communication could have been better.', customer: 'Grace Lee', date: '2024-12-01', agent: 'John Doe' },
  { id: 8, ticketId: 'T-1019', rating: 5, comment: 'Perfect service! The follow-up was a nice touch.', customer: 'Henry Wilson', date: '2024-12-01', agent: 'Sarah Chen' },
  { id: 9, ticketId: 'T-1015', rating: 1, comment: 'Very disappointed. Waited 3 days with no response.', customer: 'Ivy Taylor', date: '2024-11-30', agent: 'David Kim' },
  { id: 10, ticketId: 'T-1012', rating: 4, comment: 'Solid support experience. Would recommend.', customer: 'Jack Anderson', date: '2024-11-30', agent: 'Mike Ross' },
];

const AGENT_CSAT = [
  { name: 'Sarah Chen', avgRating: 4.7, responses: 45, trend: '+0.3' },
  { name: 'Emily Wang', avgRating: 4.5, responses: 38, trend: '+0.1' },
  { name: 'John Doe', avgRating: 4.3, responses: 52, trend: '-0.1' },
  { name: 'Mike Ross', avgRating: 3.8, responses: 41, trend: '+0.2' },
  { name: 'David Kim', avgRating: 3.2, responses: 29, trend: '-0.4' },
];

const RATING_DISTRIBUTION = [
  { rating: '5 stars', count: 142, color: '#52c41a' },
  { rating: '4 stars', count: 89, color: '#c9a87c' },
  { rating: '3 stars', count: 34, color: '#faad14' },
  { rating: '2 stars', count: 18, color: '#ff7a45' },
  { rating: '1 star', count: 12, color: '#f5222d' },
];

const TREND_DATA = [
  { week: 'W1', csat: 4.1, nps: 42 },
  { week: 'W2', csat: 4.2, nps: 45 },
  { week: 'W3', csat: 4.0, nps: 38 },
  { week: 'W4', csat: 4.3, nps: 50 },
  { week: 'W5', csat: 4.3, nps: 52 },
  { week: 'W6', csat: 4.5, nps: 58 },
  { week: 'W7', csat: 4.4, nps: 55 },
  { week: 'W8', csat: 4.6, nps: 62 },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function calculateNPS(ratings: number[]): number {
  const promoters = ratings.filter((r) => r >= 4).length;
  const detractors = ratings.filter((r) => r <= 2).length;
  const total = ratings.length;
  if (total === 0) return 0;
  return Math.round(((promoters - detractors) / total) * 100);
}

function StarDisplay({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const starSizes = { sm: 'w-3 h-3', md: 'w-4 h-4', lg: 'w-6 h-6' };
  const s = starSizes[size];
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={s}
          style={{
            color: i <= Math.round(rating) ? '#faad14' : '#e5e0d5',
            fill: i <= Math.round(rating) ? '#faad14' : 'none',
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function CSATDashboard() {
  const [trendTab, setTrendTab] = useState('csat');

  const avgRating = useMemo(() => {
    const total = FEEDBACK_DATA.reduce((sum, f) => sum + f.rating, 0);
    return (total / FEEDBACK_DATA.length).toFixed(1);
  }, []);

  const npsScore = useMemo(() => calculateNPS(FEEDBACK_DATA.map((f) => f.rating)), []);

  const maxCount = Math.max(...RATING_DISTRIBUTION.map((r) => r.count));

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
          <Star className="w-6 h-6" style={{ color: '#c9a87c' }} />
          Customer Satisfaction
        </h1>
        <p className="text-sm mt-1" style={{ color: '#595959' }}>
          CSAT scores, NPS metrics, and feedback analytics
        </p>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* CSAT Score */}
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <Card className="text-center" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
            <CardContent className="p-5">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Star className="w-5 h-5" style={{ color: '#faad14', fill: '#faad14' }} />
                <span className="text-sm font-medium" style={{ color: '#595959' }}>CSAT Score</span>
              </div>
              <div className="text-4xl font-bold text-[#1f1f1f]">{avgRating}</div>
              <div className="flex items-center justify-center mt-2">
                <StarDisplay rating={Number(avgRating)} size="sm" />
              </div>
              <p className="text-[10px] mt-2" style={{ color: '#8c8c8c' }}>Based on {FEEDBACK_DATA.length} responses</p>
            </CardContent>
          </Card>
        </motion.div>

        {/* NPS Gauge */}
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="text-center" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
            <CardContent className="p-5">
              <div className="flex items-center justify-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5" style={{ color: '#c9a87c' }} />
                <span className="text-sm font-medium" style={{ color: '#595959' }}>Net Promoter Score</span>
              </div>
              <div className="relative inline-flex items-center justify-center mt-1">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="35" fill="none" stroke="#e5e0d5" strokeWidth="8" />
                  <circle
                    cx="40"
                    cy="40"
                    r="35"
                    fill="none"
                    stroke={npsScore >= 50 ? '#52c41a' : npsScore >= 0 ? '#faad14' : '#f5222d'}
                    strokeWidth="8"
                    strokeDasharray={`${Math.max(0, Math.min(100, (npsScore + 100) / 2)) * 2.2} 220`}
                    strokeLinecap="round"
                    transform="rotate(-90 40 40)"
                  />
                </svg>
                <span className="absolute text-xl font-bold text-[#1f1f1f]">{npsScore}</span>
              </div>
              <p className="text-[10px] mt-2" style={{ color: npsScore >= 50 ? '#52c41a' : npsScore >= 0 ? '#faad14' : '#f5222d' }}>
                {npsScore >= 50 ? 'Excellent' : npsScore >= 0 ? 'Good' : 'Needs Improvement'}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Response Count */}
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="text-center" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
            <CardContent className="p-5">
              <div className="flex items-center justify-center gap-2 mb-2">
                <MessageSquare className="w-5 h-5" style={{ color: '#1890ff' }} />
                <span className="text-sm font-medium" style={{ color: '#595959' }}>Total Feedback</span>
              </div>
              <div className="text-4xl font-bold text-[#1f1f1f]">{FEEDBACK_DATA.length}</div>
              <p className="text-[10px] mt-2" style={{ color: '#8c8c8c' }}>This month</p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Response Rate */}
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="text-center" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
            <CardContent className="p-5">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Users className="w-5 h-5" style={{ color: '#722ed1' }} />
                <span className="text-sm font-medium" style={{ color: '#595959' }}>Response Rate</span>
              </div>
              <div className="text-4xl font-bold text-[#1f1f1f]">68%</div>
              <p className="text-[10px] mt-2" style={{ color: '#8c8c8c' }}>Of resolved tickets</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Middle Row: Rating Distribution + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Rating Distribution */}
        <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
              <Star className="w-4 h-4" style={{ color: '#c9a87c' }} />
              Rating Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {RATING_DISTRIBUTION.map((item) => (
                <div key={item.rating} className="flex items-center gap-3">
                  <span className="text-xs w-14 text-right text-[#595959]">{item.rating}</span>
                  <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: '#f5f0e8' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.count / maxCount) * 100}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="h-full rounded-full flex items-center justify-end pr-2"
                      style={{ background: item.color }}
                    >
                      <span className="text-[10px] font-medium text-white">{item.count}</span>
                    </motion.div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Trend Chart */}
        <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
              <TrendingUp className="w-4 h-4" style={{ color: '#c9a87c' }} />
              Trend Over Time
            </CardTitle>
            <Tabs value={trendTab} onValueChange={setTrendTab}>
              <TabsList className="h-7 rounded-md" style={{ background: '#f5f0e8' }}>
                <TabsTrigger value="csat" className="text-[10px] h-6 rounded data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">CSAT</TabsTrigger>
                <TabsTrigger value="nps" className="text-[10px] h-6 rounded data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">NPS</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={TREND_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d5" />
                <XAxis dataKey="week" tick={{ fill: '#595959', fontSize: 11 }} />
                <YAxis domain={trendTab === 'csat' ? [3.5, 5] : [30, 70]} tick={{ fill: '#595959', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e0d5', background: '#fff' }} />
                <Line
                  type="monotone"
                  dataKey={trendTab}
                  name={trendTab === 'csat' ? 'CSAT Rating' : 'NPS Score'}
                  stroke="#c9a87c"
                  strokeWidth={2.5}
                  dot={{ fill: '#c9a87c', r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row: Agent Rankings + Recent Feedback */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent CSAT Rankings */}
        <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
              <Trophy className="w-4 h-4" style={{ color: '#c9a87c' }} />
              Agent CSAT Rankings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {AGENT_CSAT.sort((a, b) => b.avgRating - a.avgRating).map((agent, idx) => (
                <motion.div
                  key={agent.name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.06 }}
                  className="flex items-center gap-3 p-3 rounded-lg"
                  style={{ background: idx === 0 ? '#fffbe6' : '#fbf9f4', border: idx === 0 ? '1px solid #ffe58f' : '1px solid transparent' }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      background: idx === 0 ? '#faad14' : idx === 1 ? '#d9d9d9' : idx === 2 ? '#c9a87c' : '#f5f0e8',
                      color: idx < 3 ? '#fff' : '#8c8c8c',
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#1f1f1f]">{agent.name}</span>
                      {idx === 0 && <Badge style={{ background: '#faad1420', color: '#faad14', border: 'none' }} className="text-[9px]">Top Rated</Badge>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StarDisplay rating={agent.avgRating} size="sm" />
                      <span className="text-xs font-semibold text-[#1f1f1f]">{agent.avgRating.toFixed(1)}</span>
                      <span className="text-[10px]" style={{ color: '#8c8c8c' }}>({agent.responses} responses)</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className="text-xs font-medium"
                      style={{ color: agent.trend.startsWith('+') ? '#52c41a' : '#f5222d' }}
                    >
                      {agent.trend}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Feedback */}
        <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
              <MessageSquare className="w-4 h-4" style={{ color: '#c9a87c' }} />
              Recent Feedback
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {FEEDBACK_DATA.slice(0, 8).map((fb) => (
                <div key={fb.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: '#fbf9f4' }}>
                  <div className="flex-shrink-0 mt-0.5">
                    <StarDisplay rating={fb.rating} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-[#1f1f1f]">{fb.ticketId}</span>
                      <span className="text-[10px]" style={{ color: '#8c8c8c' }}>{fb.date}</span>
                    </div>
                    <p className="text-xs mt-0.5 line-clamp-2" style={{ color: '#595959' }}>
                      "{fb.comment}"
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px]" style={{ color: '#8c8c8c' }}>by {fb.customer}</span>
                      <span className="text-[10px]" style={{ color: '#c9a87c' }}>• {fb.agent}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
