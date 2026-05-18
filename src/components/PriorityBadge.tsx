/**
 * Priority indicator component for tickets
 */
import { ArrowDown, Minus, ArrowUp, ChevronsUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

interface PriorityBadgeProps {
  priority: string;
  showLabel?: boolean;
  className?: string;
}

const PRIORITY_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  low: {
    color: 'text-[#1890ff]',
    icon: <ArrowDown size={14} />,
    label: 'Low',
  },
  medium: {
    color: 'text-[#faad14]',
    icon: <Minus size={14} />,
    label: 'Medium',
  },
  high: {
    color: 'text-[#f5222d]',
    icon: <ArrowUp size={14} />,
    label: 'High',
  },
  critical: {
    color: 'text-[#f5222d]',
    icon: <ChevronsUp size={14} />,
    label: 'Critical',
  },
};

export default function PriorityBadge({ priority, showLabel = true, className }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;

  return (
    <span className={cn('inline-flex items-center gap-1', config.color, className)}>
      {config.icon}
      {showLabel && <span className="text-xs font-medium">{config.label}</span>}
    </span>
  );
}
