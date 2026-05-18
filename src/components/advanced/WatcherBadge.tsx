/**
 * WatcherBadge — Avatar stack for ticket watchers
 */
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Eye } from 'lucide-react';

export interface Watcher {
  id: number;
  name: string;
  email: string;
  avatar?: string;
  role?: string;
}

interface WatcherBadgeProps {
  watchers: Watcher[];
  maxDisplay?: number;
  onRemove?: (watcherId: number) => void;
  editable?: boolean;
  className?: string;
}

export default function WatcherBadge({
  watchers,
  maxDisplay = 3,
  onRemove,
  editable = false,
  className,
}: WatcherBadgeProps) {
  const display = watchers.slice(0, maxDisplay);
  const overflow = watchers.length - maxDisplay;

  return (
    <TooltipProvider>
      <div className={cn('flex items-center gap-1', className)}>
        <Eye className="h-3.5 w-3.5 text-[#8a8a8a] mr-1" />
        <div className="flex -space-x-2">
          {display.map((w) => (
            <Tooltip key={w.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => editable && onRemove?.(w.id)}
                  className={cn(
                    'relative inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#c9a87c] text-xs font-medium text-white shadow-sm',
                    editable && 'cursor-pointer hover:ring-2 hover:ring-red-400'
                  )}
                >
                  {w.avatar ? (
                    <img src={w.avatar} alt={w.name} className="h-full w-full rounded-full object-cover" />
                  ) : (
                    w.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-white border border-[#e5e0d5]">
                <div className="text-xs">
                  <p className="font-medium text-[#262626]">{w.name}</p>
                  <p className="text-[#8a8a8a]">{w.email}</p>
                  {w.role && <p className="text-[#8a8a8a] capitalize">{w.role}</p>}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
          {overflow > 0 && (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#e5e0d5] text-[10px] font-medium text-[#595959]">
              +{overflow}
            </div>
          )}
        </div>
        {watchers.length === 0 && (
          <span className="text-xs text-[#8a8a8a]">No watchers</span>
        )}
      </div>
    </TooltipProvider>
  );
}
