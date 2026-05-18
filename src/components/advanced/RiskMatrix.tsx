/**
 * RiskMatrix — 3×3 Risk matrix (Impact × Urgency = Risk Level)
 */
import { AlertTriangle, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';

export interface RiskCell {
  impact: 'Low' | 'Medium' | 'High';
  urgency: 'Low' | 'Medium' | 'High';
  level: 'Low' | 'Medium' | 'High';
}

const DEFAULT_MATRIX: RiskCell[] = [
  { impact: 'Low', urgency: 'Low', level: 'Low' },
  { impact: 'Low', urgency: 'Medium', level: 'Low' },
  { impact: 'Low', urgency: 'High', level: 'Medium' },
  { impact: 'Medium', urgency: 'Low', level: 'Low' },
  { impact: 'Medium', urgency: 'Medium', level: 'Medium' },
  { impact: 'Medium', urgency: 'High', level: 'High' },
  { impact: 'High', urgency: 'Low', level: 'Medium' },
  { impact: 'High', urgency: 'Medium', level: 'High' },
  { impact: 'High', urgency: 'High', level: 'High' },
];

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Low': { bg: '#f6ffed', text: '#52c41a', border: '#b7eb8f' },
  'Medium': { bg: '#fffbe6', text: '#faad14', border: '#ffe58f' },
  'High': { bg: '#fff2f0', text: '#f5222d', border: '#ffccc7' },
};

const LEVEL_ICONS: Record<string, React.ReactNode> = {
  'Low': <ShieldCheck size={16} />,
  'Medium': <Shield size={16} />,
  'High': <ShieldAlert size={16} />,
};

export default function RiskMatrix({
  selectedImpact,
  selectedUrgency,
  onSelect,
}: {
  selectedImpact?: string;
  selectedUrgency?: string;
  onSelect?: (impact: string, urgency: string, level: string) => void;
}) {
  const impacts = ['High', 'Medium', 'Low'];
  const urgencies = ['Low', 'Medium', 'High'];

  const getCell = (impact: string, urgency: string) =>
    DEFAULT_MATRIX.find((c) => c.impact === impact && c.urgency === urgency);

  const isSelected = (impact: string, urgency: string) =>
    selectedImpact === impact && selectedUrgency === urgency;

  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={16} className="text-[#c9a87c]" />
        <h3 className="text-sm font-semibold text-[#1f1f1f]">Risk Assessment Matrix</h3>
      </div>

      <div className="mb-1 text-center text-xs font-medium text-[#8a8a8a]">Urgency →</div>

      <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-1">
        {/* Header row */}
        <div className="text-[10px] text-[#8a8a8a] font-medium" />
        {urgencies.map((u) => (
          <div key={u} className="text-center text-[10px] font-semibold text-[#595959] py-1">{u}</div>
        ))}

        {/* Data rows */}
        {impacts.map((impact) => (
          <div key={impact} className="contents">
            <div className="flex items-center justify-end pr-2 text-[10px] font-semibold text-[#595959]">
              {impact}
            </div>
            {urgencies.map((urgency) => {
              const cell = getCell(impact, urgency);
              if (!cell) return null;
              const colors = LEVEL_COLORS[cell.level];
              const selected = isSelected(impact, urgency);

              return (
                <button
                  key={`${impact}-${urgency}`}
                  onClick={() => onSelect?.(impact, urgency, cell.level)}
                  className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 px-2 py-3 transition-all hover:opacity-80"
                  style={{
                    backgroundColor: colors.bg,
                    borderColor: selected ? '#c9a87c' : colors.border,
                  }}
                >
                  <span style={{ color: colors.text }}>{LEVEL_ICONS[cell.level]}</span>
                  <span className="text-[10px] font-bold" style={{ color: colors.text }}>
                    {cell.level}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-1 text-center text-[10px] text-[#8a8a8a] font-medium">Impact →</div>

      {selectedImpact && selectedUrgency && (
        <div className="mt-3 rounded-lg bg-[#f5f0e8] px-3 py-2 text-center">
          <span className="text-xs text-[#595959]">Selected: </span>
          <span className="text-xs font-bold text-[#1f1f1f]">
            {selectedImpact} Impact × {selectedUrgency} Urgency
          </span>
          <span className="text-xs text-[#595959]"> = </span>
          <span
            className="text-xs font-bold"
            style={{ color: LEVEL_COLORS[getCell(selectedImpact, selectedUrgency)?.level || 'Low'].text }}
          >
            {getCell(selectedImpact, selectedUrgency)?.level || 'Low'} Risk
          </span>
        </div>
      )}
    </div>
  );
}
