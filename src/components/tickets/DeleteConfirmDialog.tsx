/**
 * Delete Ticket Confirmation Dialog
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface DeleteConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  ticketId: number | null;
}

export default function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  ticketId,
}: DeleteConfirmDialogProps) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Error handled by caller
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#fff1f0]">
            <AlertTriangle size={24} className="text-[#f5222d]" />
          </div>
          <DialogTitle className="text-xl font-medium text-[#1f1f1f]">
            Delete Ticket
          </DialogTitle>
        </DialogHeader>
        <div className="text-center">
          <p className="text-sm text-[#595959]">
            Are you sure you want to delete ticket{' '}
            <span className="font-mono font-medium text-[#1f1f1f]">
              TK-{ticketId}
            </span>
            ? This action cannot be undone.
          </p>
        </div>
        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#e5e0d5] bg-[#f5f0e8] px-4 py-2 text-sm text-[#1f1f1f] transition-colors hover:bg-[#ede7db]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting}
            className="rounded-lg bg-[#fff1f0] border border-[#f5222d] px-4 py-2 text-sm font-medium text-[#f5222d] transition-colors hover:bg-[#ffccc7] disabled:opacity-50 flex items-center gap-2"
          >
            {deleting && <Loader2 size={14} className="animate-spin" />}
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
