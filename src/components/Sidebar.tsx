/**
 * Sidebar Navigation — Responsive sidebar (260px desktop / 64px tablet / bottom bar mobile)
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import {
  LayoutDashboard,
  Ticket,
  Users,
  BookOpen,
  Settings,
  LogOut,
} from 'lucide-react';
import useAppStore from '@/lib/vedadb-store';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed?: boolean;
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Ticket, label: 'Tickets', path: '/tickets' },
  { icon: Users, label: 'Users', path: '/users' },
  { icon: BookOpen, label: 'Knowledge', path: '/knowledge' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export default function Sidebar({ collapsed = false }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const logout = useAppStore((s) => s.logout);

  const activePath = location.pathname;

  const isActive = (path: string) => {
    if (path === '/dashboard') return activePath === '/dashboard';
    return activePath.startsWith(path);
  };

  const userInitials = useMemo(() => {
    if (!currentUser) return '?';
    return currentUser.name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  }, [currentUser]);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-50 hidden h-full flex-col bg-[#1f1f1f] transition-all duration-300 md:flex',
        collapsed ? 'w-16' : 'w-[260px]'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 px-4">
        <img src="./logo-icon.svg" alt="VedaDesk" className="h-8 w-8 shrink-0" />
        {!collapsed && (
          <img src="./logo-wordmark.svg" alt="VedaDesk" className="h-6" />
        )}
      </div>

      {/* Navigation */}
      <nav className="mt-4 flex flex-1 flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-all duration-200',
                collapsed ? 'justify-center' : '',
                active
                  ? 'border-l-[3px] border-[#c9a87c] bg-[rgba(201,168,124,0.15)] text-[#c9a87c]'
                  : 'border-l-[3px] border-transparent text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#f5f5f5]'
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={20} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* User profile */}
      <div className="border-t border-[#2a2a2a] p-3">
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-xs font-bold text-[#c9a87c]">
            {userInitials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#f5f5f5]">
                {currentUser?.name || 'User'}
              </p>
              <p className="truncate text-xs capitalize text-[#8a8a8a]">
                {currentUser?.role || 'agent'}
              </p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={logout}
              className="shrink-0 text-[#8a8a8a] transition-colors hover:text-[#f5f5f5]"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Mobile bottom navigation bar */
export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around bg-[#1f1f1f] md:hidden">
      {NAV_ITEMS.map((item) => {
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 px-3 py-1',
              active ? 'text-[#c9a87c]' : 'text-[#8a8a8a]'
            )}
          >
            <item.icon size={20} />
            <span className="text-[10px]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
