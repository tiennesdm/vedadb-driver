/**
 * Ticket Detail Page — Full ticket view with comments, activity log, sidebar, and reject functionality
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTicketDetail } from '@/hooks/useTickets';
import useAppStore from '@/lib/vedadb-store';
import StatusBadge from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import TicketFormModal from '@/components/tickets/TicketFormModal';
import DeleteConfirmDialog from '@/components/tickets/DeleteConfirmDialog';
import WatcherBadge from '@/components/advanced/WatcherBadge';
import CustomFieldPanel from '@/components/advanced/CustomFieldPanel';
import CollisionDetector from '@/components/advanced/CollisionDetector';
import TicketMergeModal from '@/components/advanced/TicketMergeModal';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import MentionInput from '@/components/advanced/MentionInput';
import InternalNoteToggle from '@/components/advanced/InternalNoteToggle';
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
  Ban,
  AlertTriangle,
  GitMerge,
  Link2,
  Eye,
  Plus,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { User, Category } from '@/hooks/useTickets';
import { useIsAdmin, useIsManager, useCurrentRole } from '@/hooks/useRBAC';

const STATUS_CONFIG: Record<string, { bg: string; iconColor: string; icon: React.ReactNode; label: string }> = {
  open: { bg: 'bg-[#f6ffed]', iconColor: 'text-[#52c41a]', icon: <CircleDot size={18} />, label: 'Open' },
  in_progress: { bg: 'bg-[#e6f0ff]', iconColor: 'text-[#1890ff]', icon: <Circle size={18} />, label: 'In Progress' },
  resolved: { bg: 'bg-[#f6ffed]', iconColor: 'text-[#52c41a]', icon: <CheckCircle2 size={18} />, label: 'Resolved' },
  closed: { bg: 'bg-[#f5f5f5]', iconColor: 'text-[#8a8a8a]', icon: <XCircle size={18} />, label: 'Closed' },
  on_hold: { bg: 'bg-[#fff7e6]', iconColor: 'text-[#faad14]', icon: <PauseCircle size={18} />, label: 'On Hold' },
  rejected: { bg: 'bg-[#fff2e8]', iconColor: 'text-[#fa8c16]', icon: <Ban size={18} />, label: 'Rejected' },
};

const ACTIVITY_COLORS: Record<string, string> = {
  created: '#52c41a',
  status_changed: '#1890ff',
  assigned: '#722ed1',
  commented: '#c9a87c',
  deleted: '#f5222d',
  rejected: '#fa8c16',
  'Ticket created': '#52c41a',
  'Ticket updated': '#1890ff',
  'Added a comment': '#c9a87c',
  'Reassigned': '#722ed1',
  'Status changed': '#1890ff',
  'Bulk status changed': '#1890ff',
  'Ticket rejected': '#fa8c16',
  'default': '#8a8a8a',
};

function getActivityColor(action: string): string {
  for (const [key, color] of Object.entries(ACTIVITY_COLORS)) {
    if (action.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#8a8a8a';
}

/* ------------------------------------------------------------------ */
/*  Reject Ticket Modal                                                */
/* ------------------------------------------------------------------ */

function RejectTicketModal({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string, targetDeptId: number) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  const [targetDept, setTargetDept] = useState('1');
  const departments = useAppStore((s) => s.departments);

  return (
    <Dialog open={open} onOpenChange={() => !loading && onClose()}>
      <DialogContent className="max-w-[440px] border-[#e5e0d5] bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg text-[#1f1f1f]">
            <Ban size={20} className="text-[#fa8c16]" />
            Reject Ticket
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#595959]">
          Rejecting this ticket will transfer it to another department. Please provide a reason.
        </p>

        <div className="space-y-4 py-2">
          {/* Reason */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-[#595959]">
              Rejection Reason
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this ticket is being rejected / transferred..."
              rows={3}
              className="w-full resize-none rounded-xl border border-[#e5e0d5] bg-[#fbf9f4] px-4 py-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c] focus:ring-2 focus:ring-[rgba(201,168,124,0.15)]"
            />
          </div>

          {/* Target Department */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-[#595959]">
              Transfer to Department
            </label>
            <select
              value={targetDept}
              onChange={(e) => setTargetDept(e.target.value)}
              className="h-10 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
            >
              {departments.map((d) => (
                <option key={d.id} value={String(d.id)}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-[#e5e0d5] bg-white px-4 py-2.5 text-sm font-medium text-[#595959] transition-all hover:bg-[#f5f0e8] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason, Number(targetDept))}
            disabled={!reason.trim() || loading}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all',
              reason.trim()
                ? 'bg-[#fa8c16] text-white hover:brightness-95'
                : 'cursor-not-allowed bg-[#e5e0d5] text-[#8a8a8a]',
            )}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
            Reject & Transfer
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ticketId = Number(id);
  const currentUser = useAppStore((s) => s.currentUser);
  const rejectTicket = useAppStore((s) => s.rejectTicket);
  const isAdmin = useIsAdmin();
  const isManager = useIsManager();
  const currentRole = useCurrentRole();
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [copied, setCopied] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  // Modals
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  // Advanced: watchers
  const [watchers, setWatchers] = useState<Array<{ id: number; name: string; email: string; avatar?: string; role?: string }>>([]);
  const [allUsersList, setAllUsersList] = useState<Array<{ id: number; name: string; email: string; avatar?: string; role: string }>>([]);
  const [showAddWatcher, setShowAddWatcher] = useState(false);
  const [watcherSearch, setWatcherSearch] = useState('');
  const [filteredWatcherUsers, setFilteredWatcherUsers] = useState<Array<{ id: number; name: string; email: string }>>([]);

  // Advanced: linked tickets
  const [linkedTickets, setLinkedTickets] = useState<Array<{ id: number; source_id: number; target_id: number; link_type: string; source_title?: string; target_title?: string }>>([]);

  // Advanced: custom fields
  const [customFields, setCustomFields] = useState<Array<{ id: string; name: string; label: string; field_type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date'; options?: string[]; required?: boolean; value?: string | number | boolean; placeholder?: string }>>([]);

  // Advanced: collision
  const [activeViewers, setActiveViewers] = useState<Array<{ userId: number; name: string; avatar?: string; since: string }>>([]);

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
  const canReject = isAdmin || isManager || (currentRole === 'agent' && ticket?.assigned_to === currentUser?.id);

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

  // Fetch advanced data: watchers, links, custom fields
  const fetchWatchers = useCallback(async () => {
    if (!ticketId) return;
    try {
      const res = await vedaQuery(
        `SELECT tw.id, tw.user_id, u.name, u.email, u.avatar, u.role FROM ticket_watchers tw LEFT JOIN users u ON u.id = tw.user_id WHERE tw.ticket_id = ${ticketId}`
      );
      const rows = toObjects(res);
      setWatchers(rows.map((r: Record<string, unknown>) => ({
        id: r.user_id as number,
        name: (r.name as string) ?? 'Unknown',
        email: (r.email as string) ?? '',
        avatar: r.avatar as string | undefined,
        role: r.role as string | undefined,
      })));
    } catch { setWatchers([]); }
  }, [ticketId]);

  const fetchLinkedTickets = useCallback(async () => {
    if (!ticketId) return;
    try {
      const res = await vedaQuery(
        `SELECT tl.*, s.title as source_title, t.title as target_title FROM ticket_links tl LEFT JOIN tickets s ON s.id = tl.source_id LEFT JOIN tickets t ON t.id = tl.target_id WHERE tl.source_id = ${ticketId} OR tl.target_id = ${ticketId} ORDER BY tl.created_at DESC`
      );
      setLinkedTickets(toObjects(res) as unknown as typeof linkedTickets);
    } catch { setLinkedTickets([]); }
  }, [ticketId]);

  const fetchCustomFields = useCallback(async () => {
    if (!ticketId) return;
    try {
      // Check if ticket has a template with custom fields
      const res = await vedaQuery(
        `SELECT custom_fields_json FROM tickets WHERE id = ${ticketId}`
      );
      if (res.rows.length > 0 && res.rows[0][0]) {
        const parsed = JSON.parse(res.rows[0][0] as string);
        if (Array.isArray(parsed)) {
          setCustomFields(parsed.map((f: Record<string, unknown>, idx: number) => ({
            id: (f.id as string) ?? `cf_${idx}`,
            name: (f.name as string) ?? '',
            label: (f.label as string) ?? f.name ?? '',
            field_type: (f.field_type as 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date') ?? 'text',
            options: f.options as string[] | undefined,
            required: f.required as boolean | undefined,
            value: f.value as string | number | boolean | undefined,
            placeholder: f.placeholder as string | undefined,
          })));
          return;
        }
      }
      setCustomFields([]);
    } catch { setCustomFields([]); }
  }, [ticketId]);

  const fetchActiveViewers = useCallback(async () => {
    if (!ticketId) return;
    try {
      const res = await vedaQuery(
        `SELECT user_id, MAX(created_at) as since FROM activities WHERE ticket_id = ${ticketId} AND created_at > datetime('now', '-5 minutes') GROUP BY user_id`
      );
      const rows = toObjects(res);
      // Resolve names
      const userIds = rows.map((r: Record<string, unknown>) => r.user_id).filter(Boolean);
      if (userIds.length > 0) {
        const uRes = await vedaQuery(`SELECT id, name, avatar FROM users WHERE id IN (${userIds.join(',')})`);
        const uMap = new Map(toObjects(uRes).map((u: Record<string, unknown>) => [u.id, u]));
        setActiveViewers(rows.map((r: Record<string, unknown>) => ({
          userId: r.user_id as number,
          name: (uMap.get(r.user_id as number)?.name as string) ?? `User ${r.user_id}`,
          avatar: uMap.get(r.user_id as number)?.avatar as string | undefined,
          since: (r.since as string) ?? new Date().toISOString(),
        })));
      } else {
        setActiveViewers([]);
      }
    } catch { setActiveViewers([]); }
  }, [ticketId]);

  const fetchAllUsers = useCallback(async () => {
    try {
      const res = await vedaQuery(`SELECT id, name, email, avatar, role FROM users WHERE is_active = 1 ORDER BY name`);
      setAllUsersList(toObjects(res) as unknown as typeof allUsersList);
    } catch { setAllUsersList([]); }
  }, []);

  useEffect(() => {
    if (ticketId) {
      fetchWatchers();
      fetchLinkedTickets();
      fetchCustomFields();
      fetchActiveViewers();
      fetchAllUsers();
    }
  }, [ticketId, fetchWatchers, fetchLinkedTickets, fetchCustomFields, fetchActiveViewers, fetchAllUsers]);

  const handleAddWatcher = async (userId: number) => {
    if (!ticketId) return;
    try {
      await vedaExec(`INSERT INTO ticket_watchers (ticket_id, user_id, notify_on_update, created_at) VALUES (${ticketId}, ${userId}, 1, datetime('now'))`);
      fetchWatchers();
      setShowAddWatcher(false);
      setWatcherSearch('');
      setFilteredWatcherUsers([]);
    } catch { /* ignore */ }
  };

  const handleRemoveWatcher = async (watcherUserId: number) => {
    if (!ticketId) return;
    try {
      await vedaExec(`DELETE FROM ticket_watchers WHERE ticket_id = ${ticketId} AND user_id = ${watcherUserId}`);
      fetchWatchers();
    } catch { /* ignore */ }
  };

  const handleSearchWatcher = (term: string) => {
    setWatcherSearch(term);
    if (!term.trim()) { setFilteredWatcherUsers([]); return; }
    const idNum = parseInt(term, 10);
    const filtered = allUsersList.filter(
      (u) =>
        !watchers.some((w) => w.id === u.id) &&
        (u.name.toLowerCase().includes(term.toLowerCase()) ||
         u.email.toLowerCase().includes(term.toLowerCase()) ||
         (!isNaN(idNum) && u.id === idNum))
    );
    setFilteredWatcherUsers(filtered.slice(0, 6));
  };

  const handleUnlinkTicket = async (linkId: number) => {
    try {
      await vedaExec(`DELETE FROM ticket_links WHERE id = ${linkId}`);
      fetchLinkedTickets();
    } catch { /* ignore */ }
  };

  const handleMerge = async (targetId: number, _strategy: string) => {
    if (!ticketId) return;
    try {
      // Create a comment on the target referencing this ticket
      await vedaExec(`INSERT INTO comments (ticket_id, user_id, content, created_at) VALUES (${targetId}, ${currentUser?.id ?? 'NULL'}, 'Merged from ticket #${ticketId}: ${ticket?.title ?? ''}', datetime('now'))`);
      // Close the source ticket
      await vedaExec(`UPDATE tickets SET status = 'closed', updated_at = datetime('now') WHERE id = ${ticketId}`);
      // Create activity
      await vedaExec(`INSERT INTO activities (ticket_id, user_id, action, created_at) VALUES (${targetId}, ${currentUser?.id ?? 'NULL'}, 'Merged ticket #${ticketId}', datetime('now'))`);
      refresh();
      setMergeOpen(false);
    } catch { /* ignore */ }
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(`TK-${ticketId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    setCommentSubmitting(true);
    try {
      // Prefix internal notes with [INTERNAL] marker
      const content = isInternalNote
        ? `[INTERNAL] ${commentText.trim()}`
        : commentText.trim();
      await addComment(content);
      setCommentText('');
      setIsInternalNote(false);
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

  const handleReject = async (reason: string, targetDeptId: number) => {
    setRejectLoading(true);
    try {
      await rejectTicket(ticketId, reason, targetDeptId);
      setRejectOpen(false);
      setStatusNotification(`Ticket rejected and transferred`);
      setTimeout(() => setStatusNotification(null), 5000);
      refresh();
    } catch {
      // error handled by store
    } finally {
      setRejectLoading(false);
    }
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
  const isRejected = ticket.status === 'rejected';

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
            {/* Merge Ticket Button */}
            {(isAdmin || isManager) && !isRejected && (
              <button
                onClick={() => setMergeOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[#e5e0d5] bg-[#f5f0e8] px-3 py-2 text-sm text-[#1f1f1f] transition-colors hover:bg-[#ede7db]"
              >
                <GitMerge size={14} />
                <span className="hidden sm:inline">Merge</span>
              </button>
            )}
            {/* Reject Ticket Button */}
            {canReject && !isRejected && (
              <button
                onClick={() => setRejectOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[#fa8c16] bg-[#fff2e8] px-3 py-2 text-sm text-[#fa8c16] transition-colors hover:bg-[#fa8c16] hover:text-white"
              >
                <Ban size={14} />
                <span className="hidden sm:inline">Reject</span>
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => setEditOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[#e5e0d5] bg-[#f5f0e8] px-3 py-2 text-sm text-[#1f1f1f] transition-colors hover:bg-[#ede7db]"
              >
                <Pencil size={14} />
                <span className="hidden sm:inline">Edit</span>
              </button>
            )}
            {(canEdit || canChangeStatus || canDelete || canReject) && (
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
                  {canReject && !isRejected && (
                    <DropdownMenuItem onClick={() => setRejectOpen(true)} className="text-[#fa8c16] focus:text-[#fa8c16]">
                      <Ban size={14} className="mr-2" /> Reject Ticket
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

      {/* Collision Detection Banner */}
      <CollisionDetector
        ticketId={ticketId}
        currentUserId={currentUser?.id ?? 0}
        viewers={activeViewers}
        onRefreshViewers={fetchActiveViewers}
        className="mb-4"
      />

      {/* Rejection Banner */}
      {isRejected && (ticket as unknown as Record<string, string>).rejection_reason && (
        <div className="mb-4 rounded-lg border border-[#fa8c16] bg-[#fff2e8] px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#fa8c16]" />
            <span className="text-sm font-medium text-[#fa8c16]">This ticket has been rejected</span>
          </div>
          <p className="mt-1 text-sm text-[#595959]">
            Reason: {(ticket as unknown as Record<string, string>).rejection_reason}
          </p>
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
              {ticket.ticket_type && (
                <span className="rounded-md bg-[#f5f0e8] px-2 py-0.5 text-xs font-medium text-[#595959] capitalize">
                  {ticket.ticket_type.replace('_', ' ')}
                </span>
              )}
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

            {/* Rejection Reason - inline */}
            {isRejected && (ticket as unknown as Record<string, string>).rejection_reason && (
              <div className="mt-4 rounded-lg bg-[#fff2e8] border border-[#fa8c16] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Ban size={14} className="text-[#fa8c16]" />
                  <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#fa8c16]">
                    Rejection Reason
                  </span>
                </div>
                <p className="text-sm text-[#1f1f1f]">
                  {(ticket as unknown as Record<string, string>).rejection_reason}
                </p>
              </div>
            )}
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
                {comments.map((comment, idx) => {
                  const isInternal = comment.content?.startsWith('[INTERNAL]');
                  const displayContent = isInternal
                    ? comment.content.replace(/^\[INTERNAL\]\s?/, '')
                    : comment.content;
                  return (
                    <div
                      key={comment.id}
                      className="flex gap-3 animate-in fade-in slide-in-from-bottom-4"
                      style={{ animationDelay: `${idx * 0.05}s`, animationFillMode: 'backwards' }}
                    >
                      {/* Avatar */}
                      <div className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        isInternal
                          ? "bg-[#fff7e6] text-[#d48806]"
                          : "bg-[rgba(201,168,124,0.2)] text-[#c9a87c]"
                      )}>
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
                          {isInternal && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-[#fff7e6] px-2 py-0.5 text-[10px] font-medium text-[#d48806]">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                              Internal
                            </span>
                          )}
                          <span className="font-mono text-xs text-[#8a8a8a]">
                            {comment.created_at
                              ? formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })
                              : ''}
                          </span>
                        </div>
                        <div className={cn(
                          "rounded-xl px-4 py-3 text-sm text-[#1f1f1f]",
                          isInternal
                            ? "bg-[#fffbe6] border border-[#ffd666]"
                            : "bg-[#fbf9f4]"
                        )}>
                          {displayContent}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add Comment */}
            <div className="border-t border-[#e5e0d5] pt-4">
              {/* Toggle: Internal vs Public */}
              <div className="mb-3 flex items-center justify-between">
                <InternalNoteToggle
                  isInternal={isInternalNote}
                  onChange={setIsInternalNote}
                />
                {isInternalNote && (
                  <span className="text-xs text-[#d48806]">
                    Only agents and managers can see this
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  isInternalNote
                    ? "bg-[#fff7e6] text-[#d48806]"
                    : "bg-[rgba(201,168,124,0.2)] text-[#c9a87c]"
                )}>
                  {currentUser?.name?.split(' ').map((n) => n[0]).join('').toUpperCase() || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <MentionInput
                    value={commentText}
                    onChange={setCommentText}
                    placeholder={isInternalNote ? "Add an internal note... Use @ to mention" : "Add a comment... Use @ to mention a team member"}
                    rows={3}
                    onSubmit={handleAddComment}
                    disabled={commentSubmitting}
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-[#8a8a8a]">
                      Press Ctrl+Enter to send
                    </span>
                    <button
                      onClick={handleAddComment}
                      disabled={!commentText.trim() || commentSubmitting}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                        isInternalNote
                          ? 'bg-[#fff7e6] text-[#d48806] border border-[#ffd666] hover:brightness-95'
                          : 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95',
                        (!commentText.trim() || commentSubmitting) && 'opacity-50'
                      )}
                    >
                      {commentSubmitting ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Send size={14} />
                      )}
                      {isInternalNote ? 'Add Note' : 'Send'}
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
                    {canReassign && !isRejected ? (
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
              {canChangeStatus && !isRejected && (
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

              {/* Reject Button in sidebar */}
              {canReject && !isRejected && (
                <div className="mt-4 pt-4 border-t border-[#e5e0d5]">
                  <button
                    onClick={() => setRejectOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#fa8c16] bg-[#fff2e8] px-3 py-2 text-sm font-medium text-[#fa8c16] transition-all hover:bg-[#fa8c16] hover:text-white"
                  >
                    <Ban size={14} />
                    Reject & Transfer
                  </button>
                </div>
              )}

              {/* Watchers Section */}
              <div className="mt-4 pt-4 border-t border-[#e5e0d5]">
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[#595959]">
                    <Eye size={12} /> Watchers ({watchers.length})
                  </label>
                  {(canEdit || isAdmin) && (
                    <button
                      onClick={() => setShowAddWatcher((p) => !p)}
                      className="text-[#c9a87c] hover:text-[#b8996a] transition-colors"
                    >
                      {showAddWatcher ? <X size={12} /> : <Plus size={12} />}
                    </button>
                  )}
                </div>
                {showAddWatcher && (
                  <div className="mb-2 relative">
                    <input
                      type="text"
                      value={watcherSearch}
                      onChange={(e) => handleSearchWatcher(e.target.value)}
                      placeholder="Search user to add..."
                      className="w-full h-8 px-2 text-xs border border-[#e5e0d5] rounded-md bg-[#fbf9f4] focus:border-[#c9a87c] outline-none"
                    />
                    {filteredWatcherUsers.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-[#e5e0d5] bg-white shadow-lg max-h-32 overflow-y-auto">
                        {filteredWatcherUsers.map((u) => (
                          <button
                            key={u.id}
                            className="w-full px-2 py-1.5 text-left text-xs hover:bg-[#f5f3ef] flex items-center gap-2"
                            onClick={() => handleAddWatcher(u.id)}
                          >
                            <div className="h-4 w-4 rounded-full bg-[#c9a87c] flex items-center justify-center text-white text-[7px] font-medium">
                              {u.name?.[0]?.toUpperCase()}
                            </div>
                            <span className="text-[#262626]">{u.name}</span>
                            <span className="text-[#8a8a8a]">{u.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <WatcherBadge
                  watchers={watchers}
                  maxDisplay={5}
                  editable={canEdit || isAdmin}
                  onRemove={handleRemoveWatcher}
                />
              </div>

              {/* Linked Tickets Section */}
              {linkedTickets.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#e5e0d5]">
                  <label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[#595959] mb-2">
                    <Link2 size={12} /> Linked Tickets ({linkedTickets.length})
                  </label>
                  <div className="space-y-1.5">
                    {linkedTickets.map((link) => {
                      const isSource = link.source_id === ticketId;
                      const otherId = isSource ? link.target_id : link.source_id;
                      const otherTitle = isSource ? link.target_title : link.source_title;
                      return (
                        <div
                          key={link.id}
                          className="flex items-center justify-between p-1.5 rounded-md bg-[#fbf9f4] text-xs group"
                        >
                          <button
                            onClick={() => navigate(`/tickets/${otherId}`)}
                            className="flex items-center gap-1.5 flex-1 text-left hover:underline"
                          >
                            <span className="text-[10px] font-mono text-[#c9a87c]">#{otherId}</span>
                            <span className="text-[#262626] truncate">{otherTitle}</span>
                            <span className="text-[9px] px-1 py-0.5 rounded-full bg-white text-[#8a8a8a] capitalize">
                              {link.link_type.replace('_', ' ')}
                            </span>
                          </button>
                          {(canEdit || isAdmin) && (
                            <button
                              onClick={() => handleUnlinkTicket(link.id)}
                              className="opacity-0 group-hover:opacity-100 text-[#8a8a8a] hover:text-red-500 transition-all"
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom Fields Panel */}
              <CustomFieldPanel
                fields={customFields}
                onChange={(fields) => setCustomFields(fields)}
                editable={canEdit}
                className="mt-4"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Merge Modal */}
      {ticket && (
        <TicketMergeModal
          open={mergeOpen}
          onClose={() => setMergeOpen(false)}
          sourceTicket={ticket}
          onMerge={handleMerge}
        />
      )}

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

      {/* Reject Modal */}
      <RejectTicketModal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onConfirm={handleReject}
        loading={rejectLoading}
      />
    </div>
  );
}
