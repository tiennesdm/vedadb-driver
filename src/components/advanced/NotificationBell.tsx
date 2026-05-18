/**
 * NotificationBell — Real-time notification bell with unread count + dropdown list
 */
import { useState, useRef, useEffect } from 'react';
import useAppStore from '@/lib/vedadb-store';
import { cn } from '@/lib/utils';
import { Bell, CheckCheck, Circle, Ticket, MessageSquare, AtSign, AlertTriangle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ICON_MAP: Record<string, React.ReactNode> = {
  ticket: <Ticket size={14} className="text-[#1890ff]" />,
  status: <Circle size={14} className="text-[#52c41a]" />,
  mention: <AtSign size={14} className="text-[#722ed1]" />,
  system: <AlertTriangle size={14} className="text-[#faad14]" />,
};

const BG_MAP: Record<string, string> = {
  ticket: 'bg-[#e6f0ff]',
  status: 'bg-[#f6ffed]',
  mention: 'bg-[#f0e6ff]',
  system: 'bg-[#fff7e6]',
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const notifications = useAppStore((s) => s.notifications);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const markRead = useAppStore((s) => s.markNotificationRead);
  const markAllRead = useAppStore((s) => s.markAllNotificationsRead);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleClick = (n: (typeof notifications)[0]) => {
    markRead(n.id);
    if (n.link) {
      navigate(n.link);
    }
    setOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-xl transition-all',
          open
            ? 'bg-[rgba(201,168,124,0.2)] text-[#c9a87c]'
            : 'text-[#595959] hover:bg-[#f5f0e8] hover:text-[#1f1f1f]'
        )}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f5222d] px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-[#e5e0d5] bg-white shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#e5e0d5] px-4 py-3">
            <h3 className="text-sm font-medium text-[#1f1f1f]">Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#595959] transition-colors hover:bg-[#fbf9f4] hover:text-[#c9a87c]"
                >
                  <CheckCheck size={12} />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-[#8a8a8a] hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Bell size={32} className="mb-2 text-[#e5e0d5]" />
                <p className="text-sm text-[#8a8a8a]">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fbf9f4]',
                    !n.read && 'bg-[rgba(201,168,124,0.03)]'
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      BG_MAP[n.type] || 'bg-[#f5f5f5]'
                    )}
                  >
                    {ICON_MAP[n.type] || <MessageSquare size={14} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm leading-snug',
                        !n.read ? 'font-medium text-[#1f1f1f]' : 'text-[#595959]'
                      )}
                    >
                      {n.message}
                    </p>
                    <span className="text-xs text-[#8a8a8a]">
                      {n.created_at
                        ? new Date(n.created_at).toLocaleString()
                        : ''}
                    </span>
                  </div>
                  {!n.read && (
                    <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#c9a87c]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
