/**
 * EscalationChain — Visual escalation chain: L1 → L2 → L3 → Manager → Director
 */
import { cn } from '@/lib/utils';
import { ArrowRight, User, Shield, Crown, Briefcase, Headphones } from 'lucide-react';

export type EscalationLevel = 'L1' | 'L2' | 'L3' | 'MANAGER' | 'DIRECTOR';

interface EscalationStep {
  level: EscalationLevel;
  name?: string;
  hours: number;
  assigned?: boolean;
}

interface EscalationChainProps {
  steps: EscalationStep[];
  currentLevel?: EscalationLevel;
  className?: string;
}

const LEVEL_CONFIG: Record<EscalationLevel, { label: string; color: string; icon: typeof User }> = {
  L1: { label: 'Level 1 Support', color: '#52c41a', icon: Headphones },
  L2: { label: 'Level 2 Support', color: '#1890ff', icon: User },
  L3: { label: 'Level 3 Support', color: '#722ed1', icon: Shield },
  MANAGER: { label: 'Manager', color: '#faad14', icon: Briefcase },
  DIRECTOR: { label: 'Director', color: '#f5222d', icon: Crown },
};

export default function EscalationChain({ steps, currentLevel, className }: EscalationChainProps) {
  const sorted = [...steps].sort((a, b) => {
    const order: EscalationLevel[] = ['L1', 'L2', 'L3', 'MANAGER', 'DIRECTOR'];
    return order.indexOf(a.level) - order.indexOf(b.level);
  });

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {sorted.map((step, idx) => {
        const config = LEVEL_CONFIG[step.level];
        const Icon = config.icon;
        const isCurrent = currentLevel === step.level;

        return (
          <div key={step.level} className="flex items-center gap-1">
            {idx > 0 && (
              <div className="flex flex-col items-center px-1">
                <ArrowRight className="h-3 w-3 text-[#8a8a8a]" />
                <span className="text-[9px] text-[#8a8a8a]">{step.hours}h</span>
              </div>
            )}
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 border transition-all',
                isCurrent
                  ? 'ring-2 ring-offset-1 border-transparent'
                  : 'border-[#e5e0d5] bg-white'
              )}
              style={{
                borderColor: isCurrent ? config.color : undefined,
                ['--tw-ring-color' as string]: isCurrent ? config.color : undefined,
                backgroundColor: isCurrent ? `${config.color}15` : undefined,
              }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-[#262626]">{step.level}</span>
                {step.name && (
                  <span className="text-[9px] text-[#8a8a8a] leading-tight">{step.name}</span>
                )}
              </div>
              {isCurrent && (
                <div
                  className="ml-1 h-2 w-2 rounded-full animate-pulse"
                  style={{ backgroundColor: config.color }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
