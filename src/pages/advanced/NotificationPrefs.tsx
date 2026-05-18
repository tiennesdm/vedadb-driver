/**
 * NotificationPrefs — Per-user notification preferences
 * Route: /notification-preferences
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Bell,
  Mail,
  MessageSquare,
  Smartphone,
  Radio,
  Save,
  Check,
  Clock,
  Moon,
  Zap,
  Calendar,
} from 'lucide-react';

type Channel = 'email' | 'inapp' | 'sms' | 'push';
type Event = 'ticket_assigned' | 'status_changed' | 'comment_added' | 'sla_breach';
type DigestMode = 'immediate' | 'hourly' | 'daily';

interface PrefState {
  events: Record<Event, Record<Channel, boolean>>;
  quietHours: { enabled: boolean; start: string; end: string };
  digestMode: DigestMode;
  digestTime: string;
}

const EVENT_LABELS: Record<Event, { label: string; icon: React.ReactNode }> = {
  ticket_assigned: {
    label: 'Ticket Assigned',
    icon: <MessageSquare size={15} className="text-[#722ed1]" />,
  },
  status_changed: {
    label: 'Status Changed',
    icon: <Zap size={15} className="text-[#1890ff]" />,
  },
  comment_added: {
    label: 'Comment Added',
    icon: <MessageSquare size={15} className="text-[#52c41a]" />,
  },
  sla_breach: {
    label: 'SLA Breach',
    icon: <Clock size={15} className="text-[#f5222d]" />,
  },
};

const CHANNEL_LABELS: Record<Channel, { label: string; icon: React.ElementType }> = {
  email: { label: 'Email', icon: Mail },
  inapp: { label: 'In-App', icon: Bell },
  sms: { label: 'SMS', icon: Smartphone },
  push: { label: 'Push', icon: Radio },
};

const EVENTS: Event[] = ['ticket_assigned', 'status_changed', 'comment_added', 'sla_breach'];
const CHANNELS: Channel[] = ['email', 'inapp', 'sms', 'push'];

const DEFAULT_PREFS: PrefState = {
  events: {
    ticket_assigned: { email: true, inapp: true, sms: false, push: true },
    status_changed: { email: true, inapp: true, sms: false, push: false },
    comment_added: { email: false, inapp: true, sms: false, push: false },
    sla_breach: { email: true, inapp: true, sms: true, push: true },
  },
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
  digestMode: 'immediate',
  digestTime: '09:00',
};

export default function NotificationPrefs() {
  const [prefs, setPrefs] = useState<PrefState>(DEFAULT_PREFS);
  const [saved, setSaved] = useState(false);

  const toggleChannel = (event: Event, channel: Channel) => {
    setPrefs((prev) => ({
      ...prev,
      events: {
        ...prev.events,
        [event]: {
          ...prev.events[event],
          [channel]: !prev.events[event][channel],
        },
      },
    }));
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium text-[#1f1f1f]">Notification Preferences</h1>
          <p className="mt-1 text-sm text-[#595959]">
            Choose how you want to be notified for each event
          </p>
        </div>
        <button
          onClick={handleSave}
          className={cn(
            'flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all',
            saved
              ? 'bg-[#52c41a] text-white'
              : 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95'
          )}
        >
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? 'Saved!' : 'Save Preferences'}
        </button>
      </div>

      {/* Toggle Grid */}
      <div className="rounded-xl border border-[#e5e0d5] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e0d5] bg-[#fbf9f4]">
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                  Event
                </th>
                {CHANNELS.map((ch) => {
                  const Icon = CHANNEL_LABELS[ch].icon;
                  return (
                    <th
                      key={ch}
                      className="px-4 py-3 text-center text-[10px] uppercase tracking-[0.1em] text-[#595959]"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <Icon size={16} />
                        {CHANNEL_LABELS[ch].label}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e0d5]">
              {EVENTS.map((event) => (
                <tr key={event} className="hover:bg-[rgba(201,168,124,0.02)]">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f5f0e8]">
                        {EVENT_LABELS[event].icon}
                      </div>
                      <span className="text-sm font-medium text-[#1f1f1f]">
                        {EVENT_LABELS[event].label}
                      </span>
                    </div>
                  </td>
                  {CHANNELS.map((ch) => {
                    const isActive = prefs.events[event][ch];
                    return (
                      <td key={ch} className="px-4 py-4 text-center">
                        <button
                          onClick={() => toggleChannel(event, ch)}
                          className={cn(
                            'mx-auto flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-all',
                            isActive
                              ? 'border-[#c9a87c] bg-[rgba(201,168,124,0.15)] text-[#c9a87c]'
                              : 'border-[#e5e0d5] bg-white text-[#d9d9d9] hover:border-[#c9a87c]/50'
                          )}
                          title={`${isActive ? 'Disable' : 'Enable'} ${CHANNEL_LABELS[ch].label} for ${EVENT_LABELS[event].label}`}
                        >
                          <Check size={16} className={isActive ? 'opacity-100' : 'opacity-0'} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Digest Mode */}
      <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Calendar size={18} className="text-[#c9a87c]" />
          <h3 className="text-base font-medium text-[#1f1f1f]">Digest Mode</h3>
        </div>
        <div className="flex flex-wrap gap-3">
          {(
            [
              { key: 'immediate', label: 'Immediate', desc: 'Get notified right away' },
              { key: 'hourly', label: 'Hourly', desc: 'Bundle notifications every hour' },
              { key: 'daily', label: 'Daily', desc: 'Get a daily summary' },
            ] as { key: DigestMode; label: string; desc: string }[]
          ).map((mode) => (
            <button
              key={mode.key}
              onClick={() => setPrefs((p) => ({ ...p, digestMode: mode.key }))}
              className={cn(
                'flex flex-col items-start rounded-xl border-2 px-5 py-4 text-left transition-all min-w-[140px]',
                prefs.digestMode === mode.key
                  ? 'border-[#c9a87c] bg-[rgba(201,168,124,0.08)]'
                  : 'border-[#e5e0d5] bg-white hover:border-[#c9a87c]/50'
              )}
            >
              <span
                className={cn(
                  'text-sm font-medium',
                  prefs.digestMode === mode.key ? 'text-[#1f1f1f]' : 'text-[#595959]'
                )}
              >
                {mode.label}
              </span>
              <span className="mt-0.5 text-xs text-[#8a8a8a]">{mode.desc}</span>
            </button>
          ))}
        </div>

        {prefs.digestMode === 'daily' && (
          <div className="mt-4">
            <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
              Delivery Time
            </label>
            <input
              type="time"
              value={prefs.digestTime}
              onChange={(e) => setPrefs((p) => ({ ...p, digestTime: e.target.value }))}
              className="h-10 w-32 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
            />
          </div>
        )}
      </div>

      {/* Quiet Hours */}
      <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Moon size={18} className="text-[#c9a87c]" />
            <h3 className="text-base font-medium text-[#1f1f1f]">Quiet Hours</h3>
          </div>
          <button
            onClick={() =>
              setPrefs((p) => ({
                ...p,
                quietHours: { ...p.quietHours, enabled: !p.quietHours.enabled },
              }))
            }
            className={cn(
              'flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-all',
              prefs.quietHours.enabled
                ? 'bg-[#e6f0ff] text-[#1890ff]'
                : 'bg-[#f5f5f5] text-[#8a8a8a]'
            )}
          >
            {prefs.quietHours.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        {prefs.quietHours.enabled && (
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                Start Time
              </label>
              <input
                type="time"
                value={prefs.quietHours.start}
                onChange={(e) =>
                  setPrefs((p) => ({
                    ...p,
                    quietHours: { ...p.quietHours, start: e.target.value },
                  }))
                }
                className="h-10 w-32 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                End Time
              </label>
              <input
                type="time"
                value={prefs.quietHours.end}
                onChange={(e) =>
                  setPrefs((p) => ({
                    ...p,
                    quietHours: { ...p.quietHours, end: e.target.value },
                  }))
                }
                className="h-10 w-32 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
              />
            </div>
          </div>
        )}

        <p className="mt-3 text-xs text-[#8a8a8a]">
          {prefs.quietHours.enabled
            ? `Notifications will be silenced from ${prefs.quietHours.start} to ${prefs.quietHours.end}. Only SLA breach alerts will bypass quiet hours.`
            : 'Quiet hours are disabled. You will receive notifications at any time.'}
        </p>
      </div>
    </div>
  );
}
