/**
 * CommunicationHistory — All communication timeline for a ticket/user
 * Route: /communication-history
 */
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  Lock,
  Globe,
  Mail,
  Bell,
  Download,
  Search,
  FileText,
  Clock,
} from 'lucide-react';

interface CommEntry {
  id: string;
  type: 'comment' | 'internal_note' | 'email' | 'system';
  content: string;
  author: string;
  authorRole: string;
  timestamp: string;
  metadata?: Record<string, string>;
  threadId?: string;
}

const SAMPLE_ENTRIES: CommEntry[] = [
  {
    id: '1',
    type: 'system',
    content: 'Ticket TKT-1234 created by John Doe',
    author: 'System',
    authorRole: 'system',
    timestamp: '2024-01-15T09:00:00Z',
  },
  {
    id: '2',
    type: 'comment',
    content: 'I am experiencing a critical issue with the server. Connection timeouts every few minutes.',
    author: 'John Doe',
    authorRole: 'customer',
    timestamp: '2024-01-15T09:05:00Z',
  },
  {
    id: '3',
    type: 'internal_note',
    content: 'This looks like a network configuration issue. Need to check the load balancer settings. @Alice Johnson can you take a look?',
    author: 'Jane Smith',
    authorRole: 'agent',
    timestamp: '2024-01-15T09:30:00Z',
  },
  {
    id: '4',
    type: 'email',
    content: 'Subject: Ticket #TKT-1234 - Acknowledgement\n\nHi John,\n\nWe have received your ticket and are investigating the issue.\n\nBest,\nSupport Team',
    author: 'support@company.com',
    authorRole: 'system',
    timestamp: '2024-01-15T09:35:00Z',
  },
  {
    id: '5',
    type: 'comment',
    content: 'I checked the load balancer and found a misconfiguration in the health check endpoint. I will fix it now.',
    author: 'Alice Johnson',
    authorRole: 'agent',
    timestamp: '2024-01-15T10:00:00Z',
  },
  {
    id: '6',
    type: 'system',
    content: 'Status changed from Open to In Progress by Alice Johnson',
    author: 'System',
    authorRole: 'system',
    timestamp: '2024-01-15T10:05:00Z',
  },
  {
    id: '7',
    type: 'internal_note',
    content: 'Fixed the health check config. Monitoring for stability.',
    author: 'Alice Johnson',
    authorRole: 'agent',
    timestamp: '2024-01-15T11:00:00Z',
  },
  {
    id: '8',
    type: 'comment',
    content: 'The issue seems to be resolved. Connections are stable now. Thank you!',
    author: 'John Doe',
    authorRole: 'customer',
    timestamp: '2024-01-15T11:30:00Z',
  },
  {
    id: '9',
    type: 'email',
    content: 'Subject: Ticket #TKT-1234 resolved\n\nHi John,\n\nGreat news! Your ticket has been resolved.\n\nBest,\nAlice Johnson',
    author: 'alice@company.com',
    authorRole: 'agent',
    timestamp: '2024-01-15T12:00:00Z',
  },
  {
    id: '10',
    type: 'system',
    content: 'Ticket resolved by Alice Johnson',
    author: 'System',
    authorRole: 'system',
    timestamp: '2024-01-15T12:05:00Z',
  },
];

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  comment: {
    label: 'Public Comment',
    color: 'text-[#1890ff]',
    bg: 'bg-[#e6f0ff]',
    icon: <Globe size={13} />,
  },
  internal_note: {
    label: 'Internal Note',
    color: 'text-[#d48806]',
    bg: 'bg-[#fff7e6]',
    icon: <Lock size={13} />,
  },
  email: {
    label: 'Email',
    color: 'text-[#52c41a]',
    bg: 'bg-[#f6ffed]',
    icon: <Mail size={13} />,
  },
  system: {
    label: 'System',
    color: 'text-[#8a8a8a]',
    bg: 'bg-[#f5f5f5]',
    icon: <Bell size={13} />,
  },
};

export default function CommunicationHistory() {
  const [entries] = useState<CommEntry[]>(SAMPLE_ENTRIES);
  const [filterType, setFilterType] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [threadFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterType !== 'all' && e.type !== filterType) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.content.toLowerCase().includes(q) &&
          !e.author.toLowerCase().includes(q)
        )
          return false;
      }
      if (dateFrom && new Date(e.timestamp) < new Date(dateFrom)) return false;
      if (dateTo && new Date(e.timestamp) > new Date(dateTo + 'T23:59:59')) return false;
      if (threadFilter && e.threadId !== threadFilter) return false;
      return true;
    });
  }, [entries, filterType, search, dateFrom, dateTo, threadFilter]);

  const handleExportPDF = () => {
    const content = filtered
      .map(
        (e) =>
          `[${new Date(e.timestamp).toLocaleString()}] ${TYPE_CONFIG[e.type]?.label || e.type} - ${e.author}\n${e.content}\n---`
      )
      .join('\n\n');
    const blob = new Blob(
      [`COMMUNICATION HISTORY\nGenerated: ${new Date().toLocaleString()}\n\n${content}`],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `communication-history-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const typeFilters = [
    { key: 'all', label: 'All' },
    { key: 'comment', label: 'Comments' },
    { key: 'internal_note', label: 'Internal Notes' },
    { key: 'email', label: 'Emails' },
    { key: 'system', label: 'System' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium text-[#1f1f1f]">Communication History</h1>
          <p className="mt-1 text-sm text-[#595959]">
            Complete communication timeline for ticket TKT-1234
          </p>
        </div>
        <button
          onClick={handleExportPDF}
          className="flex items-center gap-2 rounded-lg border border-[#e5e0d5] bg-white px-4 py-2.5 text-sm text-[#595959] transition-colors hover:bg-[#fbf9f4]"
        >
          <Download size={16} />
          Export
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Type filter */}
          <div className="flex gap-1 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] p-0.5">
            {typeFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilterType(f.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  filterType === f.key
                    ? 'bg-[#c9a87c] text-[#1f1f1f]'
                    : 'text-[#595959] hover:bg-white'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-9 w-48 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] pl-8 pr-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
            />
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
            />
            <span className="text-sm text-[#8a8a8a]">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
            />
          </div>

          {/* Clear filters */}
          {(filterType !== 'all' || search || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setFilterType('all');
                setSearch('');
                setDateFrom('');
                setDateTo('');
              }}
              className="h-9 rounded-lg px-3 text-xs text-[#595959] transition-colors hover:bg-[#f5f0e8]"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Count */}
        <div className="mt-3 text-xs text-[#8a8a8a]">
          Showing {filtered.length} of {entries.length} entries
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-[#e5e0d5]" />

        <div className="space-y-4">
          {filtered.map((entry, idx) => {
            const config = TYPE_CONFIG[entry.type] || TYPE_CONFIG.system;
            const isInternal = entry.type === 'internal_note';
            return (
              <div
                key={entry.id}
                className="relative flex gap-4 animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${idx * 0.03}s`, animationFillMode: 'backwards' }}
              >
                {/* Dot */}
                <div
                  className={cn(
                    'relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                    config.bg
                  )}
                >
                  <span className={config.color}>{config.icon}</span>
                </div>

                {/* Content */}
                <div
                  className={cn(
                    'min-w-0 flex-1 rounded-xl border p-4',
                    isInternal
                      ? 'border-[#ffd666] bg-[#fffbe6]'
                      : 'border-[#e5e0d5] bg-white'
                  )}
                >
                  {/* Header */}
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium',
                        config.bg,
                        config.color
                      )}
                    >
                      {config.icon}
                      {config.label}
                    </span>
                    {isInternal && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[#fff7e6] px-2 py-0.5 text-[10px] font-medium text-[#d48806]">
                        <Lock size={10} />
                        Internal
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1 text-xs text-[#8a8a8a]">
                      <Clock size={11} />
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>

                  {/* Author */}
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-[9px] font-bold text-[#c9a87c]">
                      {entry.author
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-[#1f1f1f]">{entry.author}</span>
                    {entry.authorRole && (
                      <span className="rounded-full bg-[#f5f0e8] px-2 py-0.5 text-[10px] text-[#595959] capitalize">
                        {entry.authorRole}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="text-sm leading-relaxed text-[#1f1f1f] whitespace-pre-wrap">
                    {entry.content}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center py-12 text-center">
            <FileText size={40} className="mb-3 text-[#e5e0d5]" />
            <p className="text-sm text-[#8a8a8a]">No entries match your filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
