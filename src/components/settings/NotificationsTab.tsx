import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface Props {
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

interface NotificationSetting {
  key: string;
  label: string;
  description: string;
  default: boolean;
}

const NOTIFICATION_ITEMS: NotificationSetting[] = [
  {
    key: 'ticket_assigned',
    label: 'New Ticket Assigned',
    description: 'Get notified when a ticket is assigned to you',
    default: true,
  },
  {
    key: 'status_changes',
    label: 'Ticket Status Changes',
    description: 'Get notified when a ticket you\'re watching changes status',
    default: true,
  },
  {
    key: 'new_comments',
    label: 'New Comments',
    description: 'Get notified of new comments on your tickets',
    default: true,
  },
  {
    key: 'ticket_resolved',
    label: 'Ticket Resolved',
    description: 'Get notified when a ticket you created is resolved',
    default: true,
  },
  {
    key: 'daily_digest',
    label: 'Daily Digest',
    description: 'Receive a daily summary of ticket activity',
    default: false,
  },
  {
    key: 'kb_updates',
    label: 'Knowledge Article Updates',
    description: 'Get notified when knowledge articles are updated',
    default: false,
  },
];

interface EmailPref {
  key: string;
  label: string;
  description: string;
  default: boolean;
}

const EMAIL_PREFS: EmailPref[] = [
  {
    key: 'email_ticket_assigned',
    label: 'Email: New Ticket Assigned',
    description: 'Receive an email when a ticket is assigned to you',
    default: true,
  },
  {
    key: 'email_status_change',
    label: 'Email: Status Changes',
    description: 'Receive an email when ticket status changes',
    default: false,
  },
  {
    key: 'email_daily_digest',
    label: 'Email: Daily Digest',
    description: 'Receive a daily digest email',
    default: false,
  },
];

export default function NotificationsTab({ showToast }: Props) {
  const [settings, setSettings] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const saved = localStorage.getItem('vedadesk_notifications');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch { /* ignore */ }
    } else {
      // Initialize with defaults
      const defaults: Record<string, boolean> = {};
      NOTIFICATION_ITEMS.forEach((item) => { defaults[item.key] = item.default; });
      EMAIL_PREFS.forEach((item) => { defaults[item.key] = item.default; });
      setSettings(defaults);
    }
  }, []);

  const persistSettings = (newSettings: Record<string, boolean>) => {
    setSettings(newSettings);
    localStorage.setItem('vedadesk_notifications', JSON.stringify(newSettings));
  };

  const toggle = (key: string) => {
    const updated = { ...settings, [key]: !settings[key] };
    persistSettings(updated);
    showToast('Notification preference saved', 'success');
  };

  return (
    <div>
      <h2 className="text-2xl font-medium text-[#1f1f1f] tracking-tight">Notifications</h2>
      <p className="mt-1 text-sm text-[#595959]">Choose what you want to be notified about.</p>

      {/* Notification Toggles */}
      <div className="mt-8 rounded-xl border border-[#e5e0d5] bg-white overflow-hidden">
        {NOTIFICATION_ITEMS.map((item, index) => (
          <div
            key={item.key}
            className={cn(
              'flex items-center justify-between px-5 py-4',
              index < NOTIFICATION_ITEMS.length - 1 && 'border-b border-[#e5e0d5]'
            )}
          >
            <div className="pr-4">
              <p className="text-sm font-semibold text-[#1f1f1f]">{item.label}</p>
              <p className="text-xs text-[#8a8a8a] mt-0.5">{item.description}</p>
            </div>
            <Switch
              checked={!!settings[item.key]}
              onCheckedChange={() => toggle(item.key)}
              className="shrink-0 data-[state=checked]:bg-[#c9a87c]"
            />
          </div>
        ))}
      </div>

      {/* Email Preferences */}
      <div className="mt-8">
        <h3 className="text-base font-medium text-[#1f1f1f] mb-1">Email Notifications</h3>
        <p className="text-sm text-[#595959] mb-4">Control which events trigger an email.</p>

        <div className="rounded-xl border border-[#e5e0d5] bg-white overflow-hidden">
          {EMAIL_PREFS.map((item, index) => (
            <div
              key={item.key}
              className={cn(
                'flex items-center justify-between px-5 py-4',
                index < EMAIL_PREFS.length - 1 && 'border-b border-[#e5e0d5]'
              )}
            >
              <div className="pr-4">
                <p className="text-sm font-semibold text-[#1f1f1f]">{item.label}</p>
                <p className="text-xs text-[#8a8a8a] mt-0.5">{item.description}</p>
              </div>
              <Switch
                checked={!!settings[item.key]}
                onCheckedChange={() => toggle(item.key)}
                className="shrink-0 data-[state=checked]:bg-[#c9a87c]"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
