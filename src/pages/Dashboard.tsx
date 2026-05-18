/**
 * Dashboard Page — Main portal overview with ticket stats, charts, recent activity
 *
 * Sections:
 *  1. Stats Row (4 stat cards with count-up animation)
 *  2. Charts Row (Line chart + Donut chart)
 *  3. Data Tables Row (Recent tickets + Activity timeline)
 *  4. Bottom Row (Category bar chart + Team leaderboard)
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  AlertCircle,
  Clock,
  CheckCircle,
  Plus,
} from 'lucide-react';
import { motion } from 'framer-motion';
import useAppStore from '@/lib/vedadb-store';
import StatCard from '@/components/dashboard/StatCard';
import TicketTrendChart from '@/components/dashboard/TicketTrendChart';
import StatusDonutChart from '@/components/dashboard/StatusDonutChart';
import RecentTickets from '@/components/dashboard/RecentTickets';
import ActivityTimeline from '@/components/dashboard/ActivityTimeline';
import CategoryBarChart from '@/components/dashboard/CategoryBarChart';
import TeamLeaderboard from '@/components/dashboard/TeamLeaderboard';
import { formatDistanceToNow } from 'date-fns';

/* ------------------------------------------------------------------ */
/*  Data transformation helpers                                        */
/* ------------------------------------------------------------------ */

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

function generate30DayTrend(tickets: Array<{ created_at: string; status: string; updated_at: string }>) {
  const data: Array<{ date: string; created: number; resolved: number }> = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const created = tickets.filter((t) => t.created_at.startsWith(dateStr)).length;
    const resolved = tickets.filter(
      (t) => t.status === 'resolved' && t.updated_at.startsWith(dateStr)
    ).length;
    data.push({ date: dateStr, created, resolved });
  }
  return data;
}

const STATUS_COLORS: Record<string, string> = {
  open: '#faad14',
  in_progress: '#1890ff',
  resolved: '#52c41a',
  closed: '#8a8a8a',
  on_hold: '#722ed1',
};

const ACTION_DOT_COLORS: Record<string, string> = {
  created: '#52c41a',
  assigned: '#722ed1',
  resolved: '#1890ff',
  commented: '#c9a87c',
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);

  /* -- Raw data from VedaDB localStorage -- */
  // The vedadb.ts seeds data to localStorage — let's read it from there
  const allTickets = useMemo(() => {
    try {
      const raw = localStorage.getItem('vedadesk_db');
      if (raw) {
        const db = JSON.parse(raw);
        return (db.tickets || []) as Array<{
          id: number;
          title: string;
          status: string;
          priority: string;
          category: string;
          created_by: number;
          assigned_to: number;
          created_at: string;
          updated_at: string;
        }>;
      }
    } catch { /* ignore */ }
    return [];
  }, []);

  const allUsers = useMemo(() => {
    try {
      const raw = localStorage.getItem('vedadesk_db');
      if (raw) {
        const db = JSON.parse(raw);
        return (db.users || []) as Array<{
          id: number;
          name: string;
          email: string;
          role: string;
          department: string;
          created_at: string;
        }>;
      }
    } catch { /* ignore */ }
    return [];
  }, []);

  const allActivities = useMemo(() => {
    try {
      const raw = localStorage.getItem('vedadesk_db');
      if (raw) {
        const db = JSON.parse(raw);
        return (db.activities || []) as Array<{
          id: number;
          ticket_id: number;
          user_id: number;
          action: string;
          created_at: string;
        }>;
      }
    } catch { /* ignore */ }
    return [];
  }, []);

  /* -- Computed stats -- */
  const totalTickets = allTickets.length;
  const openTickets = allTickets.filter((t) => t.status === 'open').length;
  const inProgressTickets = allTickets.filter((t) => t.status === 'in_progress').length;
  const resolvedToday = allTickets.filter((t) => {
    if (t.status !== 'resolved') return false;
    const today = new Date().toISOString().split('T')[0];
    return t.updated_at.startsWith(today);
  }).length;

  /* -- Trend data -- */
  const trendData = useMemo(() => generate30DayTrend(allTickets), [allTickets]);

  /* -- Status distribution -- */
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    allTickets.forEach((t) => {
      counts[t.status] = (counts[t.status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({
      name,
      value,
      color: STATUS_COLORS[name] || '#595959',
    }));
  }, [allTickets]);

  /* -- Category data -- */
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    allTickets.forEach((t) => {
      const cat = t.category || 'Uncategorized';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [allTickets]);

  /* -- Recent tickets (last 10) -- */
  const recentTickets = useMemo(() => {
    return [...allTickets]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
      .map((t) => {
        const assignee = allUsers.find((u) => u.id === t.assigned_to);
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          assigned_to_name: assignee?.name || 'Unassigned',
          assigned_to_initials: assignee ? getInitials(assignee.name) : '?',
        };
      });
  }, [allTickets, allUsers]);

  /* -- Activity timeline -- */
  const activityTimeline = useMemo(() => {
    return [...allActivities]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 8)
      .map((a) => {
        const user = allUsers.find((u) => u.id === a.user_id);
        const userName = user?.name || 'Unknown';
        // Determine dot color based on action
        let dotColor = '#c9a87c';
        const actionLower = a.action.toLowerCase();
        if (actionLower.includes('created')) dotColor = ACTION_DOT_COLORS.created;
        else if (actionLower.includes('assigned')) dotColor = ACTION_DOT_COLORS.assigned;
        else if (actionLower.includes('resolved')) dotColor = ACTION_DOT_COLORS.resolved;
        else if (actionLower.includes('comment')) dotColor = ACTION_DOT_COLORS.commented;

        return {
          id: a.id,
          text: `${userName} ${a.action} ticket #${a.ticket_id}`,
          timestamp: formatDistanceToNow(new Date(a.created_at), { addSuffix: true }),
          dotColor,
        };
      });
  }, [allActivities, allUsers]);

  /* -- Team leaderboard -- */
  const leaderboard = useMemo(() => {
    const resolvedByUser: Record<number, number> = {};
    allTickets
      .filter((t) => t.status === 'resolved')
      .forEach((t) => {
        resolvedByUser[t.assigned_to] = (resolvedByUser[t.assigned_to] || 0) + 1;
      });

    const sorted = Object.entries(resolvedByUser)
      .map(([userId, count]) => ({
        userId: parseInt(userId, 10),
        resolved: count,
      }))
      .sort((a, b) => b.resolved - a.resolved)
      .slice(0, 5);

    if (sorted.length === 0) return [];

    const maxResolved = sorted[0].resolved;

    return sorted.map((entry, idx) => {
      const user = allUsers.find((u) => u.id === entry.userId);
      return {
        rank: idx + 1,
        name: user?.name || 'Unknown',
        initials: user ? getInitials(user.name) : '?',
        resolved: entry.resolved,
        percentage: (entry.resolved / maxResolved) * 100,
      };
    });
  }, [allTickets, allUsers]);

  /* -- Date display -- */
  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-medium text-[#1f1f1f] md:text-2xl">Dashboard</h2>
          <p className="mt-0.5 text-sm text-[#595959]">
            Welcome back, {currentUser?.name || 'User'}. Here's what's happening today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-[#8a8a8a] sm:block">
            {todayFormatted}
          </span>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/tickets?action=new')}
            className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-colors hover:bg-[#b8996d]"
          >
            <Plus size={16} />
            New Ticket
          </motion.button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Inbox}
          iconColor="#1890ff"
          iconBg="rgba(24,144,255,0.1)"
          value={totalTickets}
          label="TOTAL TICKETS"
          trend="+12% this month"
          trendType="up"
          linkTo="/tickets"
          delay={0}
        />
        <StatCard
          icon={AlertCircle}
          iconColor="#faad14"
          iconBg="rgba(250,173,20,0.1)"
          value={openTickets}
          label="OPEN TICKETS"
          trend="-5% this week"
          trendType="down"
          linkTo="/tickets?status=open"
          delay={0.1}
        />
        <StatCard
          icon={Clock}
          iconColor="#722ed1"
          iconBg="rgba(114,46,209,0.1)"
          value={inProgressTickets}
          label="IN PROGRESS"
          trend="+3 today"
          trendType="neutral"
          linkTo="/tickets?status=in_progress"
          delay={0.2}
        />
        <StatCard
          icon={CheckCircle}
          iconColor="#52c41a"
          iconBg="rgba(82,196,26,0.1)"
          value={resolvedToday}
          label="RESOLVED TODAY"
          trend="+8 vs yesterday"
          trendType="up"
          linkTo="/tickets?status=resolved"
          delay={0.3}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TicketTrendChart data={trendData} />
        </div>
        <div className="lg:col-span-1">
          <StatusDonutChart data={statusData} total={totalTickets} />
        </div>
      </div>

      {/* Data Tables Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentTickets tickets={recentTickets} />
        <ActivityTimeline activities={activityTimeline} />
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CategoryBarChart data={categoryData} />
        <TeamLeaderboard members={leaderboard} />
      </div>
    </div>
  );
}
