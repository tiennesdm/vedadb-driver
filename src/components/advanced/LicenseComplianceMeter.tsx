/**
 * LicenseComplianceMeter — License usage gauge component
 */
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

export default function LicenseComplianceMeter({
  used,
  total,
  licenseName,
}: {
  used: number;
  total: number;
  licenseName?: string;
}) {
  const percentage = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const remaining = Math.max(0, total - used);
  const isOverused = used > total;
  const isCritical = percentage >= 90 && !isOverused;

  const getStatusColor = () => {
    if (isOverused) return '#f5222d';
    if (isCritical) return '#faad14';
    return '#52c41a';
  };

  const getStatusBg = () => {
    if (isOverused) return '#fff2f0';
    if (isCritical) return '#fffbe6';
    return '#f6ffed';
  };

  const statusColor = getStatusColor();
  const circumference = 2 * Math.PI * 36;
  const dashOffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center rounded-xl border border-[#e5e0d5] bg-white p-4">
      <div className="relative h-24 w-24">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 80 80">
          {/* Background circle */}
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke="#f0ece3"
            strokeWidth="6"
          />
          {/* Progress circle */}
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke={statusColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={isOverused ? 0 : dashOffset}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-[#1f1f1f]">{percentage}%</span>
        </div>
      </div>

      <div className="mt-2 text-center">
        {licenseName && (
          <p className="text-xs font-medium text-[#1f1f1f] truncate max-w-[150px]">{licenseName}</p>
        )}
        <p className="text-[11px] text-[#8a8a8a] mt-0.5">
          {used} / {total} seats used
        </p>
      </div>

      <div
        className="mt-2 flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium"
        style={{ color: statusColor, backgroundColor: getStatusBg() }}
      >
        {isOverused ? (
          <>
            <XCircle size={12} /> Overused by {used - total}
          </>
        ) : isCritical ? (
          <>
            <AlertTriangle size={12} /> {remaining} seats remaining
          </>
        ) : (
          <>
            <CheckCircle2 size={12} /> Compliant
          </>
        )}
      </div>
    </div>
  );
}
