/**
 * Category Distribution — Horizontal bar chart showing tickets per category
 */
import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { motion } from 'framer-motion';

interface CategoryDataPoint {
  category: string;
  count: number;
}

interface CategoryBarChartProps {
  data: CategoryDataPoint[];
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: { category: string } }> }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg bg-[#1f1f1f] px-3 py-2 shadow-lg">
      <p className="text-sm font-medium text-[#f5f5f5]">
        {entry.payload.category}: {entry.value}
      </p>
    </div>
  );
}

export default function CategoryBarChart({ data }: CategoryBarChartProps) {
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => a.count - b.count); // ascending for bottom-to-top display
  }, [data]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.6,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="rounded-xl border border-[#e5e0d5] bg-white p-6"
    >
      <h3 className="mb-4 text-lg font-medium text-[#1f1f1f]">
        Tickets by Category
      </h3>
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={sortedData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
            barSize={24}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e0d5"
              strokeOpacity={0.3}
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: '#8a8a8a' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="category"
              tick={{ fontSize: 12, fill: '#1f1f1f' }}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(201,168,124,0.05)' }} />
            <Bar
              dataKey="count"
              radius={[4, 4, 4, 4]}
              fill="#c9a87c"
              animationDuration={1000}
              animationEasing="ease-out"
              label={{
                position: 'right',
                fill: '#1f1f1f',
                fontSize: 12,
                fontWeight: 600,
                offset: 10,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
