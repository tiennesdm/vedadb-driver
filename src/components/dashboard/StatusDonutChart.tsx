/**
 * Status Distribution Donut Chart — Ticket breakdown by status
 */
import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { motion } from 'framer-motion';

interface StatusDataPoint {
  name: string;
  value: number;
  color: string;
}

interface StatusDonutChartProps {
  data: StatusDataPoint[];
  total: number;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
  on_hold: 'On Hold',
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { color: string } }> }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const label = STATUS_LABELS[entry.name] || entry.name;
  return (
    <div className="rounded-lg bg-[#1f1f1f] px-3 py-2 shadow-lg">
      <p className="text-sm font-medium text-[#f5f5f5]">
        <span
          className="mr-1 inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: entry.payload.color }}
        />
        {label}: {entry.value}
      </p>
    </div>
  );
}

export default function StatusDonutChart({ data, total }: StatusDonutChartProps) {
  const validData = useMemo(() => data.filter((d) => d.value > 0), [data]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.4,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="rounded-xl border border-[#e5e0d5] bg-white p-6"
    >
      <h3 className="mb-4 text-lg font-medium text-[#1f1f1f]">By Status</h3>
      <div className="relative h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={validData}
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="80%"
              paddingAngle={3}
              dataKey="value"
              animationBegin={0}
              animationDuration={800}
              animationEasing="ease-out"
            >
              {validData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-[#1f1f1f]">{total}</span>
          <span className="text-xs uppercase tracking-[0.1em] text-[#595959]">
            Total
          </span>
        </div>
      </div>
      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        {validData.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-xs text-[#595959]">
              {STATUS_LABELS[entry.name] || entry.name}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
