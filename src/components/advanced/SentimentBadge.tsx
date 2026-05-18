/**
 * SentimentBadge — Badge showing sentiment (Positive/Neutral/Negative)
 * Displays sentiment with appropriate emoji and color
 */
import { motion } from 'framer-motion';
import { Smile, Meh, Frown, AlertTriangle } from 'lucide-react';

export type SentimentType = 'positive' | 'neutral' | 'negative' | 'critical';

interface SentimentBadgeProps {
  sentiment: SentimentType;
  score?: number; // -1 to 1
  showScore?: boolean;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean; // pulse animation for critical
}

const SENTIMENT_CONFIG: Record<SentimentType, { label: string; color: string; bg: string; icon: typeof Smile }> = {
  positive: { label: 'Positive', color: '#52c41a', bg: 'rgba(82,196,26,0.1)', icon: Smile },
  neutral: { label: 'Neutral', color: '#8a8a8a', bg: 'rgba(138,138,138,0.1)', icon: Meh },
  negative: { label: 'Negative', color: '#faad14', bg: 'rgba(250,173,20,0.1)', icon: Frown },
  critical: { label: 'Critical', color: '#f5222d', bg: 'rgba(245,34,45,0.1)', icon: AlertTriangle },
};

export default function SentimentBadge({ sentiment, score, showScore = true, size = 'md', pulse = false }: SentimentBadgeProps) {
  const config = SENTIMENT_CONFIG[sentiment];
  const Icon = config.icon;
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-3 py-1 text-sm gap-1.5',
    lg: 'px-4 py-2 text-base gap-2',
  };
  const iconSizes = { sm: 12, md: 16, lg: 20 };

  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`inline-flex items-center rounded-full font-medium ${sizeClasses[size]}`}
      style={{
        backgroundColor: config.bg,
        color: config.color,
      }}
    >
      {pulse && sentiment === 'critical' ? (
        <motion.span
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1 }}
        >
          <Icon size={iconSizes[size]} />
        </motion.span>
      ) : (
        <Icon size={iconSizes[size]} />
      )}
      {config.label}
      {showScore && score !== undefined && (
        <span className="opacity-70">({score > 0 ? '+' : ''}{score.toFixed(2)})</span>
      )}
    </motion.span>
  );
}

/** Inline sentiment dot for tables */
export function SentimentDot({ sentiment }: { sentiment: SentimentType }) {
  const config = SENTIMENT_CONFIG[sentiment];
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: config.color }}
      title={config.label}
    />
  );
}
