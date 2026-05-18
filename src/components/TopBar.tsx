/**
 * Top Bar — Page title, breadcrumb, search, notifications
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Search, Bell, ChevronRight, Menu } from 'lucide-react';
import useAppStore from '@/lib/vedadb-store';
import VedaDBStatus from './VedaDBStatus';
import NotificationCenter from './NotificationCenter';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/tickets': 'Tickets',
  '/users': 'Users',
  '/knowledge': 'Knowledge Base',
  '/settings': 'Settings',
};

function getBreadcrumb(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const crumbs: { label: string; path?: string }[] = [{ label: 'Home', path: '/dashboard' }];
  if (parts[0] === 'tickets') {
    crumbs.push({ label: 'Tickets', path: '/tickets' });
    if (parts[1]) crumbs.push({ label: `#${parts[1]}` });
  } else if (parts[0] === 'knowledge') {
    crumbs.push({ label: 'Knowledge Base', path: '/knowledge' });
    if (parts[1]) crumbs.push({ label: 'Article' });
  } else if (parts[0] === 'users') {
    crumbs.push({ label: 'Users' });
  } else if (parts[0] === 'settings') {
    crumbs.push({ label: 'Settings' });
  } else if (parts[0] === 'dashboard') {
    crumbs.push({ label: 'Dashboard' });
  }
  return crumbs;
}

export default function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);

  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const pageTitle = PAGE_TITLES[location.pathname] || 'VedaDesk';
  const breadcrumbs = useMemo(() => getBreadcrumb(location.pathname), [location.pathname]);

  const userInitials = useMemo(() => {
    if (!currentUser) return '?';
    return currentUser.name.split(' ').map((n) => n[0]).join('').toUpperCase();
  }, [currentUser]);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[#e5e0d5] bg-white px-4 lg:px-6">
      {/* Left: breadcrumb + title */}
      <div className="flex items-center gap-3 min-w-0">
        <button className="mr-1 text-[#595959] lg:hidden" onClick={() => { /* mobile menu handled elsewhere */ }}>
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <nav className="hidden items-center gap-1 text-xs text-[#8a8a8a] md:flex">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} />}
                {crumb.path ? (
                  <button onClick={() => crumb.path && navigate(crumb.path)} className="hover:text-[#c9a87c] transition-colors">
                    {crumb.label}
                  </button>
                ) : (
                  <span className={i === breadcrumbs.length - 1 ? 'font-medium text-[#1f1f1f]' : ''}>
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
          <h1 className="text-base font-medium text-[#1f1f1f] truncate">{pageTitle}</h1>
        </div>
      </div>

      {/* Right: search, notifications, avatar */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Search — desktop inline */}
        <div className="hidden md:block relative">
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-1.5 text-sm text-[#8a8a8a] transition-colors hover:border-[#c9a87c] hover:text-[#595959]"
          >
            <Search size={14} />
            <span className="text-xs">Search...</span>
            <kbd className="ml-2 hidden rounded bg-[#e5e0d5] px-1.5 py-0.5 text-[10px] font-mono xl:inline">⌘K</kbd>
          </button>
        </div>

        {/* Mobile search icon */}
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#595959] transition-colors hover:bg-[#f5f0e8] md:hidden"
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search size={18} />
        </button>

        {/* VedaDB Status */}
        <div className="hidden md:block">
          <VedaDBStatus />
        </div>

        {/* Notification bell */}
        <div className="relative">
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[#595959] transition-colors hover:bg-[#f5f0e8]"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f5222d] px-1 text-[10px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>
          {notifOpen && <NotificationCenter onClose={() => setNotifOpen(false)} />}
        </div>

        {/* User avatar */}
        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-xs font-bold text-[#c9a87c]">
          {userInitials}
        </div>
      </div>

      {/* Mobile search overlay */}
      {searchOpen && (
        <div className="absolute left-0 right-0 top-14 border-b border-[#e5e0d5] bg-white p-3 md:hidden z-50">
          <button
            onClick={() => { setCommandPaletteOpen(true); setSearchOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#8a8a8a]"
          >
            <Search size={16} />
            <span>Search tickets, users, articles...</span>
          </button>
        </div>
      )}
    </header>
  );
}


