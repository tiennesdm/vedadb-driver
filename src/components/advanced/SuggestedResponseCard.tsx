/**
 * SuggestedResponseCard — AI-suggested response from KB
 * Shows a suggested response for a ticket based on KB articles
 */
import { useState } from 'react';
import { BookOpen, Check, Copy, ThumbsUp, ThumbsDown, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

export interface SuggestedResponse {
  id: string;
  ticketId: number;
  source: 'kb' | 'canned' | 'ai_generated';
  sourceTitle: string;
  responseText: string;
  confidence: number;
  relevanceScore: number;
}

interface SuggestedResponseCardProps {
  suggestion: SuggestedResponse;
  onUse?: (id: string) => void;
  onCopy?: (text: string) => void;
  onFeedback?: (id: string, helpful: boolean) => void;
}

const SOURCE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  kb: { label: 'KB Article', color: '#1890ff', bg: 'rgba(24,144,255,0.1)' },
  canned: { label: 'Canned Response', color: '#52c41a', bg: 'rgba(82,196,26,0.1)' },
  ai_generated: { label: 'AI Generated', color: '#c9a87c', bg: 'rgba(201,168,124,0.1)' },
};

export default function SuggestedResponseCard({ suggestion, onUse, onCopy, onFeedback }: SuggestedResponseCardProps) {
  const [copied, setCopied] = useState(false);
  const sourceConfig = SOURCE_LABELS[suggestion.source] || SOURCE_LABELS.ai_generated;

  const handleCopy = () => {
    navigator.clipboard?.writeText(suggestion.responseText);
    setCopied(true);
    onCopy?.(suggestion.responseText);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-[#e5e0d5] bg-white"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e5e0d5] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <BookOpen size={14} style={{ color: sourceConfig.color }} />
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: sourceConfig.bg, color: sourceConfig.color }}
          >
            {sourceConfig.label}
          </span>
          <span className="max-w-[200px] truncate text-xs text-[#595959]">{suggestion.sourceTitle}</span>
        </div>
        <div className="flex items-center gap-1">
          <Sparkles size={12} style={{ color: '#c9a87c' }} />
          <span className="text-xs font-medium" style={{ color: '#c9a87c' }}>{Math.round(suggestion.confidence * 100)}%</span>
        </div>
      </div>

      {/* Response Text */}
      <div className="bg-[#fbf9f4] px-4 py-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1f1f1f]">{suggestion.responseText}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onUse?.(suggestion.id)}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#c9a87c', color: '#1f1f1f' }}
          >
            <Check size={12} />
            Use Response
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-lg border border-[#e5e0d5] bg-white px-3 py-1.5 text-xs text-[#595959] transition-colors hover:bg-[#fbf9f4]"
          >
            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onFeedback?.(suggestion.id, true)}
            className="rounded p-1.5 transition-colors hover:bg-green-50"
          >
            <ThumbsUp size={14} className="text-[#8a8a8a] hover:text-green-500" />
          </button>
          <button
            onClick={() => onFeedback?.(suggestion.id, false)}
            className="rounded p-1.5 transition-colors hover:bg-red-50"
          >
            <ThumbsDown size={14} className="text-[#8a8a8a] hover:text-red-500" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
