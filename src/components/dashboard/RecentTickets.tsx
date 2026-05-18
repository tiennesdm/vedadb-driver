/**
 * Recent Tickets — Compact list of latest tickets with status badges
 */
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

interface Ticket {
  id: number;
  title: string;
  status: string;
  priority: string;
  assigned_to_name: string;
  assigned_to_initials: string;
}

interface RecentTicketsProps {
  tickets: Ticket[];
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  open: { bg: '#e6f7e6', text: '#52c41a', border: 'rgba(82,196,26,0.2)', label: 'Open' },
  in_progress: { bg: '#e6f0ff', text: '#1890ff', border: 'rgba(24,144,255,0.2)', label: 'In Progress' },
  resolved: { bg: '#f6ffed', text: '#52c41a', border: 'rgba(82,196,26,0.2)', label: 'Resolved' },
  closed: { bg: '#f5f5f5', text: '#8a8a8a', border: 'rgba(138,138,138,0.2)', label: 'Closed' },
  on_hold: { bg: '#fff7e6', text: '#faad14', border: 'rgba(250,173,20,0.2)', label: 'On Hold' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: '#1890ff',
  medium: '#faad14',
  high: '#f5222d',
  critical: '#f5222d',
};

export default function RecentTickets({ tickets }: RecentTicketsProps) {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.5,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="rounded-xl border border-[#e5e0d5] bg-white p-6"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#1f1f1f]">Recent Tickets</h3>
        <button
          onClick={() => navigate('/tickets')}
          className="flex items-center gap-1 text-sm text-[#c9a87c] transition-colors hover:text-[#b8996d]"
        >
          View All
          <ArrowRight size={14} />
        </button>
      </div>

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <img
            src="/empty-tickets.svg"
            alt="No tickets"
            className="mb-3 h-24 w-32 opacity-60"
          />
          <p className="text-sm text-[#595959]">No tickets yet</p>
          <button
            onClick={() => navigate('/tickets?action=new')}
            className="mt-2 text-sm text-[#c9a87c] hover:underline"
          >
            Create your first ticket
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e0d5]">
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  ID
                </th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  Title
                </th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  Status
                </th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  Priority
                </th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  Assigned
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket, index) => {
                const statusConfig = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
                return (
                  <motion.tr
                    key={ticket.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.4,
                      delay: 0.6 + index * 0.05,
                      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
                    }}
                    onClick={() => navigate(`/tickets/${ticket.id}`)}
                    className="cursor-pointer border-b border-[#e5e0d5] transition-colors last:border-0 hover:bg-[#fbf9f4]"
                  >
                    <td className="whitespace-nowrap py-3 pr-2">
                      <span className="font-mono text-xs text-[#8a8a8a]">
                        #{ticket.id}
                      </span>
                    </td>
                    <td className="max-w-[200px] truncate py-3 pr-2 text-sm text-[#1f1f1f]">
                      {ticket.title}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-2">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: statusConfig.bg,
                          color: statusConfig.text,
                          border: `1px solid ${statusConfig.border}`,
                        }}
                      >
                        {statusConfig.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            backgroundColor:
                              PRIORITY_COLORS[ticket.priority] || '#595959',
                          }}
                        />
                        <span className="text-xs capitalize text-[#595959]">
                          {ticket.priority}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(201,168,124,0.15)] text-[10px] font-bold text-[#c9a87c]">
                          {ticket.assigned_to_initials}
                        </div>
                        <span className="text-xs text-[#595959]">
                          {ticket.assigned_to_name}
                        </span>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
