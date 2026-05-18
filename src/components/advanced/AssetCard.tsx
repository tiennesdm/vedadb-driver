/**
 * AssetCard — Asset summary card component
 */
import { Laptop, Monitor, Server, Printer, Smartphone, Router, HardDrive, Cable, QrCode } from 'lucide-react';

export interface AssetCardData {
  id: number;
  asset_tag: string;
  name: string;
  type: string;
  manufacturer: string;
  model: string;
  status: string;
  location: string;
  assigned_to_name?: string;
  warranty_expiry?: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  'Laptop': <Laptop size={20} />,
  'Desktop': <Monitor size={20} />,
  'Server': <Server size={20} />,
  'Printer': <Printer size={20} />,
  'Mobile Device': <Smartphone size={20} />,
  'Network Device': <Router size={20} />,
  'Monitor': <Monitor size={20} />,
  'Peripheral': <Cable size={20} />,
};

const STATUS_COLORS: Record<string, string> = {
  'In Use': '#52c41a',
  'Available': '#1890ff',
  'In Repair': '#faad14',
  'Retired': '#8a8a8a',
  'Lost/Stolen': '#f5222d',
};

export default function AssetCard({ asset, onClick }: { asset: AssetCardData; onClick?: () => void }) {
  const icon = TYPE_ICONS[asset.type] || <HardDrive size={20} />;
  const statusColor = STATUS_COLORS[asset.status] || '#8a8a8a';

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-[#e5e0d5] bg-white p-4 transition-all hover:shadow-md hover:border-[#c9a87c]"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: '#c9a87c' }}
          >
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#1f1f1f] truncate max-w-[180px]">{asset.name}</h3>
            <p className="text-xs text-[#8a8a8a]">{asset.asset_tag}</p>
          </div>
        </div>
        <QrCode size={16} className="text-[#8a8a8a]" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ backgroundColor: statusColor }}
        >
          {asset.status}
        </span>
        <span className="rounded-full bg-[#f5f0e8] px-2 py-0.5 text-[10px] font-medium text-[#595959]">
          {asset.type}
        </span>
      </div>

      <div className="mt-3 space-y-1 text-xs text-[#595959]">
        <div className="flex justify-between">
          <span>Manufacturer</span>
          <span className="font-medium text-[#1f1f1f]">{asset.manufacturer}</span>
        </div>
        <div className="flex justify-between">
          <span>Model</span>
          <span className="font-medium text-[#1f1f1f]">{asset.model}</span>
        </div>
        <div className="flex justify-between">
          <span>Location</span>
          <span className="font-medium text-[#1f1f1f]">{asset.location}</span>
        </div>
        {asset.assigned_to_name && (
          <div className="flex justify-between">
            <span>Assigned</span>
            <span className="font-medium text-[#1f1f1f]">{asset.assigned_to_name}</span>
          </div>
        )}
      </div>
    </div>
  );
}
