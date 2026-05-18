/**
 * Notification Center dropdown
 */
import { Clock, CheckCheck, Ticket, RefreshCw, AtSign, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import useAppStore from '@/lib/vedadb-store';
import type { NotificationItem } from '@/lib/vedadb-store';
import { formatDistanceToNow } from 'date-fns';

interface NotificationCenterProps {
  onClose: () => void;
}

const TYPE_ICONS: Record<NotificationItem['type'], React.ReactNode> = {
  ticket: <Ticket size={14} className="text-[#c9a87c]" />,
  status: <RefreshCw size={14} className="text-[#1890ff]" />,
  mention: <AtSign size={14} className="text-[#722ed1]" />,
  system: <AlertTriangle size={14} className="text-[#faad14]" />,
};

export default function NotificationCenter({ onClose }: NotificationCenterProps) {
  const notifications = useAppStore((s) => s.notifications);
  const markRead = useAppStore((s) => s.markNotificationRead);
  const markAllRead = useAppStore((s) => s.markAllNotificationsRead);

  return (
    <div className="absolute right-0 top-full mt-2 w-80 overflow-hidden rounded-lg border border-[#e5e0d5] bg-white shadow-dropdown z-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e5e0d5] px-4 py-2.5">
        <h3 className="text-sm font-medium text-[#1f1f1f]">Notifications</h3>
        <button
          onClick={markAllRead}
          className="flex items-center gap-1 text-xs text-[#595959] transition-colors hover:text-[#c9a87c]"
        >
          <CheckCheck size={12} />
          Mark all read
        </button>
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[#8a8a8a]">
            No notifications
          </div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => { markRead(n.id); onClose(); }}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fbf9f4]',
                !n.read && 'bg-[rgba(201,168,124,0.05)]'
              )}
            >
              <div className="mt-0.5 shrink-0">{TYPE_ICONS[n.type]}</div>
              <div className="min-w-0 flex-1">
                <p className={cn('text-xs leading-relaxed text-[#1f1f1f]', !n.read && 'font-medium')}>
                  {n.message}
                </p>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-[#8a8a8a]">
                  <Clock size={10} />
                  {safeDistance(n.created_at)}
                </div>
              </div>
              {!n.read && (
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#c9a87c]" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function safeDistance(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}
