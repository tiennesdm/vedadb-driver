/**
 * CIRelationshipGraph — Configuration item relationship visualization
 */
import { Server, Laptop, Router, HardDrive, Smartphone, Monitor, Printer, Cable, Link2 } from 'lucide-react';

export interface CIRelationship {
  id: number;
  from_ci: string;
  from_type: string;
  to_ci: string;
  to_type: string;
  relation_type: string;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  'Server': <Server size={14} />,
  'Laptop': <Laptop size={14} />,
  'Desktop': <Monitor size={14} />,
  'Network Device': <Router size={14} />,
  'Mobile Device': <Smartphone size={14} />,
  'Monitor': <Monitor size={14} />,
  'Printer': <Printer size={14} />,
  'Peripheral': <Cable size={14} />,
};

const REL_COLORS: Record<string, string> = {
  'depends_on': '#f5222d',
  'connected_to': '#1890ff',
  'installed_on': '#52c41a',
  'part_of': '#faad14',
  'resides_in': '#722ed1',
};

export default function CIRelationshipGraph({ relationships, rootAsset }: { relationships: CIRelationship[]; rootAsset: string }) {
  const uniqueCIs = new Set<string>();
  uniqueCIs.add(rootAsset);
  relationships.forEach((r) => {
    uniqueCIs.add(r.from_ci);
    uniqueCIs.add(r.to_ci);
  });

  void uniqueCIs; // unique CI list for future use

  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Link2 size={16} className="text-[#c9a87c]" />
        <h3 className="text-sm font-semibold text-[#1f1f1f]">CI Relationships</h3>
        <span className="rounded-full bg-[#f5f0e8] px-2 py-0.5 text-xs text-[#595959]">{relationships.length}</span>
      </div>

      {/* Root node */}
      <div className="mb-3 flex items-center gap-2 rounded-lg bg-[#f5f0e8] px-3 py-2">
        <HardDrive size={16} className="text-[#c9a87c]" />
        <span className="text-sm font-semibold text-[#1f1f1f]">{rootAsset}</span>
        <span className="rounded bg-[#c9a87c] px-1.5 py-0.5 text-[10px] text-white font-medium">ROOT</span>
      </div>

      {/* Relationship list */}
      <div className="space-y-2 ml-4">
        {relationships.map((rel) => {
          const isFromRoot = rel.from_ci === rootAsset;
          const target = isFromRoot ? rel.to_ci : rel.from_ci;
          const targetType = isFromRoot ? rel.to_type : rel.from_type;
          const color = REL_COLORS[rel.relation_type] || '#8a8a8a';

          return (
            <div key={rel.id} className="flex items-center gap-2 rounded-md border border-[#e5e0d5] px-3 py-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-[#f5f0e8] text-[#595959]">
                {TYPE_ICON[targetType] || <HardDrive size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#1f1f1f] truncate">{target}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] text-white font-medium"
                    style={{ backgroundColor: color }}
                  >
                    {rel.relation_type}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {relationships.length === 0 && (
        <p className="text-center text-sm text-[#8a8a8a] py-4">No relationships defined</p>
      )}
    </div>
  );
}
