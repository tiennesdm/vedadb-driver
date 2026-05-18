/**
 * Status badge component for tickets
 */
import { cn } from '@/lib/utils';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'on_hold';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  open: {
    bg: 'bg-[#e6f7e6]',
    text: 'text-[#52c41a]',
    border: 'border-[rgba(82,196,26,0.2)]',
    label: 'Open',
  },
  in_progress: {
    bg: 'bg-[#e6f0ff]',
    text: 'text-[#1890ff]',
    border: 'border-[rgba(24,144,255,0.2)]',
    label: 'In Progress',
  },
  resolved: {
    bg: 'bg-[#f6ffed]',
    text: 'text-[#52c41a]',
    border: 'border-[rgba(82,196,26,0.2)]',
    label: 'Resolved',
  },
  closed: {
    bg: 'bg-[#f5f5f5]',
    text: 'text-[#8a8a8a]',
    border: 'border-[rgba(138,138,138,0.2)]',
    label: 'Closed',
  },
  on_hold: {
    bg: 'bg-[#fff7e6]',
    text: 'text-[#faad14]',
    border: 'border-[rgba(250,173,20,0.2)]',
    label: 'On Hold',
  },
};

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_STYLES[status] || STATUS_STYLES.closed;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        config.bg,
        config.text,
        config.border,
        className
      )}
    >
      {config.label}
    </span>
  );
}
