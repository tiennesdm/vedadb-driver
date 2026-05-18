/**
 * Ticket Detail Page — Full ticket view with comments, activity log, and sidebar
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTicketDetail } from '@/hooks/useTickets';
import useAppStore from '@/lib/vedadb-store';
import StatusBadge from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import TicketFormModal from '@/components/tickets/TicketFormModal';
import DeleteConfirmDialog from '@/components/tickets/DeleteConfirmDialog';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Copy,
  Check,
  Pencil,
  Trash2,
  Send,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  CircleDot,
  Circle,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Loader2,
  UserCircle,
  Tag,
  Calendar,
  Clock,
  MessageSquare,
  Activity,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { User, Category } from '@/hooks/useTickets';
import { useIsAdmin, useIsManager, useCurrentRole } from '@/hooks/useRBAC';

const STATUS_CONFIG: Record<string, { bg: string; iconColor: string; icon: React.ReactNode; label: string }> = {
  open: { bg: 'bg-[#f6ffed]', iconColor: 'text-[#52c41a]', icon: <CircleDot size={18} />, label: 'Open' },
  in_progress: { bg: 'bg-[#e6f0ff]', iconColor: 'text-[#1890ff]', icon: <Circle size={18} />, label: 'In Progress' },
  resolved: { bg: 'bg-[#f6ffed]', iconColor: 'text-[#52c41a]', icon: <CheckCircle2 size={18} />, label: 'Resolved' },
  closed: { bg: 'bg-[#f5f5f5]', iconColor: 'text-[#8a8a8a]', icon: <XCircle size={18} />, label: 'Closed' },
  on_hold: { bg: 'bg-[#fff7e6]', iconColor: 'text-[#faad14]', icon: <PauseCircle size={18} />, label: 'On Hold' },
};

const ACTIVITY_COLORS: Record<string, string> = {
  created: '#52c41a',
  status_changed: '#1890ff',
  assigned: '#722ed1',
  commented: '#c9a87c',
  deleted: '#f5222d',
  'Ticket created': '#52c41a',
  'Ticket updated': '#1890ff',
  'Added a comment': '#c9a87c',
  'Reassigned': '#722ed1',
  'Status changed': '#1890ff',
  'Bulk status changed': '#1890ff',
  'default': '#8a8a8a',
};

function getActivityColor(action: string): string {
  for (const [key, color] of Object.entries(ACTIVITY_COLORS)) {
    if (action.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#8a8a8a';
}

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ticketId = Number(id);
  const currentUser = useAppStore((s) => s.currentUser);
  const isAdmin = useIsAdmin();
  const isManager = useIsManager();
  const currentRole = useCurrentRole();
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [copied, setCopied] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  // Modals
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    ticket,
    comments,
    activities,
    users: detailUsers,
    loading,
    refresh,
    deleteTicket,
    addComment,
    changeStatus,
    reassign,
  } = useTicketDetail(ticketId || null);

  // RBAC derived state
  const canDelete = isAdmin;
  const canEdit = isAdmin || isManager || (currentRole === 'agent' && ticket?.assigned_to === currentUser?.id);
  const canReassign = isAdmin || isManager;
  const canChangeStatus = isAdmin || isManager || (currentRole === 'agent' && ticket?.assigned_to === currentUser?.id) || ticket?.created_by === currentUser?.id;

  const query = useAppStore((s) => s.query);

  // Fetch users and categories for edit modal
  useEffect(() => {
    const fetch = async () => {
      try {
        const uResult = await query(`SELECT * FROM users ORDER BY name ASC`);
        setUsers(uResult.toObjects() as unknown as User[]);
        const cResult = await query(`SELECT * FROM categories ORDER BY name ASC`);
        setCategories(cResult.toObjects() as unknown as Category[]);
      } catch { /* ignore */ }
    };
    fetch();
  }, [query]);

  const handleCopyId = () => {
    navigator.clipboard.writeText(`TK-${ticketId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    setCommentSubmitting(true);
    try {
      await addComment(commentText.trim());
      setCommentText('');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    await changeStatus(newStatus);
    setStatusNotification(`Status changed to ${newStatus.replace('_', ' ')}`);
    setTimeout(() => setStatusNotification(null), 5000);
  };

  const handleReassign = async (userId: string) => {
    const uid = userId === 'unassigned' ? null : Number(userId);
    const userName = uid ? users.find((u) => u.id === uid)?.name || 'Unknown' : 'Unassigned';
    await reassign(uid, userName);
  };

  const handleDelete = async () => {
    await deleteTicket(ticketId);
    navigate('/tickets');
  };

  const handleUpdate = async (data: {
    title: string;
    description: string;
    priority: string;
    category: string;
    assigned_to: number | null;
    status?: string;
  }) => {
    const update = useAppStore.getState().update;
    const insert = useAppStore.getState().insert;
    await update('tickets', {
      title: data.title,
      description: data.description,
      priority: data.priority,
      category: data.category,
      assigned_to: data.assigned_to,
      ...(data.status ? { status: data.status } : {}),
      updated_at: new Date().toISOString(),
    }, { id: ticketId });

    if (currentUser) {
      await insert('activities', {
        ticket_id: ticketId,
        user_id: currentUser.id,
        action: 'Ticket updated',
        created_at: new Date().toISOString(),
      });
    }
    setEditOpen(false);
    refresh();
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 size={28} className="animate-spin text-[#c9a87c]" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-medium text-[#1f1f1f]">Ticket not found</h2>
        <p className="mt-1 text-sm text-[#595959]">The ticket you are looking for does not exist.</p>
        <button
          onClick={() => navigate('/tickets')}
          className="mt-4 flex items-center gap-2 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-colors hover:brightness-95"
        >
          <ArrowLeft size={16} /> Back to Tickets
        </button>
      </div>
    );
  }

  const creatorName = (ticket as unknown as Record<string, string>).creator_name || 'Unknown';
  const allUsers = users.length > 0 ? users : detailUsers;

  return (
    <div className="animate-in fade-in duration-300">
      {/* Top Bar */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-6 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/tickets')}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[#595959] transition-colors hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Back to Tickets</span>
            </button>
            <div className="h-5 w-px bg-[#e5e0d5]" />
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-lg font-medium text-[#1f1f1f]">TK-{ticket.id}</h1>
              <button
                onClick={handleCopyId}
                className="rounded-md p-1 text-[#8a8a8a] transition-colors hover:bg-[#f5f0e8] hover:text-[#c9a87c]"
                title="Copy ID"
              >
                {copied ? <Check size={14} className="text-[#52c41a]" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                onClick={() => setEditOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[#e5e0d5] bg-[#f5f0e8] px-3 py-2 text-sm text-[#1f1f1f] transition-colors hover:bg-[#ede7db]"
              >
                <Pencil size={14} />
                <span className="hidden sm:inline">Edit</span>
              </button>
            )}
            {(canEdit || canChangeStatus || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded-lg p-2 text-[#595959] transition-colors hover:bg-[#f5f0e8]">
                    <MoreHorizontal size={18} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {canEdit && (
                    <DropdownMenuItem onClick={() => setEditOpen(true)}>
                      <Pencil size={14} className="mr-2" /> Edit Ticket
                    </DropdownMenuItem>
                  )}
                  {canChangeStatus && (
                    <DropdownMenuItem onClick={() => handleStatusChange(ticket.status === 'open' ? 'closed' : 'open')}>
                      <CheckCircle2 size={14} className="mr-2" />
                      {ticket.status === 'open' ? 'Close Ticket' : 'Reopen Ticket'}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      className="text-[#f5222d] focus:text-[#f5222d]"
                    >
                      <Trash2 size={14} className="mr-2" /> Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {/* Status Change Notification */}
      {statusNotification && (
        <div className="mb-4 animate-in slide-in-from-top-2 rounded-lg bg-[#f6ffed] px-4 py-3 text-sm text-[#1f1f1f]">
          {statusNotification}
        </div>
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Ticket Info Card */}
          <div className="rounded-xl border border-[#e5e0d5] bg-white p-5 sm:p-6">
            {/* Header Row */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <StatusBadge status={ticket.status} className="text-sm px-3 py-1" />
              <PriorityBadge priority={ticket.priority} className="text-sm" />
            </div>

            {/* Title */}
            <h2 className="text-xl sm:text-2xl font-medium text-[#1f1f1f] mb-4">
              {ticket.title}
            </h2>

            {/* Description */}
            <div>
              <h3 className="text-[10px] uppercase tracking-[0.1em] text-[#595959] mb-2">
                Description
              </h3>
              {ticket.description ? (
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#1f1f1f]">
                  {ticket.description}
                </div>
              ) : (
                <p className="text-sm italic text-[#8a8a8a]">No description provided.</p>
              )}
            </div>
          </div>

          {/* Comments Section */}
          <div className="rounded-xl border border-[#e5e0d5] bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare size={18} className="text-[#c9a87c]" />
              <h3 className="text-base font-medium text-[#1f1f1f]">
                Comments ({comments.length})
              </h3>
            </div>

            {/* Comment List */}
            {comments.length === 0 ? (
              <div className="py-8 text-center text-sm text-[#8a8a8a]">
                No comments yet. Be the first to add one.
              </div>
            ) : (
              <div className="space-y-4 mb-6">
                {comments.map((comment, idx) => (
                  <div
                    key={comment.id}
                    className="flex gap-3 animate-in fade-in slide-in-from-bottom-4"
                    style={{ animationDelay: `${idx * 0.05}s`, animationFillMode: 'backwards' }}
                  >
                    {/* Avatar */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-xs font-bold text-[#c9a87c]">
                      {comment.author_name
                        ? comment.author_name.split(' ').map((n) => n[0]).join('').toUpperCase()
                        : '?'}
                    </div>
                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#1f1f1f]">
                          {comment.author_name || 'Unknown'}
                        </span>
                        <span className="font-mono text-xs text-[#8a8a8a]">
                          {comment.created_at
                            ? formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })
                            : ''}
                        </span>
                      </div>
                      <div className="rounded-xl bg-[#fbf9f4] px-4 py-3 text-sm text-[#1f1f1f]">
                        {comment.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Comment */}
            <div className="border-t border-[#e5e0d5] pt-4">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-xs font-bold text-[#c9a87c]">
                  {currentUser?.name?.split(' ').map((n) => n[0]).join('').toUpperCase() || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a comment..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-[#e5e0d5] bg-[#fbf9f4] px-4 py-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c] focus:ring-2 focus:ring-[rgba(201,168,124,0.15)]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        handleAddComment();
                      }
                    }}
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={handleAddComment}
                      disabled={!commentText.trim() || commentSubmitting}
                      className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95 disabled:opacity-50"
                    >
                      {commentSubmitting ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Send size={14} />
                      )}
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Activity Log */}
          <div className="rounded-xl border border-[#e5e0d5] bg-white p-5 sm:p-6">
            <button
              onClick={() => setActivityCollapsed(!activityCollapsed)}
              className="flex w-full items-center justify-between mb-4"
            >
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-[#c9a87c]" />
                <h3 className="text-base font-medium text-[#1f1f1f]">Activity Log</h3>
              </div>
              {activityCollapsed ? (
                <ChevronDown size={18} className="text-[#8a8a8a]" />
              ) : (
                <ChevronUp size={18} className="text-[#8a8a8a]" />
              )}
            </button>
            {!activityCollapsed && (
              <div className="relative space-y-4">
                {/* Vertical line */}
                <div className="absolute left-[15px] top-0 bottom-0 w-0.5 bg-[#e5e0d5]" />
                {activities.map((activity, idx) => (
                  <div
                    key={activity.id}
                    className="relative flex gap-3 animate-in fade-in slide-in-from-left-4"
                    style={{ animationDelay: `${idx * 0.06}s`, animationFillMode: 'backwards' }}
                  >
                    {/* Timeline dot */}
                    <div
                      className="relative z-10 mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: getActivityColor(activity.action) }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#1f1f1f]">
                        <span className="font-medium">{activity.user_name || 'System'}</span>{' '}
                        <span className="text-[#595959]">{activity.action}</span>
                      </p>
                      <span className="font-mono text-xs text-[#8a8a8a]">
                        {activity.created_at
                          ? formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })
                          : ''}
                      </span>
                    </div>
                  </div>
                ))}
                {activities.length === 0 && (
                  <p className="relative z-10 text-sm text-[#8a8a8a]">No activity recorded.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1/3) - Sticky Sidebar */}
        <div className="lg:col-span-1">
          <div className="space-y-4 lg:sticky lg:top-[72px]">
            {/* Details Card */}
            <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
              <h3 className="mb-4 text-sm font-medium text-[#1f1f1f]">Ticket Details</h3>

              <div className="space-y-4">
                {/* Requester */}
                <div>
                  <label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    <UserCircle size={12} /> Requester
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-[10px] font-bold text-[#c9a87c]">
                      {creatorName.split(' ').map((n) => n[0]).join('').toUpperCase()}
                    </div>
                    <span className="text-sm text-[#1f1f1f]">{creatorName}</span>
                  </div>
                </div>

                {/* Assigned To */}
                <div>
                  <label className="text-[10px] uppercase tracking-[0.1em] text-[#595959]">Assigned To</label>
                  <div className="mt-1">
                    {canReassign ? (
                      <select
                        value={ticket.assigned_to || 'unassigned'}
                        onChange={(e) => handleReassign(e.target.value)}
                        className="h-9 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
                      >
                        <option value="unassigned">Unassigned</option>
                        {allUsers.map((u) => (
                          <option key={u.id} value={String(u.id)}>{u.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="block text-sm text-[#1f1f1f]">
                        {ticket.assignee_name || 'Unassigned'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    <Tag size={12} /> Category
                  </label>
                  <span className="mt-1 block text-sm text-[#1f1f1f]">{ticket.category}</span>
                </div>

                {/* Created */}
                <div>
                  <label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    <Calendar size={12} /> Created
                  </label>
                  <span className="mt-1 block font-mono text-xs text-[#1f1f1f]">
                    {ticket.created_at
                      ? new Date(ticket.created_at).toLocaleString()
                      : 'N/A'}
                  </span>
                  {ticket.created_at && (
                    <span className="text-xs text-[#8a8a8a]">
                      {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                    </span>
                  )}
                </div>

                {/* Last Updated */}
                <div>
                  <label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    <Clock size={12} /> Last Updated
                  </label>
                  <span className="mt-1 block font-mono text-xs text-[#1f1f1f]">
                    {ticket.updated_at
                      ? new Date(ticket.updated_at).toLocaleString()
                      : 'N/A'}
                  </span>
                </div>

                {/* Priority */}
                <div>
                  <label className="text-[10px] uppercase tracking-[0.1em] text-[#595959]">Priority</label>
                  <div className="mt-1">
                    <PriorityBadge priority={ticket.priority} />
                  </div>
                </div>
              </div>

              {/* Quick Status Change */}
              {canChangeStatus && (
                <div className="mt-6 pt-4 border-t border-[#e5e0d5]">
                  <label className="mb-2 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    Change Status
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(STATUS_CONFIG).map(([key, config]) => {
                      const isActive = ticket.status === key;
                      return (
                        <button
                          key={key}
                          onClick={() => handleStatusChange(key)}
                          title={config.label}
                          className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-lg transition-all hover:scale-110',
                            config.bg,
                            config.iconColor,
                            isActive && 'ring-2 ring-offset-1 ring-[#c9a87c]',
                          )}
                        >
                          {config.icon}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <TicketFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={handleUpdate}
        ticket={ticket}
        users={allUsers}
        categories={categories}
      />

      {/* Delete Modal */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        ticketId={ticketId}
      />
    </div>
  );
}
