/**
 * SMSSettings — SMS notification configuration
 * Route: /sms-settings
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  MessageSquare,
  Save,
  ToggleLeft,
  ToggleRight,
  Phone,
  KeyRound,
  Webhook,
  Check,
  Clock,
  Send,
  History,
  UserCheck,
} from 'lucide-react';

interface SMSLog {
  id: string;
  to: string;
  message: string;
  status: 'sent' | 'failed' | 'pending';
  timestamp: string;
  template: string;
}

interface UserSMSPref {
  userId: number;
  name: string;
  enabled: boolean;
  phone: string;
}

const SAMPLE_LOGS: SMSLog[] = [
  {
    id: '1',
    to: '+1-555-0101',
    message: 'URGENT: SLA breach on Ticket TKT-1234. Please take immediate action.',
    status: 'sent',
    timestamp: '2024-01-15T14:30:00Z',
    template: 'SLA Breach',
  },
  {
    id: '2',
    to: '+1-555-0102',
    message: 'Ticket TKT-1235 assigned to you. High priority.',
    status: 'sent',
    timestamp: '2024-01-15T13:15:00Z',
    template: 'Ticket Assigned',
  },
  {
    id: '3',
    to: '+1-555-0103',
    message: 'Status update: Ticket TKT-1230 is now Resolved.',
    status: 'failed',
    timestamp: '2024-01-15T12:00:00Z',
    template: 'Status Changed',
  },
];

const SMS_TEMPLATES = [
  { id: 'sla_breach', name: 'SLA Breach Alert', content: 'URGENT: SLA breach on Ticket {{ticket.id}}. Please take immediate action.', enabled: true },
  { id: 'ticket_assigned', name: 'Ticket Assigned', content: 'Ticket {{ticket.id}} assigned to you. {{ticket.priority}} priority.', enabled: true },
  { id: 'status_change', name: 'Status Changed', content: 'Status update: Ticket {{ticket.id}} is now {{ticket.status}}.', enabled: false },
  { id: 'comment_added', name: 'Comment Added', content: 'New comment on Ticket {{ticket.id}} by {{agent.name}}.', enabled: false },
];

const DEFAULT_USER_PREFS: UserSMSPref[] = [
  { userId: 1, name: 'Alice Johnson', enabled: true, phone: '+1-555-0101' },
  { userId: 2, name: 'Bob Smith', enabled: false, phone: '+1-555-0102' },
  { userId: 3, name: 'Carol White', enabled: true, phone: '+1-555-0103' },
  { userId: 4, name: 'David Brown', enabled: false, phone: '' },
  { userId: 5, name: 'Eve Martinez', enabled: true, phone: '+1-555-0105' },
];

function validatePhone(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone.replace(/[-\s]/g, ''));
}

export default function SMSSettings() {
  const [provider, setProvider] = useState('twilio');
  const [accountSid, setAccountSid] = useState('ACxxxxxxxxxxxxxxxxxxxxxxxx');
  const [authToken, setAuthToken] = useState('••••••••••••••••••••');
  const [fromNumber, setFromNumber] = useState('+1-800-555-0199');
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [templates, setTemplates] = useState(SMS_TEMPLATES);
  const [userPrefs, setUserPrefs] = useState(DEFAULT_USER_PREFS);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'templates' | 'logs' | 'users'>('settings');

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleTemplate = (id: string) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t))
    );
  };

  const updateTemplateContent = (id: string, content: string) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content } : t))
    );
  };

  const toggleUserSMS = (userId: number) => {
    setUserPrefs((prev) =>
      prev.map((u) => (u.userId === userId ? { ...u, enabled: !u.enabled } : u))
    );
  };

  const updateUserPhone = (userId: number, phone: string) => {
    setUserPrefs((prev) =>
      prev.map((u) => (u.userId === userId ? { ...u, phone } : u))
    );
  };

  const tabs = [
    { key: 'settings' as const, label: 'Provider Settings', icon: Webhook },
    { key: 'templates' as const, label: 'SMS Templates', icon: MessageSquare },
    { key: 'logs' as const, label: 'Delivery Log', icon: History },
    { key: 'users' as const, label: 'User Settings', icon: UserCheck },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-medium text-[#1f1f1f]">SMS Settings</h1>
        <p className="mt-1 text-sm text-[#595959]">
          Configure SMS notifications for critical alerts
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-[#e5e0d5] bg-white p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
              activeTab === tab.key
                ? 'bg-[#c9a87c] text-[#1f1f1f]'
                : 'text-[#595959] hover:bg-[#fbf9f4]'
            )}
          >
            <tab.icon size={15} />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="rounded-xl border border-[#e5e0d5] bg-white p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e6f0ff]">
                <Phone size={20} className="text-[#1890ff]" />
              </div>
              <div>
                <h3 className="text-base font-medium text-[#1f1f1f]">SMS Notifications</h3>
                <p className="text-xs text-[#8a8a8a]">Send critical alerts via SMS</p>
              </div>
            </div>
            <button
              onClick={() => setSmsEnabled(!smsEnabled)}
              className={cn(
                'flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                smsEnabled
                  ? 'bg-[#e6f0ff] text-[#1890ff]'
                  : 'bg-[#f5f5f5] text-[#8a8a8a]'
              )}
            >
              {smsEnabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              {smsEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="space-y-4">
            {/* Provider */}
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                Provider
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="h-10 w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
              >
                <option value="twilio">Twilio</option>
                <option value="aws_sns">AWS SNS</option>
                <option value="vonage">Vonage (Nexmo)</option>
                <option value="messagebird">MessageBird</option>
              </select>
            </div>

            {/* Account SID */}
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                Account SID / API Key
              </label>
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                <input
                  type="text"
                  value={accountSid}
                  onChange={(e) => setAccountSid(e.target.value)}
                  className="h-10 w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] pl-9 pr-3 text-sm font-mono text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                />
              </div>
            </div>

            {/* Auth Token */}
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                Auth Token / Secret
              </label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                className="h-10 w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm font-mono text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
              />
            </div>

            {/* From Number */}
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                From Phone Number
              </label>
              <div className="relative">
                <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                <input
                  type="text"
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  className={cn(
                    'h-10 w-full rounded-lg border bg-[#fbf9f4] pl-9 pr-3 text-sm font-mono text-[#1f1f1f] outline-none',
                    validatePhone(fromNumber) ? 'border-[#e5e0d5] focus:border-[#c9a87c]' : 'border-[#f5222d]'
                  )}
                />
              </div>
              {!validatePhone(fromNumber) && (
                <p className="mt-1 text-xs text-[#f5222d]">
                  Invalid phone number format. Use +1234567890
                </p>
              )}
            </div>

            {/* Test */}
            <div className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Send size={14} className="text-[#c9a87c]" />
                <span className="text-sm font-medium text-[#1f1f1f]">Test Connection</span>
              </div>
              <p className="mb-3 text-xs text-[#595959]">
                Send a test SMS to verify your configuration
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="+1234567890"
                  className="h-10 flex-1 rounded-lg border border-[#e5e0d5] bg-white px-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                />
                <button className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95">
                  <Send size={14} />
                  Test
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSave}
                className="flex items-center gap-2 rounded-lg bg-[#c9a87c] px-5 py-2.5 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95"
              >
                {saved ? <Check size={16} /> : <Save size={16} />}
                {saved ? 'Saved!' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-[#e5e0d5] bg-white p-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare size={16} className="text-[#c9a87c]" />
                  <h4 className="text-sm font-medium text-[#1f1f1f]">{t.name}</h4>
                </div>
                <button
                  onClick={() => toggleTemplate(t.id)}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                    t.enabled
                      ? 'bg-[#e6f0ff] text-[#1890ff]'
                      : 'bg-[#f5f5f5] text-[#8a8a8a]'
                  )}
                >
                  {t.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  {t.enabled ? 'On' : 'Off'}
                </button>
              </div>
              <textarea
                value={t.content}
                onChange={(e) => updateTemplateContent(t.id, e.target.value)}
                rows={2}
                disabled={!t.enabled}
                className="w-full resize-none rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c] disabled:opacity-50"
              />
            </div>
          ))}
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <div className="rounded-xl border border-[#e5e0d5] bg-white">
          <div className="flex items-center gap-2 border-b border-[#e5e0d5] px-5 py-3">
            <History size={16} className="text-[#c9a87c]" />
            <h3 className="text-sm font-medium text-[#1f1f1f]">SMS Delivery Log</h3>
          </div>
          <div className="divide-y divide-[#e5e0d5]">
            {SAMPLE_LOGS.map((log) => (
              <div key={log.id} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#1f1f1f]">{log.to}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium',
                        log.status === 'sent'
                          ? 'bg-[#f6ffed] text-[#52c41a]'
                          : log.status === 'failed'
                          ? 'bg-[#fff2e8] text-[#f5222d]'
                          : 'bg-[#fff7e6] text-[#faad14]'
                      )}
                    >
                      {log.status}
                    </span>
                  </div>
                  <span className="text-xs text-[#8a8a8a]">
                    <Clock size={12} className="mr-1 inline" />
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="mb-1 text-sm text-[#595959]">{log.message}</p>
                <span className="text-xs text-[#8a8a8a]">Template: {log.template}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="rounded-xl border border-[#e5e0d5] bg-white">
          <div className="flex items-center gap-2 border-b border-[#e5e0d5] px-5 py-3">
            <UserCheck size={16} className="text-[#c9a87c]" />
            <h3 className="text-sm font-medium text-[#1f1f1f]">Per-User SMS Settings</h3>
          </div>
          <div className="divide-y divide-[#e5e0d5]">
            {userPrefs.map((u) => (
              <div key={u.userId} className="flex items-center gap-4 px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-xs font-bold text-[#c9a87c]">
                  {u.name.split(' ').map((n) => n[0]).join('').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#1f1f1f]">{u.name}</p>
                  <p className="text-xs text-[#8a8a8a]">User ID: {u.userId}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={u.phone}
                    onChange={(e) => updateUserPhone(u.userId, e.target.value)}
                    placeholder="+1234567890"
                    className={cn(
                      'h-9 w-40 rounded-lg border bg-[#fbf9f4] px-3 text-sm outline-none',
                      u.phone && !validatePhone(u.phone) ? 'border-[#f5222d]' : 'border-[#e5e0d5] focus:border-[#c9a87c]'
                    )}
                  />
                  <button
                    onClick={() => toggleUserSMS(u.userId)}
                    className={cn(
                      'flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                      u.enabled
                        ? 'bg-[#e6f0ff] text-[#1890ff]'
                        : 'bg-[#f5f5f5] text-[#8a8a8a]'
                    )}
                  >
                    {u.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    {u.enabled ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
