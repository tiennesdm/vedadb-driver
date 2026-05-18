/**
 * Tickets Page — Full ticket management interface
 */
import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTicketsList } from '@/hooks/useTickets';
import useAppStore from '@/lib/vedadb-store';
import StatusBadge from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import TicketFormModal from '@/components/tickets/TicketFormModal';
import DeleteConfirmDialog from '@/components/tickets/DeleteConfirmDialog';
import EmptyState from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import {
  Search,
  Plus,
  LayoutList,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  Filter,
  Loader2,
  Check,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'priority_high', label: 'Priority (High \u2192 Low)' },
  { value: 'priority_low', label: 'Priority (Low \u2192 High)' },
  { value: 'title_az', label: 'Title (A \u2192 Z)' },
  { value: 'title_za', label: 'Title (Z \u2192 A)' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'on_hold', label: 'On Hold' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function Tickets() {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const query = useAppStore((s) => s.query);

  const {
    tickets,
    users,
    categories,
    totalCount,
    loading,
    page,
    setPage,
    pageSize,
    setPageSize,
    filters,
    setFilters,
    activeFilterCount,
    refresh,
  } = useTicketsList();

  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<typeof tickets[0] | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    // Simple debounce via timeout
    setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: value }));
      setPage(1);
    }, 300);
  };

  const clearAllFilters = () => {
    setSearchInput('');
    setFilters({
      search: '',
      status: '',
      priority: '',
      category: '',
      assignedTo: '',
      sortBy: 'newest',
      sortDir: 'desc',
    });
    setPage(1);
  };

  const handleCreate = useCallback(async (data: {
    title: string;
    description: string;
    priority: string;
    category: string;
    assigned_to: number | null;
  }) => {
    await insert('tickets', {
      title: data.title,
      description: data.description,
      priority: data.priority,
      category: data.category,
      assigned_to: data.assigned_to,
      status: 'open',
      created_by: currentUser?.id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Add activity
    const result = await query(`SELECT id FROM tickets ORDER BY id DESC LIMIT 1`);
    const rows = result.toObjects() as unknown as { id: number }[];
    const newId = rows[0]?.id;
    if (newId && currentUser) {
      await insert('activities', {
        ticket_id: newId,
        user_id: currentUser.id,
        action: 'Ticket created',
        created_at: new Date().toISOString(),
      });
    }
    refresh();
  }, [insert, query, currentUser, refresh]);

  const handleUpdate = useCallback(async (data: {
    title: string;
    description: string;
    priority: string;
    category: string;
    assigned_to: number | null;
    status?: string;
  }) => {
    if (!editingTicket) return;
    await update('tickets', {
      title: data.title,
      description: data.description,
      priority: data.priority,
      category: data.category,
      assigned_to: data.assigned_to,
      ...(data.status ? { status: data.status } : {}),
      updated_at: new Date().toISOString(),
    }, { id: editingTicket.id });

    if (currentUser) {
      await insert('activities', {
        ticket_id: editingTicket.id,
        user_id: currentUser.id,
        action: 'Ticket updated',
        created_at: new Date().toISOString(),
      });
    }
    setEditingTicket(null);
    refresh();
  }, [editingTicket, update, insert, currentUser, refresh]);

  const handleDelete = useCallback(async () => {
    if (!deletingId) return;
    await deleteFrom('comments', { ticket_id: deletingId });
    await deleteFrom('activities', { ticket_id: deletingId });
    await deleteFrom('tickets', { id: deletingId });
    setDeletingId(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(deletingId);
      return next;
    });
    refresh();
  }, [deletingId, deleteFrom, refresh]);

  // Bulk actions
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === tickets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tickets.map((t) => t.id)));
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await deleteFrom('comments', { ticket_id: id });
      await deleteFrom('activities', { ticket_id: id });
      await deleteFrom('tickets', { id });
    }
    setSelectedIds(new Set());
    refresh();
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await update('tickets', { status: newStatus, updated_at: new Date().toISOString() }, { id });
      if (currentUser) {
        await insert('activities', {
          ticket_id: id,
          user_id: currentUser.id,
          action: `Bulk status changed to ${newStatus}`,
          created_at: new Date().toISOString(),
        });
      }
    }
    setSelectedIds(new Set());
    refresh();
  };

  const userMap = useMemo(() => {
    const map: Record<number, string> = {};
    users.forEach((u) => { map[u.id] = u.name; });
    return map;
  }, [users]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startItem = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalCount);

  // Generate pagination range
  const pageRange = useMemo(() => {
    const range: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) range.push(i);
    } else {
      range.push(1);
      if (page > 3) range.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) range.push(i);
      if (page < totalPages - 2) range.push('...');
      range.push(totalPages);
    }
    return range;
  }, [totalPages, page]);

  return (
    <div className="animate-in fade-in duration-300">
      {/* Top Bar */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-medium text-[#1f1f1f] sm:text-2xl">Tickets</h2>
            <span className="rounded-full bg-[#f5f0e8] px-2.5 py-0.5 text-xs font-medium text-[#595959]">
              {totalCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 sm:w-72 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search tickets..."
                className="h-9 w-full rounded-lg border border-[#e5e0d5] bg-white py-1 pl-9 pr-8 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c] focus:ring-2 focus:ring-[rgba(201,168,124,0.15)]"
              />
              {searchInput && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8a8a] hover:text-[#1f1f1f]"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* View Toggle */}
            <div className="hidden rounded-lg border border-[#e5e0d5] bg-white sm:flex">
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  'rounded-l-lg p-2 transition-colors',
                  viewMode === 'table' ? 'bg-[#f5f0e8] text-[#1f1f1f]' : 'text-[#8a8a8a] hover:text-[#595959]'
                )}
              >
                <LayoutList size={16} />
              </button>
              <button
                onClick={() => setViewMode('card')}
                className={cn(
                  'rounded-r-lg p-2 transition-colors',
                  viewMode === 'card' ? 'bg-[#f5f0e8] text-[#1f1f1f]' : 'text-[#8a8a8a] hover:text-[#595959]'
                )}
              >
                <LayoutGrid size={16} />
              </button>
            </div>

            {/* New Ticket */}
            <button
              onClick={() => { setEditingTicket(null); setFormOpen(true); }}
              className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-3 py-2 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">New Ticket</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-4 border-b border-[#e5e0d5] pb-4">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors sm:hidden',
              activeFilterCount > 0 ? 'bg-[#c9a87c]/15 text-[#c9a87c]' : 'bg-[#f5f0e8] text-[#595959]'
            )}
          >
            <Filter size={14} />
            Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
        </div>

        <div className={cn(
          'flex flex-wrap items-end gap-3',
          !showFilters && 'hidden sm:flex'
        )}>
          {/* Status Filter */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.1em] text-[#595959]">Status</label>
            <select
              value={filters.status}
              onChange={(e) => { setFilters((p) => ({ ...p, status: e.target.value })); setPage(1); }}
              className="h-9 rounded-lg border-none bg-[#f5f0e8] px-3 pr-8 text-sm text-[#1f1f1f] outline-none cursor-pointer"
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Priority Filter */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.1em] text-[#595959]">Priority</label>
            <select
              value={filters.priority}
              onChange={(e) => { setFilters((p) => ({ ...p, priority: e.target.value })); setPage(1); }}
              className="h-9 rounded-lg border-none bg-[#f5f0e8] px-3 pr-8 text-sm text-[#1f1f1f] outline-none cursor-pointer"
            >
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Category Filter */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.1em] text-[#595959]">Category</label>
            <select
              value={filters.category}
              onChange={(e) => { setFilters((p) => ({ ...p, category: e.target.value })); setPage(1); }}
              className="h-9 rounded-lg border-none bg-[#f5f0e8] px-3 pr-8 text-sm text-[#1f1f1f] outline-none cursor-pointer"
            >
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          {/* Assignee Filter */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.1em] text-[#595959]">Assigned To</label>
            <select
              value={filters.assignedTo}
              onChange={(e) => { setFilters((p) => ({ ...p, assignedTo: e.target.value })); setPage(1); }}
              className="h-9 rounded-lg border-none bg-[#f5f0e8] px-3 pr-8 text-sm text-[#1f1f1f] outline-none cursor-pointer"
            >
              <option value="">All Agents</option>
              {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
          </div>

          {/* Sort */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.1em] text-[#595959]">Sort</label>
            <select
              value={filters.sortBy}
              onChange={(e) => { setFilters((p) => ({ ...p, sortBy: e.target.value })); }}
              className="h-9 rounded-lg border-none bg-[#f5f0e8] px-3 pr-8 text-sm text-[#1f1f1f] outline-none cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Clear All */}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="h-9 rounded-lg px-3 text-sm text-[#c9a87c] transition-colors hover:bg-[#c9a87c]/10"
            >
              Clear All
            </button>
          )}
        </div>

        {/* Active Filter Pills */}
        {activeFilterCount > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {filters.status && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(201,168,124,0.15)] px-3 py-1 text-xs text-[#c9a87c]">
                Status: {STATUS_OPTIONS.find(o => o.value === filters.status)?.label}
                <button onClick={() => { setFilters(p => ({ ...p, status: '' })); setPage(1); }}><X size={12} /></button>
              </span>
            )}
            {filters.priority && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(201,168,124,0.15)] px-3 py-1 text-xs text-[#c9a87c]">
                Priority: {PRIORITY_OPTIONS.find(o => o.value === filters.priority)?.label}
                <button onClick={() => { setFilters(p => ({ ...p, priority: '' })); setPage(1); }}><X size={12} /></button>
              </span>
            )}
            {filters.category && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(201,168,124,0.15)] px-3 py-1 text-xs text-[#c9a87c]">
                Category: {filters.category}
                <button onClick={() => { setFilters(p => ({ ...p, category: '' })); setPage(1); }}><X size={12} /></button>
              </span>
            )}
            {filters.assignedTo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(201,168,124,0.15)] px-3 py-1 text-xs text-[#c9a87c]">
                Assigned: {userMap[Number(filters.assignedTo)] || filters.assignedTo}
                <button onClick={() => { setFilters(p => ({ ...p, assignedTo: '' })); setPage(1); }}><X size={12} /></button>
              </span>
            )}
            {filters.search && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(201,168,124,0.15)] px-3 py-1 text-xs text-[#c9a87c]">
                Search: {filters.search}
                <button onClick={() => { setSearchInput(''); setFilters(p => ({ ...p, search: '' })); setPage(1); }}><X size={12} /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-[rgba(201,168,124,0.08)] border border-[rgba(201,168,124,0.2)] px-4 py-2.5 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <Check size={16} className="text-[#c9a87c]" />
            <span className="text-sm font-medium text-[#1f1f1f]">
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-[#595959] hover:text-[#1f1f1f]"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              onChange={async (e) => {
                if (e.target.value) {
                  await handleBulkStatusChange(e.target.value);
                  e.target.value = '';
                }
              }}
              className="h-8 rounded-md border border-[#e5e0d5] bg-white px-2 text-xs outline-none"
              defaultValue=""
            >
              <option value="" disabled>Change Status</option>
              {STATUS_OPTIONS.filter(o => o.value).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={handleBulkDelete}
              className="flex h-8 items-center gap-1 rounded-md border border-[#f5222d] bg-[#fff1f0] px-3 text-xs font-medium text-[#f5222d] hover:bg-[#ffccc7]"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && tickets.length === 0 && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 size={24} className="animate-spin text-[#c9a87c]" />
        </div>
      )}

      {/* Empty State */}
      {!loading && tickets.length === 0 && (
        <EmptyState
          illustration="./empty-tickets.svg"
          title="No tickets found"
          description={activeFilterCount > 0 ? "Try adjusting your filters to see more results." : "Get started by creating a new ticket."}
          action={
            <button
              onClick={() => { setEditingTicket(null); setFormOpen(true); }}
              className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95"
            >
              <Plus size={16} />
              Create Ticket
            </button>
          }
        />
      )}

      {/* Table View (Desktop) */}
      {!loading && tickets.length > 0 && viewMode === 'table' && (
        <div className="hidden overflow-hidden rounded-xl border border-[#e5e0d5] bg-white md:block">
          <table className="w-full">
            <thead>
              <tr className="bg-[#f5f0e8]">
                <th className="w-10 px-3 py-3">
                  <button
                    onClick={toggleSelectAll}
                    className="text-[#8a8a8a] hover:text-[#c9a87c]"
                  >
                    {selectedIds.size === tickets.length ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  ID
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  Title
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  Priority
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959] hidden lg:table-cell">
                  Category
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959]">
                  Assigned To
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.05em] text-[#595959] hidden lg:table-cell">
                  Created
                </th>
                <th className="w-10 px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket, idx) => {
                const isSelected = selectedIds.has(ticket.id);
                return (
                  <tr
                    key={ticket.id}
                    onClick={() => navigate(`/tickets/${ticket.id}`)}
                    className={cn(
                      'cursor-pointer border-b border-[#e5e0d5] transition-colors hover:bg-[#fbf9f4]',
                      isSelected && 'border-l-[3px] border-l-[#c9a87c] bg-[rgba(201,168,124,0.08)]'
                    )}
                    style={{ animationDelay: `${idx * 0.03}s` }}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleSelect(ticket.id)}
                        className={cn(
                          'transition-colors',
                          isSelected ? 'text-[#c9a87c]' : 'text-[#8a8a8a] hover:text-[#c9a87c]'
                        )}
                      >
                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs text-[#8a8a8a]">TK-{ticket.id}</span>
                    </td>
                    <td className="max-w-xs px-3 py-3">
                      <span className="truncate block text-sm text-[#1f1f1f]" title={ticket.title}>
                        {ticket.title}
                      </span>
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span className="text-sm text-[#595959]">{ticket.category}</span>
                    </td>
                    <td className="px-3 py-3">
                      {ticket.assigned_to ? (
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-[10px] font-bold text-[#c9a87c]">
                            {ticket.assignee_name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?'}
                          </div>
                          <span className="text-sm text-[#1f1f1f]">{ticket.assignee_name || userMap[ticket.assigned_to] || 'Unknown'}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-[#8a8a8a]">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span className="font-mono text-xs text-[#8a8a8a]">
                        {ticket.created_at ? formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true }) : ''}
                      </span>
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="rounded-md p-1 text-[#8a8a8a] transition-colors hover:bg-[#f5f0e8] hover:text-[#1f1f1f]">
                            <MoreHorizontal size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => navigate(`/tickets/${ticket.id}`)}>
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setEditingTicket(ticket); setFormOpen(true); }}>
                            <Pencil size={14} className="mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => { setDeletingId(ticket.id); setDeleteOpen(true); }}
                            className="text-[#f5222d] focus:text-[#f5222d]"
                          >
                            <Trash2 size={14} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Card View (Mobile + Card toggle) */}
      {!loading && tickets.length > 0 && (viewMode === 'card' || true) && (
        <div className={cn(
          'grid gap-3',
          viewMode === 'card' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'md:hidden grid-cols-1'
        )}>
          {tickets.map((ticket) => {
            const isSelected = selectedIds.has(ticket.id);
            return (
              <div
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className={cn(
                  'group cursor-pointer rounded-xl border border-[#e5e0d5] bg-white p-4 transition-all hover:shadow-card-hover hover:border-[rgba(201,168,124,0.3)]',
                  isSelected && 'border-l-[3px] border-l-[#c9a87c] bg-[rgba(201,168,124,0.08)]'
                )}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(ticket.id); }}
                      className={cn(
                        'transition-colors',
                        isSelected ? 'text-[#c9a87c]' : 'text-[#8a8a8a] hover:text-[#c9a87c]'
                      )}
                    >
                      {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <StatusBadge status={ticket.status} />
                  </div>
                  <PriorityBadge priority={ticket.priority} showLabel={false} />
                </div>
                <h3 className="mb-2 line-clamp-2 text-sm font-medium text-[#1f1f1f] group-hover:text-[#c9a87c] transition-colors">
                  {ticket.title}
                </h3>
                <div className="flex items-center justify-between text-xs text-[#8a8a8a]">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#c9a87c]" />
                      {ticket.category}
                    </span>
                    {ticket.assigned_to ? (
                      <span className="flex items-center gap-1">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-[8px] font-bold text-[#c9a87c]">
                          {ticket.assignee_name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?'}
                        </div>
                        <span className="truncate max-w-[80px]">{ticket.assignee_name || userMap[ticket.assigned_to]}</span>
                      </span>
                    ) : (
                      <span>Unassigned</span>
                    )}
                  </div>
                  <span className="font-mono">TK-{ticket.id}</span>
                </div>
                <div className="mt-2 font-mono text-[10px] text-[#8a8a8a]">
                  {ticket.created_at ? formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true }) : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && tickets.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-[#8a8a8a]">
            <span>
              Showing {startItem}-{endItem} of {totalCount}
            </span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="ml-2 h-8 rounded-md border border-[#e5e0d5] bg-white px-2 text-xs outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s} / page</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f5f0e8] text-[#595959] transition-colors hover:bg-[#ede7db] disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            {pageRange.map((p, i) => (
              typeof p === 'string' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-sm text-[#8a8a8a]">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition-colors',
                    p === page
                      ? 'bg-[#c9a87c] text-[#1f1f1f]'
                      : 'bg-[#f5f0e8] text-[#595959] hover:bg-[#ede7db]'
                  )}
                >
                  {p}
                </button>
              )
            ))}
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f5f0e8] text-[#595959] transition-colors hover:bg-[#ede7db] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      <TicketFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingTicket(null); }}
        onSubmit={editingTicket ? handleUpdate : handleCreate}
        ticket={editingTicket}
        users={users}
        categories={categories}
      />

      {/* Delete Modal */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false); setDeletingId(null); }}
        onConfirm={handleDelete}
        ticketId={deletingId}
      />
    </div>
  );
}
