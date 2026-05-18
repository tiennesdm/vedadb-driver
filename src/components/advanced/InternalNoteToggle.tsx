/**
 * InternalNoteToggle — Toggle between Internal Note and Public Reply
 */
import { cn } from '@/lib/utils';
import { Lock, Globe } from 'lucide-react';

interface InternalNoteToggleProps {
  isInternal: boolean;
  onChange: (isInternal: boolean) => void;
  className?: string;
}

export default function InternalNoteToggle({
  isInternal,
  onChange,
  className,
}: InternalNoteToggleProps) {
  return (
    <div className={cn('flex items-center gap-1 rounded-lg border border-[#e5e0d5] p-0.5', className)}>
      <button
        onClick={() => onChange(false)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
          !isInternal
            ? 'bg-[#c9a87c] text-[#1f1f1f]'
            : 'text-[#8a8a8a] hover:text-[#595959]'
        )}
      >
        <Globe size={13} />
        Public Reply
      </button>
      <button
        onClick={() => onChange(true)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
          isInternal
            ? 'bg-[#fff7e6] text-[#d48806] border border-[#ffd666]'
            : 'text-[#8a8a8a] hover:text-[#595959]'
        )}
      >
        <Lock size={13} />
        Internal Note
      </button>
    </div>
  );
}
