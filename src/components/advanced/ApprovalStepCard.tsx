/**
 * ApprovalStepCard - Approval step in a chain
 */
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight,
  Clock,
  AlertTriangle,
  Trash2,
  GripVertical,
  User,
  UsersRound,
  Building,
} from 'lucide-react';

export interface ApprovalStepData {
  id: string;
  order: number;
  approverType: 'user' | 'role' | 'group';
  approverValue: string;
  approverLabel: string;
  timeout: number;
  escalationUser: string;
  escalationLabel?: string;
}

interface ApprovalStepCardProps {
  step: ApprovalStepData;
  chainType: 'sequential' | 'parallel' | 'anyone';
  isLast: boolean;
  onEdit: (step: ApprovalStepData) => void;
  onDelete: (stepId: string) => void;
}

const typeLabels: Record<string, string> = {
  user: 'User',
  role: 'Role',
  group: 'Group',
};

const typeIcons: Record<string, React.ElementType> = {
  user: User,
  role: UsersRound,
  group: Building,
};

export default function ApprovalStepCard({
  step,
  chainType,
  isLast,
  onEdit,
  onDelete,
}: ApprovalStepCardProps) {
  const TypeIcon = typeIcons[step.approverType] || User;

  return (
    <div className="relative">
      <Card
        className="border border-[#e5e0d5] bg-white hover:shadow-md transition-shadow cursor-pointer"
        onClick={() => onEdit(step)}
      >
        <CardHeader className="p-3 pb-0 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-[#c5c0b5]" />
            <Badge
              variant="outline"
              className="text-[10px] h-5 border-[#c9a87c] text-[#c9a87c]"
            >
              Step {step.order}
            </Badge>
            <span className="text-xs font-medium text-[#8a8a8a]">
              {typeLabels[step.approverType]}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-[#c5c0b5] hover:text-red-500"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(step.id);
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-[#f5f2eb] flex items-center justify-center">
              <TypeIcon className="w-3.5 h-3.5 text-[#c9a87c]" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#262626]">
                {step.approverLabel || step.approverValue}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[#8a8a8a]">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{step.timeout}h timeout</span>
            </div>
            {step.escalationUser && (
              <div className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="w-3 h-3" />
                <span>Escalates to {step.escalationLabel || step.escalationUser}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      {!isLast && chainType === 'sequential' && (
        <div className="flex justify-center py-1">
          <ArrowRight className="w-4 h-4 text-[#c9a87c] rotate-90" />
        </div>
      )}
      {!isLast && chainType === 'parallel' && (
        <div className="flex justify-center py-1">
          <div className="text-[10px] text-[#8a8a8a] bg-[#f5f2eb] px-2 py-0.5 rounded">
            parallel
          </div>
        </div>
      )}
    </div>
  );
}
