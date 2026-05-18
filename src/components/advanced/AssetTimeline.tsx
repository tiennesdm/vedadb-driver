/**
 * AssetTimeline — Asset lifecycle timeline component
 */
import { CheckCircle2, Clock, AlertTriangle, Archive } from 'lucide-react';

export interface TimelineEvent {
  id: number;
  event: string;
  date: string;
  user_name?: string;
  type: 'purchase' | 'deploy' | 'assign' | 'maintain' | 'retire' | 'note';
}

const STAGES = [
  { key: 'purchased', label: 'Purchased', icon: CheckCircle2 },
  { key: 'deployed', label: 'Deployed', icon: CheckCircle2 },
  { key: 'in_use', label: 'In Use', icon: CheckCircle2 },
  { key: 'maintenance', label: 'Maintenance', icon: AlertTriangle },
  { key: 'retired', label: 'Retired', icon: Archive },
];

export function AssetLifecycle({ currentStage }: { currentStage: string }) {
  const stageIndex = STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-3">
      {STAGES.map((stage, i) => {
        const Icon = stage.icon;
        const isComplete = i <= stageIndex;
        const isCurrent = i === stageIndex;

        return (
          <div key={stage.key} className="flex items-center gap-1 shrink-0">
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isCurrent
                  ? 'bg-[#c9a87c] text-white'
                  : isComplete
                  ? 'bg-[#f5f0e8] text-[#1f1f1f]'
                  : 'bg-[#f0ece3] text-[#8a8a8a]'
              }`}
            >
              <Icon size={14} />
              <span>{stage.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={`h-0.5 w-4 ${i < stageIndex ? 'bg-[#c9a87c]' : 'bg-[#e5e0d5]'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AssetTimeline({ events }: { events: TimelineEvent[] }) {
  const sorted = [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-0">
      {sorted.map((evt, idx) => {
        const isLast = idx === sorted.length - 1;
        return (
          <div key={evt.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f5f0e8]">
                <Clock size={14} className="text-[#c9a87c]" />
              </div>
              {!isLast && <div className="mt-1 w-0.5 flex-1 bg-[#e5e0d5]" />}
            </div>
            <div className="pb-4">
              <p className="text-sm font-medium text-[#1f1f1f]">{evt.event}</p>
              <div className="flex items-center gap-2 text-xs text-[#8a8a8a] mt-0.5">
                <span>{new Date(evt.date).toLocaleDateString()}</span>
                {evt.user_name && <span>by {evt.user_name}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
