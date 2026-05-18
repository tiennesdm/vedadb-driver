import { useState, useEffect, useCallback } from 'react';
import {
  Database, UserCircle, FolderOpen, Bell, Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsToast } from '@/components/settings/use-settings-toast';
import ToastContainer from '@/components/settings/ToastContainer';
import VedaDBConnectionTab from '@/components/settings/VedaDBConnectionTab';
import ProfileTab from '@/components/settings/ProfileTab';
import CategoriesTab from '@/components/settings/CategoriesTab';
import NotificationsTab from '@/components/settings/NotificationsTab';
import SystemTab from '@/components/settings/SystemTab';
import useAppStore from '@/lib/vedadb-store';

const NAV_ITEMS = [
  { id: 'vedadb', label: 'VedaDB Connection', icon: Database, adminOnly: false },
  { id: 'profile', label: 'Profile', icon: UserCircle, adminOnly: false },
  { id: 'categories', label: 'Categories', icon: FolderOpen, adminOnly: true },
  { id: 'notifications', label: 'Notifications', icon: Bell, adminOnly: false },
  { id: 'system', label: 'System', icon: Settings2, adminOnly: true },
];

const TAB_IDS = NAV_ITEMS.map((i) => i.id);

export default function Settings() {
  const currentUser = useAppStore((s) => s.currentUser);
  const isAdmin = currentUser?.role === 'admin';

  const [activeTab, setActiveTab] = useState('vedadb');
  const [contentKey, setContentKey] = useState(0);
  const { toasts, showToast, removeToast } = useSettingsToast();

  // Parse URL ?tab= param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && TAB_IDS.includes(tabParam)) {
      // Check admin restriction
      const item = NAV_ITEMS.find((n) => n.id === tabParam);
      if (item && (!item.adminOnly || isAdmin)) {
        setActiveTab(tabParam);
      }
    }
  }, [isAdmin]);

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    setContentKey((k) => k + 1);
    // Update URL param
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tabId);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }, []);

  const filteredNav = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const renderTab = () => {
    switch (activeTab) {
      case 'vedadb':
        return <VedaDBConnectionTab showToast={showToast} />;
      case 'profile':
        return <ProfileTab showToast={showToast} />;
      case 'categories':
        return <CategoriesTab showToast={showToast} />;
      case 'notifications':
        return <NotificationsTab showToast={showToast} />;
      case 'system':
        return <SystemTab showToast={showToast} />;
      default:
        return <VedaDBConnectionTab showToast={showToast} />;
    }
  };

  return (
    <div className="relative">
      {/* Toasts */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="flex flex-col lg:flex-row gap-0">
        {/* Desktop Side Navigation */}
        <nav className="hidden lg:block w-[240px] shrink-0 border-r border-[#e5e0d5] bg-white pr-0 self-start sticky top-0">
          <div className="space-y-1 py-2">
            {filteredNav.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabChange(item.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-r-lg px-4 py-2.5 text-sm transition-all duration-200',
                    isActive
                      ? 'border-l-[3px] border-l-[#c9a87c] bg-[rgba(201,168,124,0.1)] text-[#c9a87c]'
                      : 'border-l-[3px] border-l-transparent text-[#595959] hover:bg-[#fbf9f4] hover:text-[#1f1f1f]'
                  )}
                >
                  <item.icon size={18} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Mobile/Tablet Horizontal Tab Bar */}
        <nav className="lg:hidden border-b border-[#e5e0d5] bg-white overflow-x-auto">
          <div className="flex items-center gap-1 px-2 py-2 min-w-max">
            {filteredNav.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabChange(item.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-all duration-200 shrink-0',
                    isActive
                      ? 'bg-[rgba(201,168,124,0.1)] text-[#c9a87c]'
                      : 'text-[#595959] hover:bg-[#fbf9f4] hover:text-[#1f1f1f]'
                  )}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Tab Content */}
        <main
          key={contentKey}
          className="flex-1 min-w-0 p-4 md:p-6 lg:p-8 lg:pl-10"
          style={{
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          {renderTab()}
        </main>
      </div>

      {/* CSS Keyframes */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes zoomIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
