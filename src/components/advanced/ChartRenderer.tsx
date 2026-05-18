/**
 * ChartRenderer - Renders different chart types using Recharts
 */
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

const CHART_COLORS = [
  '#c9a87c',
  '#8b7355',
  '#d4b896',
  '#a08b6c',
  '#e5c9a0',
  '#6b5b45',
  '#f0d4a8',
  '#5a4a35',
];

export interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: any;
}

interface ChartRendererProps {
  type: 'table' | 'bar' | 'line' | 'pie' | 'donut';
  data: ChartDataPoint[];
  columns?: string[];
  valueKey?: string;
  nameKey?: string;
}

export default function ChartRenderer({
  type,
  data,
  columns = [],
  valueKey = 'value',
}: ChartRendererProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-[#8a8a8a]">
        No data to display. Configure your report and click Preview.
      </div>
    );
  }

  if (type === 'table') {
    const displayCols = columns.length > 0 ? columns : Object.keys(data[0]);
    return (
      <ScrollArea className="h-[400px]">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-[#e5e0d5]">
              {displayCols.map((col) => (
                <TableHead key={col} className="text-xs text-[#8a8a8a] capitalize">
                  {col.replace(/_/g, ' ')}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, idx) => (
              <TableRow key={idx} className="border-b border-[#f0ece3]">
                {displayCols.map((col) => (
                  <TableCell key={col} className="text-xs text-[#595959]">
                    {row[col] ?? '-'}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    );
  }

  if (type === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ece3" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8a8a8a' }} />
          <YAxis tick={{ fontSize: 12, fill: '#8a8a8a' }} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e0d5',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Bar dataKey={valueKey} fill="#c9a87c" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ece3" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8a8a8a' }} />
          <YAxis tick={{ fontSize: 12, fill: '#8a8a8a' }} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e0d5',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke="#c9a87c"
            strokeWidth={2}
            dot={{ fill: '#c9a87c', r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'pie' || type === 'donut') {
    const isDonut = type === 'donut';
    return (
      <ResponsiveContainer width="100%" height={350}>
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={120}
            innerRadius={isDonut ? 60 : 0}
            paddingAngle={2}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e0d5',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return null;
}
