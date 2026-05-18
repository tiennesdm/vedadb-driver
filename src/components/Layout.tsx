/**
 * Dashboard shell — wraps Sidebar + TopBar + content area
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar, { MobileBottomNav } from './Sidebar';
import TopBar from './TopBar';
import CommandPalette from './CommandPalette';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();

  // Auto-collapse sidebar on tablet
  useEffect(() => {
    const check = () => {
      if (window.innerWidth >= 768 && window.innerWidth < 1024) {
        setSidebarCollapsed(true);
      } else if (window.innerWidth >= 1024) {
        setSidebarCollapsed(false);
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return (
    <div className="flex min-h-[100dvh]">
      {/* Desktop sidebar */}
      <Sidebar collapsed={sidebarCollapsed} />

      {/* Main content area */}
      <div
        className={cn(
          'flex flex-1 flex-col transition-all duration-300',
          'md:ml-16',
          'lg:ml-[260px]'
        )}
      >
        <TopBar />
        <main className="flex-1 p-4 pb-20 md:p-6 md:pb-6 lg:p-8">
          <div key={location.pathname} className="animate-in fade-in duration-300">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileBottomNav />

      {/* Global command palette */}
      <CommandPalette />
    </div>
  );
}
