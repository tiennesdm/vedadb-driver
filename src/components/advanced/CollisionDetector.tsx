/**
 * CollisionDetector — Warning banner when multiple agents view the same ticket
 */
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ActiveViewer {
  userId: number;
  name: string;
  avatar?: string;
  since: string;
}

interface CollisionDetectorProps {
  ticketId: number;
  currentUserId: number;
  viewers?: ActiveViewer[];
  onRefreshViewers?: () => void;
  className?: string;
}

export default function CollisionDetector({
  ticketId: _ticketId,
  currentUserId,
  viewers = [],
  onRefreshViewers,
  className,
}: CollisionDetectorProps) {
  void _ticketId;
  const [dismissed, setDismissed] = useState(false);
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 5000);
    return () => clearTimeout(t);
  }, [viewers]);

  // Poll for viewer updates
  useEffect(() => {
    const interval = setInterval(() => {
      onRefreshViewers?.();
    }, 30000);
    return () => clearInterval(interval);
  }, [onRefreshViewers]);

  const otherViewers = viewers.filter((v) => v.userId !== currentUserId);

  if (dismissed || otherViewers.length === 0) return null;

  return (
    <div
      className={cn(
        'relative flex items-center gap-3 rounded-lg border px-4 py-3',
        pulse ? 'animate-pulse border-[#c9a87c] bg-[#c9a87c]/10' : 'border-[#c9a87c]/40 bg-[#c9a87c]/5',
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-[#c9a87c]" />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Users className="h-3.5 w-3.5 text-[#8a8a8a]" />
        <span className="text-xs text-[#262626]">
          <strong>{otherViewers.length}</strong> other {otherViewers.length === 1 ? 'agent is' : 'agents are'} viewing
          this ticket:
        </span>
        <div className="flex -space-x-1.5">
          {otherViewers.slice(0, 4).map((v) => (
            <div
              key={v.userId}
              className="h-5 w-5 rounded-full border border-white bg-[#c9a87c] flex items-center justify-center text-white text-[9px] font-medium"
              title={`${v.name} (since ${v.since})`}
            >
              {v.avatar ? (
                <img src={v.avatar} alt={v.name} className="h-full w-full rounded-full object-cover" />
              ) : (
                v.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
              )}
            </div>
          ))}
        </div>
        <span className="text-[11px] text-[#8a8a8a] truncate">
          {otherViewers.map((v) => v.name).join(', ')}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-[#8a8a8a] hover:text-[#262626]"
        onClick={() => setDismissed(true)}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
