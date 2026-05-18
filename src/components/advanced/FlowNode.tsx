/**
 * FlowNode - Individual workflow node component
 */
import type { CanvasNode } from './FlowCanvas';
import {
  Zap,
  GitFork,
  Clock,
  Mail,
  Pencil,
  UserPlus,
  MessageSquare,
  Webhook,
  Pause,
  ShieldCheck,
} from 'lucide-react';

interface FlowNodeProps {
  node: CanvasNode;
  isSelected?: boolean;
  isConnecting?: boolean;
}

const NODE_COLORS: Record<string, { bg: string; border: string; icon: React.ElementType }> = {
  // Triggers
  'On Create': { bg: 'bg-emerald-50', border: 'border-emerald-300', icon: Zap },
  'On Update': { bg: 'bg-blue-50', border: 'border-blue-300', icon: Pencil },
  'On Schedule': { bg: 'bg-amber-50', border: 'border-amber-300', icon: Clock },
  // Conditions
  'IF/ELSE': { bg: 'bg-purple-50', border: 'border-purple-300', icon: GitFork },
  // Actions
  'Send Email': { bg: 'bg-sky-50', border: 'border-sky-300', icon: Mail },
  'Update Field': { bg: 'bg-orange-50', border: 'border-orange-300', icon: Pencil },
  'Assign': { bg: 'bg-teal-50', border: 'border-teal-300', icon: UserPlus },
  'Add Comment': { bg: 'bg-indigo-50', border: 'border-indigo-300', icon: MessageSquare },
  'Webhook': { bg: 'bg-pink-50', border: 'border-pink-300', icon: Webhook },
  // Approval
  'Approval': { bg: 'bg-rose-50', border: 'border-rose-300', icon: ShieldCheck },
  // Delay
  'Delay': { bg: 'bg-gray-50', border: 'border-gray-300', icon: Pause },
};

export type { CanvasNode };

export default function FlowNode({ node, isSelected, isConnecting }: FlowNodeProps) {
  const style = NODE_COLORS[node.subtype] || NODE_COLORS[node.type === 'trigger' ? 'On Create' : 'Send Email'];
  const Icon = style.icon;

  return (
    <div
      className={`
        rounded-lg border-2 px-3 py-2.5 cursor-move select-none
        transition-shadow duration-150
        ${style.bg} ${isSelected ? `${style.border} ring-2 ring-[#c9a87c] ring-opacity-50` : `${style.border} hover:shadow-md`}
        ${isConnecting ? 'ring-2 ring-dashed ring-[#c9a87c]' : ''}
      `}
    >
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#595959] flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[#262626] truncate">
            {node.label}
          </div>
          <div className="text-[10px] text-[#8a8a8a] truncate capitalize">
            {node.subtype}
          </div>
        </div>
        {node.type === 'trigger' && (
          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
        )}
      </div>
    </div>
  );
}
