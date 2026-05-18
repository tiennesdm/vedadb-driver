/**
 * AIConfidenceMeter — Gauge showing AI confidence level
 * Animated circular gauge with color-coded confidence bands
 */
import { motion } from 'framer-motion';
import { Brain } from 'lucide-react';

interface AIConfidenceMeterProps {
  confidence: number; // 0-1
  size?: number;
  label?: string;
  showLabel?: boolean;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return '#52c41a';
  if (confidence >= 0.75) return '#c9a87c';
  if (confidence >= 0.6) return '#faad14';
  return '#f5222d';
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return 'High';
  if (confidence >= 0.75) return 'Good';
  if (confidence >= 0.6) return 'Fair';
  return 'Low';
}

export default function AIConfidenceMeter({ confidence, size = 120, label, showLabel = true }: AIConfidenceMeterProps) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(confidence, 0), 1);
  const dashOffset = circumference * (1 - progress);
  const color = getConfidenceColor(confidence);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e5e0d5"
            strokeWidth={strokeWidth}
          />
          {/* Progress circle */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: dashOffset }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Brain size={size * 0.22} style={{ color }} />
          <motion.span
            className="text-lg font-bold"
            style={{ color }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {Math.round(progress * 100)}%
          </motion.span>
        </div>
      </div>
      {showLabel && (
        <div className="mt-2 text-center">
          <p className="text-sm font-medium text-[#1f1f1f]">{label || 'AI Confidence'}</p>
          <p className="text-xs" style={{ color }}>{getConfidenceLabel(confidence)}</p>
        </div>
      )}
    </div>
  );
}
