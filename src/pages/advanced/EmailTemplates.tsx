/**
 * EmailTemplates — Manage email notification templates
 * Route: /email-templates
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Mail,
  Plus,
  Save,
  Eye,
  Code,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Copy,
  Search,
  Check,
} from 'lucide-react';

interface EmailTemplate {
  id: string;
  name: string;
  event: string;
  subject: string;
  body: string;
  enabled: boolean;
  htmlMode: boolean;
  variables: string[];
}

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    id: '1',
    name: 'Ticket Created',
    event: 'ticket_created',
    subject: 'Ticket #{{ticket.id}} created: {{ticket.title}}',
    body: `Hi {{user.name}},

Your ticket #{{ticket.id}} has been successfully created.

Title: {{ticket.title}}
Status: {{ticket.status}}
Priority: {{ticket.priority}}

You can view your ticket here: {{ticket.url}}

Best regards,
{{app.name}} Support Team`,
    enabled: true,
    htmlMode: false,
    variables: ['ticket.id', 'ticket.title', 'ticket.status', 'ticket.priority', 'ticket.url', 'user.name', 'app.name'],
  },
  {
    id: '2',
    name: 'Ticket Assigned',
    event: 'ticket_assigned',
    subject: 'Ticket #{{ticket.id}} assigned to {{agent.name}}',
    body: `Hi {{user.name}},

Your ticket #{{ticket.id}} has been assigned to {{agent.name}}.

Title: {{ticket.title}}
Assigned Agent: {{agent.name}}

Best regards,
{{app.name}} Support Team`,
    enabled: true,
    htmlMode: false,
    variables: ['ticket.id', 'ticket.title', 'agent.name', 'user.name', 'app.name'],
  },
  {
    id: '3',
    name: 'Status Changed',
    event: 'status_changed',
    subject: 'Update on Ticket #{{ticket.id}} - Status: {{ticket.status}}',
    body: `Hi {{user.name}},

The status of your ticket #{{ticket.id}} has been updated to {{ticket.status}}.

Title: {{ticket.title}}
New Status: {{ticket.status}}

Best regards,
{{agent.name}}`,
    enabled: true,
    htmlMode: false,
    variables: ['ticket.id', 'ticket.title', 'ticket.status', 'user.name', 'agent.name'],
  },
  {
    id: '4',
    name: 'Ticket Resolved',
    event: 'ticket_resolved',
    subject: 'Ticket #{{ticket.id}} resolved',
    body: `Hi {{user.name}},

Great news! Your ticket #{{ticket.id}} has been resolved.

Title: {{ticket.title}}
Resolved by: {{agent.name}}

If you believe this issue is not resolved, please reply to reopen the ticket.

Best regards,
{{agent.name}}`,
    enabled: true,
    htmlMode: false,
    variables: ['ticket.id', 'ticket.title', 'user.name', 'agent.name'],
  },
  {
    id: '5',
    name: 'SLA Breach',
    event: 'sla_breach',
    subject: 'URGENT: SLA Breach Alert - Ticket #{{ticket.id}}',
    body: `Hi {{agent.name}},

This is an automated alert. Ticket #{{ticket.id}} has breached its SLA.

Title: {{ticket.title}}
Priority: {{ticket.priority}}
Status: {{ticket.status}}

Please take immediate action.

{{app.name}}`,
    enabled: true,
    htmlMode: false,
    variables: ['ticket.id', 'ticket.title', 'ticket.priority', 'ticket.status', 'agent.name', 'app.name'],
  },
  {
    id: '6',
    name: 'Comment Added',
    event: 'comment_added',
    subject: 'New comment on Ticket #{{ticket.id}}',
    body: `Hi {{user.name}},

A new comment has been added to your ticket #{{ticket.id}}.

Title: {{ticket.title}}
Comment by: {{agent.name}}

You can view the comment here: {{ticket.url}}

Best regards,
{{app.name}} Support Team`,
    enabled: true,
    htmlMode: false,
    variables: ['ticket.id', 'ticket.title', 'user.name', 'agent.name', 'ticket.url', 'app.name'],
  },
];

const ALL_VARIABLES = [
  { key: '{{ticket.id}}', desc: 'Ticket ID' },
  { key: '{{ticket.title}}', desc: 'Ticket Title' },
  { key: '{{ticket.status}}', desc: 'Ticket Status' },
  { key: '{{ticket.priority}}', desc: 'Ticket Priority' },
  { key: '{{ticket.url}}', desc: 'Ticket URL' },
  { key: '{{agent.name}}', desc: 'Assigned Agent' },
  { key: '{{user.name}}', desc: 'Requester Name' },
  { key: '{{app.name}}', desc: 'App Name' },
];

const SAMPLE_DATA: Record<string, string> = {
  '{{ticket.id}}': 'TKT-1234',
  '{{ticket.title}}': 'Server connection timeout error',
  '{{ticket.status}}': 'In Progress',
  '{{ticket.priority}}': 'High',
  '{{ticket.url}}': 'https://vedadesk.com/tickets/1234',
  '{{agent.name}}': 'Jane Smith',
  '{{user.name}}': 'John Doe',
  '{{app.name}}': 'VedaDesk',
};

function renderPreview(text: string): string {
  return text.replace(/\{\{[^}]+\}\}/g, (match) => SAMPLE_DATA[match] || match);
}

export default function EmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>(DEFAULT_TEMPLATES);
  const [selectedId, setSelectedId] = useState<string>('1');
  const [search, setSearch] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [savedMap, setSavedMap] = useState<Record<string, boolean>>({});

  const selected = templates.find((t) => t.id === selectedId) || templates[0];

  const updateTemplate = (id: string, updates: Partial<EmailTemplate>) => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const handleSave = (id: string) => {
    setSavedMap((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => setSavedMap((prev) => ({ ...prev, [id]: false })), 2000);
  };

  const toggleEnabled = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (t) updateTemplate(id, { enabled: !t.enabled });
  };

  const toggleHtmlMode = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (t) updateTemplate(id, { htmlMode: !t.htmlMode });
  };

  const duplicateTemplate = (t: EmailTemplate) => {
    const newT: EmailTemplate = {
      ...t,
      id: Date.now().toString(),
      name: `${t.name} (Copy)`,
      enabled: false,
    };
    setTemplates((prev) => [...prev, newT]);
    setSelectedId(newT.id);
  };

  const deleteTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    if (selectedId === id) setSelectedId(templates[0]?.id || '');
  };

  const filtered = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.event.toLowerCase().includes(search.toLowerCase())
  );

  const insertVariable = (key: string) => {
    if (!selected) return;
    updateTemplate(selected.id, { body: selected.body + ' ' + key });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium text-[#1f1f1f]">Email Templates</h1>
          <p className="mt-1 text-sm text-[#595959]">
            Manage email notification templates for ticket events
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="h-10 w-56 rounded-lg border border-[#e5e0d5] bg-white pl-9 pr-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
            />
          </div>
          <button
            onClick={() => {
              const newT: EmailTemplate = {
                id: Date.now().toString(),
                name: 'New Template',
                event: 'custom',
                subject: '',
                body: '',
                enabled: false,
                htmlMode: false,
                variables: [],
              };
              setTemplates((prev) => [...prev, newT]);
              setSelectedId(newT.id);
            }}
            className="flex items-center gap-2 rounded-lg bg-[#c9a87c] px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95"
          >
            <Plus size={16} />
            New Template
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Template List */}
        <div className="space-y-2 lg:col-span-1">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                selectedId === t.id
                  ? 'border-[#c9a87c] bg-[rgba(201,168,124,0.08)]'
                  : 'border-[#e5e0d5] bg-white hover:bg-[#fbf9f4]'
              )}
            >
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  t.enabled ? 'bg-[#e6f0ff]' : 'bg-[#f5f5f5]'
                )}
              >
                <Mail size={16} className={t.enabled ? 'text-[#1890ff]' : 'text-[#8a8a8a]'} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#1f1f1f]">{t.name}</p>
                <p className="text-xs text-[#8a8a8a]">{t.event}</p>
              </div>
              {t.enabled ? (
                <span className="shrink-0 rounded-full bg-[#e6f0ff] px-2 py-0.5 text-[10px] font-medium text-[#1890ff]">
                  Active
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-[#f5f5f5] px-2 py-0.5 text-[10px] font-medium text-[#8a8a8a]">
                  Off
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="lg:col-span-2 space-y-4">
          {selected && (
            <div className="rounded-xl border border-[#e5e0d5] bg-white">
              {/* Editor header */}
              <div className="flex flex-wrap items-center justify-between border-b border-[#e5e0d5] px-5 py-3">
                <h3 className="text-sm font-medium text-[#1f1f1f]">{selected.name}</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleEnabled(selected.id)}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                      selected.enabled
                        ? 'bg-[#e6f0ff] text-[#1890ff]'
                        : 'bg-[#f5f5f5] text-[#8a8a8a]'
                    )}
                  >
                    {selected.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    {selected.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    onClick={() => toggleHtmlMode(selected.id)}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                      selected.htmlMode
                        ? 'bg-[rgba(201,168,124,0.2)] text-[#c9a87c]'
                        : 'bg-[#f5f5f5] text-[#8a8a8a]'
                    )}
                  >
                    <Code size={14} />
                    HTML
                  </button>
                  <button
                    onClick={() => duplicateTemplate(selected)}
                    className="rounded-md p-1.5 text-[#595959] transition-colors hover:bg-[#f5f0e8]"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => deleteTemplate(selected.id)}
                    className="rounded-md p-1.5 text-[#f5222d] transition-colors hover:bg-[#fff2e8]"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-4 p-5">
                {/* Subject */}
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={selected.subject}
                    onChange={(e) => updateTemplate(selected.id, { subject: e.target.value })}
                    className="h-10 w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
                  />
                </div>

                {/* Variables */}
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    Variables — click to insert
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_VARIABLES.map((v) => (
                      <button
                        key={v.key}
                        onClick={() => insertVariable(v.key)}
                        className="rounded-md border border-[#e5e0d5] bg-[#fbf9f4] px-2 py-1 text-xs text-[#595959] transition-colors hover:border-[#c9a87c] hover:text-[#c9a87c]"
                      >
                        {v.key}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Body */}
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    Body
                  </label>
                  <textarea
                    value={selected.body}
                    onChange={(e) => updateTemplate(selected.id, { body: e.target.value })}
                    rows={12}
                    className="w-full resize-none rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-4 py-3 font-mono text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
                  />
                </div>

                {/* Preview toggle */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="flex items-center gap-1.5 rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm text-[#595959] transition-colors hover:bg-[#fbf9f4]"
                  >
                    <Eye size={14} />
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                  </button>
                  <button
                    onClick={() => handleSave(selected.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95"
                  >
                    {savedMap[selected.id] ? (
                      <>
                        <Check size={14} />
                        Saved
                      </>
                    ) : (
                      <>
                        <Save size={14} />
                        Save Template
                      </>
                    )}
                  </button>
                </div>

                {/* Preview */}
                {showPreview && (
                  <div className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] p-4">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.1em] text-[#8a8a8a]">
                      Preview with sample data
                    </p>
                    <div className="rounded-md bg-white p-4">
                      <p className="mb-1 text-xs font-medium text-[#8a8a8a]">Subject:</p>
                      <p className="mb-3 text-sm font-medium text-[#1f1f1f]">
                        {renderPreview(selected.subject)}
                      </p>
                      <hr className="mb-3 border-[#e5e0d5]" />
                      <p className="mb-1 text-xs font-medium text-[#8a8a8a]">Body:</p>
                      <pre className="whitespace-pre-wrap text-sm leading-relaxed text-[#1f1f1f]">
                        {renderPreview(selected.body)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
