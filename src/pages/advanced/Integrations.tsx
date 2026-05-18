/**
 * Integrations — Third-party integration hub
 * Route: /integrations
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Plug,
  Unplug,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Webhook,
  Copy,
  Check,
  Activity,
  Search,
  ShieldCheck,
  GitBranch,
  Bug,
  BellDot,
  Gauge,
  MessageSquare,
  Users,
  Wrench,
  Code2,
} from 'lucide-react';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  connected: boolean;
  webhookUrl: string;
  lastSynced: string;
  events: string[];
}

const DEFAULT_INTEGRATIONS: Integration[] = [
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send ticket notifications to Slack channels',
    icon: MessageSquare,
    iconColor: '#611f69',
    iconBg: '#f3e5f5',
    connected: true,
    webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXXX',
    lastSynced: '2024-01-15T14:30:00Z',
    events: ['ticket.created', 'ticket.assigned', 'comment.added'],
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    description: 'Post ticket updates to Teams channels',
    icon: Users,
    iconColor: '#6264a7',
    iconBg: '#e8eaf6',
    connected: false,
    webhookUrl: 'https://outlook.office.com/webhook/XXXX',
    lastSynced: '',
    events: ['ticket.created', 'status.changed'],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Link tickets to GitHub issues and PRs',
    icon: Code2,
    iconColor: '#24292e',
    iconBg: '#f5f5f5',
    connected: true,
    webhookUrl: 'https://api.github.com/repos/org/repo/hooks/123',
    lastSynced: '2024-01-15T12:00:00Z',
    events: ['issue.created', 'pr.merged'],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Sync tickets with GitLab issues',
    icon: GitBranch,
    iconColor: '#fc6d26',
    iconBg: '#fff3e0',
    connected: false,
    webhookUrl: 'https://gitlab.com/api/v4/projects/123/hooks',
    lastSynced: '',
    events: ['issue.created', 'merge_request.merged'],
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    description: 'Trigger builds on ticket status changes',
    icon: Wrench,
    iconColor: '#d33833',
    iconBg: '#ffebee',
    connected: false,
    webhookUrl: 'https://jenkins.company.com/github-webhook/',
    lastSynced: '',
    events: ['ticket.resolved'],
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Bidirectional sync with Jira issues',
    icon: Bug,
    iconColor: '#0052cc',
    iconBg: '#e3f2fd',
    connected: true,
    webhookUrl: 'https://company.atlassian.net/rest/api/2/issue/',
    lastSynced: '2024-01-15T10:00:00Z',
    events: ['ticket.created', 'ticket.assigned', 'status.changed', 'comment.added'],
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    description: 'Escalate critical tickets to on-call',
    icon: BellDot,
    iconColor: '#06ac38',
    iconBg: '#e8f5e9',
    connected: true,
    webhookUrl: 'https://events.pagerduty.com/integration/XXXX/enqueue',
    lastSynced: '2024-01-15T14:25:00Z',
    events: ['sla.breach', 'ticket.escalated'],
  },
  {
    id: 'datadog',
    name: 'Datadog',
    description: 'Send metrics and events to Datadog',
    icon: Gauge,
    iconColor: '#632ca6',
    iconBg: '#f3e5f5',
    connected: false,
    webhookUrl: 'https://app.datadoghq.com/api/v1/events',
    lastSynced: '',
    events: ['ticket.metrics', 'sla.breach'],
  },
];

const ACTIVITY_LOGS = [
  { id: '1', integration: 'Slack', action: 'Ticket #1234 notification sent', status: 'success', time: '2024-01-15T14:30:00Z' },
  { id: '2', integration: 'Jira', action: 'Issue TKT-1234 synced to JIRA-567', status: 'success', time: '2024-01-15T14:15:00Z' },
  { id: '3', integration: 'PagerDuty', action: 'SLA breach alert escalated', status: 'success', time: '2024-01-15T14:00:00Z' },
  { id: '4', integration: 'GitHub', action: 'Failed to create issue: rate limit', status: 'error', time: '2024-01-15T13:45:00Z' },
  { id: '5', integration: 'Slack', action: 'Webhook test successful', status: 'success', time: '2024-01-15T13:30:00Z' },
];

export default function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>(DEFAULT_INTEGRATIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const selected = integrations.find((i) => i.id === selectedId);

  const toggleConnection = (id: string) => {
    setIntegrations((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, connected: !i.connected, lastSynced: i.connected ? '' : new Date().toISOString() } : i
      )
    );
  };

  const updateWebhook = (id: string, url: string) => {
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, webhookUrl: url } : i))
    );
  };

  const copyWebhook = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const testConnection = (id: string) => {
    setTestingId(id);
    setTimeout(() => setTestingId(null), 1500);
  };

  const filtered = integrations.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.description.toLowerCase().includes(search.toLowerCase())
  );

  const connectedCount = integrations.filter((i) => i.connected).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium text-[#1f1f1f]">Integrations</h1>
          <p className="mt-1 text-sm text-[#595959]">
            {connectedCount} of {integrations.length} integrations connected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search integrations..."
              className="h-10 w-56 rounded-lg border border-[#e5e0d5] bg-white pl-9 pr-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
            />
          </div>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition-colors',
              showLogs
                ? 'border-[#c9a87c] bg-[rgba(201,168,124,0.1)] text-[#1f1f1f]'
                : 'border-[#e5e0d5] bg-white text-[#595959] hover:bg-[#fbf9f4]'
            )}
          >
            <Activity size={15} />
            Activity Log
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Integration Cards */}
        <div className="space-y-3 lg:col-span-1">
          {filtered.map((integration) => (
            <button
              key={integration.id}
              onClick={() => setSelectedId(integration.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                selectedId === integration.id
                  ? 'border-[#c9a87c] bg-[rgba(201,168,124,0.08)]'
                  : 'border-[#e5e0d5] bg-white hover:bg-[#fbf9f4]'
              )}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: integration.iconBg }}
              >
                <integration.icon size={20} style={{ color: integration.iconColor }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#1f1f1f]">{integration.name}</p>
                <p className="truncate text-xs text-[#8a8a8a]">{integration.description}</p>
              </div>
              {integration.connected ? (
                <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#52c41a]" title="Connected" />
              ) : (
                <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#d9d9d9]" title="Disconnected" />
              )}
            </button>
          ))}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {showLogs ? (
            <div className="rounded-xl border border-[#e5e0d5] bg-white">
              <div className="flex items-center gap-2 border-b border-[#e5e0d5] px-5 py-3">
                <Activity size={16} className="text-[#c9a87c]" />
                <h3 className="text-sm font-medium text-[#1f1f1f]">Integration Activity Log</h3>
              </div>
              <div className="divide-y divide-[#e5e0d5]">
                {ACTIVITY_LOGS.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 px-5 py-3">
                    {log.status === 'success' ? (
                      <CheckCircle2 size={16} className="shrink-0 text-[#52c41a]" />
                    ) : (
                      <XCircle size={16} className="shrink-0 text-[#f5222d]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#1f1f1f]">{log.action}</p>
                      <p className="text-xs text-[#8a8a8a]">{log.integration}</p>
                    </div>
                    <span className="shrink-0 text-xs text-[#8a8a8a]">
                      {new Date(log.time).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : selected ? (
            <div className="rounded-xl border border-[#e5e0d5] bg-white">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[#e5e0d5] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ backgroundColor: selected.iconBg }}
                  >
                    <selected.icon size={24} style={{ color: selected.iconColor }} />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-[#1f1f1f]">{selected.name}</h3>
                    <p className="text-xs text-[#8a8a8a]">{selected.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => testConnection(selected.id)}
                    disabled={testingId === selected.id}
                    className="flex items-center gap-1.5 rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm text-[#595959] transition-colors hover:bg-[#fbf9f4] disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={testingId === selected.id ? 'animate-spin' : ''} />
                    {testingId === selected.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => toggleConnection(selected.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                      selected.connected
                        ? 'border border-[#f5222d] bg-[#fff2e8] text-[#f5222d] hover:bg-[#f5222d] hover:text-white'
                        : 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95'
                    )}
                  >
                    {selected.connected ? (
                      <>
                        <Unplug size={14} />
                        Disconnect
                      </>
                    ) : (
                      <>
                        <Plug size={14} />
                        Connect
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-5 p-5">
                {/* Status */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#595959]">Status:</span>
                  {selected.connected ? (
                    <span className="flex items-center gap-1 rounded-full bg-[#f6ffed] px-2.5 py-0.5 text-xs font-medium text-[#52c41a]">
                      <CheckCircle2 size={12} />
                      Connected
                      {selected.lastSynced && (
                        <span className="ml-1 text-[#8a8a8a]">
                          (last synced {new Date(selected.lastSynced).toLocaleString()})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-[#f5f5f5] px-2.5 py-0.5 text-xs font-medium text-[#8a8a8a]">
                      <XCircle size={12} />
                      Disconnected
                    </span>
                  )}
                </div>

                {/* Webhook URL */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    <Webhook size={12} />
                    Webhook URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={selected.webhookUrl}
                      onChange={(e) => updateWebhook(selected.id, e.target.value)}
                      className="h-10 flex-1 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm font-mono text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                    />
                    <button
                      onClick={() => copyWebhook(selected.id, selected.webhookUrl)}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e5e0d5] text-[#595959] transition-colors hover:bg-[#f5f0e8]"
                    >
                      {copiedId === selected.id ? <Check size={16} className="text-[#52c41a]" /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>

                {/* Events */}
                <div>
                  <label className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    <ShieldCheck size={12} />
                    Subscribed Events
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {selected.events.map((event) => (
                      <span
                        key={event}
                        className="rounded-md bg-[#fbf9f4] border border-[#e5e0d5] px-2.5 py-1 text-xs text-[#595959]"
                      >
                        {event}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e5e0d5] bg-[#fbf9f4] py-16 text-center">
              <Plug size={40} className="mb-3 text-[#e5e0d5]" />
              <p className="text-sm font-medium text-[#8a8a8a]">
                Select an integration to configure
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
