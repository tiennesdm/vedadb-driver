/**
 * Create/Edit Ticket Modal Form
 */
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { User, Category, Ticket } from '@/hooks/useTickets';
import { Loader2 } from 'lucide-react';

interface TicketFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    priority: string;
    category: string;
    assigned_to: number | null;
    status?: string;
  }) => Promise<void>;
  ticket: Ticket | null;
  users: User[];
  categories: Category[];
}

export default function TicketFormModal({
  open,
  onClose,
  onSubmit,
  ticket,
  users,
  categories,
}: TicketFormModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [category, setCategory] = useState('');
  const [assignee, setAssignee] = useState('unassigned');
  const [status, setStatus] = useState('open');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEdit = !!ticket;

  useEffect(() => {
    if (ticket) {
      setTitle(ticket.title || '');
      setDescription(ticket.description || '');
      setPriority(ticket.priority || 'medium');
      setCategory(ticket.category || '');
      setAssignee(ticket.assigned_to ? String(ticket.assigned_to) : 'unassigned');
      setStatus(ticket.status || 'open');
    } else {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setCategory('');
      setAssignee('unassigned');
      setStatus('open');
    }
    setErrors({});
  }, [ticket, open]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!title.trim() || title.trim().length < 5) errs.title = 'Title must be at least 5 characters';
    if (title.trim().length > 200) errs.title = 'Title must be 200 characters or less';
    if (!priority) errs.priority = 'Priority is required';
    if (!category) errs.category = 'Category is required';
    if (description.length > 5000) errs.description = 'Description must be 5000 characters or less';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description,
        priority,
        category,
        assigned_to: assignee === 'unassigned' ? null : Number(assignee),
        ...(isEdit ? { status } : {}),
      });
      onClose();
    } catch {
      // Error handled by caller
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-medium text-[#1f1f1f]">
            {isEdit ? 'Edit Ticket' : 'Create Ticket'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="ticket-title" className="text-xs uppercase tracking-[0.1em] text-[#595959]">
              Title *
            </Label>
            <Input
              id="ticket-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter ticket title..."
              className="h-10 border-[#e5e0d5] focus:border-[#c9a87c] focus:ring-[rgba(201,168,124,0.15)]"
            />
            {errors.title && <p className="text-xs text-[#f5222d]">{errors.title}</p>}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="ticket-desc" className="text-xs uppercase tracking-[0.1em] text-[#595959]">
              Description
            </Label>
            <Textarea
              id="ticket-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue..."
              rows={4}
              className="border-[#e5e0d5] focus:border-[#c9a87c] focus:ring-[rgba(201,168,124,0.15)] resize-none"
            />
            {errors.description && <p className="text-xs text-[#f5222d]">{errors.description}</p>}
          </div>

          {/* Priority + Category */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.1em] text-[#595959]">Priority *</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-10 border-[#e5e0d5] bg-transparent">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              {errors.priority && <p className="text-xs text-[#f5222d]">{errors.priority}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.1em] text-[#595959]">Category *</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-10 border-[#e5e0d5] bg-transparent">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && <p className="text-xs text-[#f5222d]">{errors.category}</p>}
            </div>
          </div>

          {/* Assign To */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.1em] text-[#595959]">Assign To</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="h-10 border-[#e5e0d5] bg-transparent">
                <SelectValue placeholder="Select assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status - edit only */}
          {isEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.1em] text-[#595959]">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-10 border-[#e5e0d5] bg-transparent">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter className="pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#e5e0d5] bg-[#f5f0e8] px-4 py-2 text-sm text-[#1f1f1f] transition-colors hover:bg-[#ede7db]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Ticket'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
