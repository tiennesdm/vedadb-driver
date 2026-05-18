/**
 * TicketRelationshipGraph — Simple div-based relationship visualization
 */
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ArrowRight, GitBranch, Copy, Layers, Lock, AlertCircle } from 'lucide-react';

export type LinkType = 'parent_child' | 'related_to' | 'duplicate_of' | 'blocks' | 'blocked_by';

export interface TicketNode {
  id: number;
  title: string;
  status: string;
  priority: string;
}

export interface TicketLink {
  id: number;
  source_id: number;
  target_id: number;
  link_type: LinkType;
  source?: TicketNode;
  target?: TicketNode;
}

interface TicketRelationshipGraphProps {
  rootTicket: TicketNode;
  links: TicketLink[];
  className?: string;
  onTicketClick?: (ticketId: number) => void;
}

const LINK_CONFIG: Record<LinkType, { label: string; color: string; icon: typeof GitBranch }> = {
  parent_child: { label: 'Parent / Child', color: '#c9a87c', icon: GitBranch },
  related_to: { label: 'Related', color: '#1890ff', icon: Layers },
  duplicate_of: { label: 'Duplicate', color: '#8a8a8a', icon: Copy },
  blocks: { label: 'Blocks', color: '#f5222d', icon: Lock },
  blocked_by: { label: 'Blocked By', color: '#faad14', icon: AlertCircle },
};

export function getLinkConfig(linkType: LinkType) {
  return LINK_CONFIG[linkType] ?? LINK_CONFIG.related_to;
}

export default function TicketRelationshipGraph({
  rootTicket,
  links,
  className,
  onTicketClick,
}: TicketRelationshipGraphProps) {
  const grouped = useMemo(() => {
    const g: Record<LinkType, TicketLink[]> = {
      parent_child: [],
      related_to: [],
      duplicate_of: [],
      blocks: [],
      blocked_by: [],
    };
    links.forEach((l) => {
      if (g[l.link_type]) g[l.link_type].push(l);
      else g.related_to.push(l);
    });
    return g;
  }, [links]);

  return (
    <div className={cn('rounded-lg border border-[#e5e0d5] bg-white p-4', className)}>
      <h4 className="text-sm font-semibold text-[#262626] mb-3">Relationship Graph</h4>

      {/* Root node */}
      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-[#c9a87c]/10 border border-[#c9a87c]/30">
        <div className="h-8 w-8 rounded-full bg-[#c9a87c] flex items-center justify-center text-white text-xs font-bold">
          #{rootTicket.id}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#262626] truncate">{rootTicket.title}</p>
          <p className="text-xs text-[#8a8a8a] capitalize">{rootTicket.status} · {rootTicket.priority}</p>
        </div>
      </div>

      {/* Linked nodes grouped by type */}
      {(Object.keys(grouped) as LinkType[]).map((linkType) => {
        const groupLinks = grouped[linkType];
        if (groupLinks.length === 0) return null;
        const config = LINK_CONFIG[linkType];
        const Icon = config.icon;

        return (
          <div key={linkType} className="mb-3 last:mb-0">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
              <span className="text-xs font-medium text-[#595959]">{config.label}</span>
              <span className="text-xs text-[#8a8a8a]">({groupLinks.length})</span>
            </div>
            <div className="pl-5 space-y-2">
              {groupLinks.map((link) => {
                const isSource = link.source_id === rootTicket.id;
                const node = isSource ? link.target : link.source;
                if (!node) return null;
                return (
                  <button
                    key={link.id}
                    onClick={() => onTicketClick?.(node.id)}
                    className="flex items-center gap-2 w-full text-left p-2 rounded-md hover:bg-[#f5f3ef] transition-colors"
                  >
                    <ArrowRight
                      className="h-3 w-3 shrink-0"
                      style={{ color: config.color, transform: isSource ? 'none' : 'rotate(180deg)' }}
                    />
                    <div className="h-6 w-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium shrink-0"
                      style={{ backgroundColor: config.color }}>
                      #{node.id}
                    </div>
                    <span className="text-xs text-[#262626] truncate flex-1">{node.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f5f3ef] text-[#8a8a8a] capitalize shrink-0">
                      {node.status}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {links.length === 0 && (
        <div className="text-center py-6 text-[#8a8a8a] text-sm">No linked tickets</div>
      )}
    </div>
  );
}
