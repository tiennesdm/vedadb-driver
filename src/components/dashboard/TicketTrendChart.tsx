/**
 * Ticket Trend Line Chart — 30-day ticket volume (created vs resolved)
 */
import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
} from 'recharts';
import { motion } from 'framer-motion';

interface TrendDataPoint {
  date: string;
  created: number;
  resolved: number;
}

interface TicketTrendChartProps {
  data: TrendDataPoint[];
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-[#1f1f1f] px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-[#8a8a8a]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-sm font-medium text-[#f5f5f5]">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.dataKey === 'created' ? 'Created' : 'Resolved'}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export default function TicketTrendChart({ data }: TicketTrendChartProps) {
  const formattedData = useMemo(() => {
    return data.map((d) => ({
      ...d,
      shortDate: new Date(d.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
    }));
  }, [data]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.3,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="rounded-xl border border-[#e5e0d5] bg-white p-6"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#1f1f1f]">Ticket Volume</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#c9a87c]" />
            <span className="text-xs text-[#595959]">Created</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#52c41a]" />
            <span className="text-xs text-[#595959]">Resolved</span>
          </div>
        </div>
      </div>
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={formattedData}
            margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
          >
            <defs>
              <linearGradient id="createdGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#c9a87c" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#c9a87c" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="resolvedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#52c41a" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#52c41a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e0d5"
              strokeOpacity={0.5}
              vertical={false}
            />
            <XAxis
              dataKey="shortDate"
              tick={{ fontSize: 11, fill: '#8a8a8a' }}
              axisLine={{ stroke: '#e5e0d5' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#8a8a8a' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="created"
              fill="url(#createdGradient)"
              stroke="none"
            />
            <Area
              type="monotone"
              dataKey="resolved"
              fill="url(#resolvedGradient)"
              stroke="none"
            />
            <Line
              type="monotone"
              dataKey="created"
              stroke="#c9a87c"
              strokeWidth={2}
              dot={{ r: 3, fill: '#c9a87c', strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#c9a87c', strokeWidth: 2, stroke: '#fff' }}
              animationDuration={1500}
              animationEasing="ease-out"
            />
            <Line
              type="monotone"
              dataKey="resolved"
              stroke="#52c41a"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: '#52c41a', strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#52c41a', strokeWidth: 2, stroke: '#fff' }}
              animationDuration={1500}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
