/**
 * ChangeCalendar — Calendar view for scheduled changes
 */
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useState, useMemo } from 'react';

export interface CalendarChange {
  id: number;
  title: string;
  scheduled_date: string;
  type: 'Standard' | 'Normal' | 'Emergency';
  status: string;
  risk_level: string;
}

const TYPE_COLORS: Record<string, string> = {
  'Standard': '#52c41a',
  'Normal': '#1890ff',
  'Emergency': '#f5222d',
};

export default function ChangeCalendar({ changes }: { changes: CalendarChange[] }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const changesByDate = useMemo(() => {
    const map: Record<string, CalendarChange[]> = {};
    changes.forEach((c) => {
      const d = c.scheduled_date.split('T')[0];
      if (!map[d]) map[d] = [];
      map[d].push(c);
    });
    return map;
  }, [changes]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const cells: { day: number | null; dateStr: string }[] = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, dateStr: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateStr });
  }

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white">
      <div className="flex items-center justify-between border-b border-[#e5e0d5] px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="text-[#c9a87c]" />
          <h3 className="text-sm font-semibold text-[#1f1f1f]">Change Calendar</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg p-1.5 hover:bg-[#f5f0e8] text-[#595959]">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium text-[#1f1f1f] min-w-[120px] text-center">
            {monthNames[month]} {year}
          </span>
          <button onClick={nextMonth} className="rounded-lg p-1.5 hover:bg-[#f5f0e8] text-[#595959]">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-[#e5e0d5]">
        {dayLabels.map((d) => (
          <div key={d} className="bg-[#fbf9f4] px-2 py-1.5 text-center text-[10px] font-semibold text-[#595959] uppercase">
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          const dayChanges = cell.dateStr ? (changesByDate[cell.dateStr] || []) : [];
          const isToday = cell.dateStr === todayStr;

          return (
            <div
              key={i}
              className={`min-h-[80px] bg-white p-1.5 transition-colors hover:bg-[#fbf9f4] ${
                isToday ? 'ring-1 ring-inset ring-[#c9a87c]' : ''
              }`}
            >
              {cell.day !== null && (
                <>
                  <span className={`text-xs font-medium ${isToday ? 'text-[#c9a87c]' : 'text-[#1f1f1f]'}`}>
                    {cell.day}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayChanges.slice(0, 2).map((c) => (
                      <div
                        key={c.id}
                        className="truncate rounded px-1 py-0.5 text-[10px] font-medium text-white cursor-pointer hover:opacity-80"
                        style={{ backgroundColor: TYPE_COLORS[c.type] || '#8a8a8a' }}
                        title={`${c.title} (${c.type})`}
                      >
                        {c.title}
                      </div>
                    ))}
                    {dayChanges.length > 2 && (
                      <div className="text-[10px] text-[#8a8a8a] pl-1">+{dayChanges.length - 2} more</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
