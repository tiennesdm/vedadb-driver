/**
 * TicketTypeBadge — Badge with Lucide icon per ticket type
 */
import { AlertTriangle, Clipboard, Bug, GitBranch } from 'lucide-react';
import { TicketType } from '@/lib/rbac';
import { cn } from '@/lib/utils';

interface TicketTypeBadgeProps {
  type: TicketType | string;
  className?: string;
}

const TYPE_CONFIG: Record<
  TicketType,
  { label: string; icon: typeof AlertTriangle; color: string; bg: string }
> = {
  [TicketType.INCIDENT]: {
    label: 'Incident',
    icon: AlertTriangle,
    color: '#f5222d',
    bg: '#fff1f0',
  },
  [TicketType.SERVICE_REQUEST]: {
    label: 'Service Request',
    icon: Clipboard,
    color: '#1890ff',
    bg: '#e6f7ff',
  },
  [TicketType.PROBLEM]: {
    label: 'Problem',
    icon: Bug,
    color: '#fa8c16',
    bg: '#fff7e6',
  },
  [TicketType.CHANGE]: {
    label: 'Change',
    icon: GitBranch,
    color: '#722ed1',
    bg: '#f9f0ff',
  },
};

export default function TicketTypeBadge({ type, className }: TicketTypeBadgeProps) {
  const typeKey = Object.values(TicketType).includes(type as TicketType)
    ? (type as TicketType)
    : TicketType.INCIDENT;

  const config = TYPE_CONFIG[typeKey];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        className
      )}
      style={{
        backgroundColor: config.bg,
        color: config.color,
      }}
    >
      <Icon size={12} />
      {config.label}
    </span>
  );
}
