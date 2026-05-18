/**
 * AutoSummaryCard — AI-generated ticket summary
 * Displays a concise AI-generated summary of a ticket
 */
import { useState } from 'react';
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Clock, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface TicketSummary {
  ticketId: number;
  summary: string;
  keyPoints: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  estimatedResolution: string;
  confidence: number;
  generatedAt: string;
}

interface AutoSummaryCardProps {
  summary: TicketSummary;
  onRegenerate?: (ticketId: number) => void;
}

export default function AutoSummaryCard({ summary, onRegenerate }: AutoSummaryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRegenerate = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      onRegenerate?.(summary.ticketId);
    }, 1200);
  };

  const sentimentColor = {
    positive: '#52c41a',
    neutral: '#8a8a8a',
    negative: '#faad14',
  }[summary.sentiment];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-[#e5e0d5] bg-white"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e5e0d5] px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} style={{ color: '#c9a87c' }} />
          <h4 className="text-sm font-medium text-[#1f1f1f]">AI Summary</h4>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: `${sentimentColor}15`, color: sentimentColor }}
          >
            {summary.sentiment}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRegenerate}
            disabled={isRefreshing}
            className="rounded p-1 transition-colors hover:bg-[#fbf9f4] disabled:opacity-50"
          >
            <RefreshCw size={14} className={`text-[#8a8a8a] ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="rounded p-1 transition-colors hover:bg-[#fbf9f4]"
          >
            {isExpanded ? <ChevronUp size={14} className="text-[#8a8a8a]" /> : <ChevronDown size={14} className="text-[#8a8a8a]" />}
          </button>
        </div>
      </div>

      {/* Summary Body */}
      <div className="p-4">
        <p className="text-sm leading-relaxed text-[#1f1f1f]">{summary.summary}</p>

        {/* Confidence & Meta */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 text-xs text-[#8a8a8a]">
            <Sparkles size={12} style={{ color: '#c9a87c' }} />
            <span>{Math.round(summary.confidence * 100)}% confidence</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-[#8a8a8a]">
            <Clock size={12} />
            <span>~{summary.estimatedResolution}</span>
          </div>
        </div>

        {/* Expanded Details */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-2 border-t border-[#e5e0d5] pt-3">
                <p className="text-xs font-medium text-[#1f1f1f]">Key Points</p>
                <ul className="space-y-1.5">
                  {summary.keyPoints.map((point, idx) => (
                    <motion.li
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="flex items-start gap-2 text-xs text-[#595959]"
                    >
                      <Tag size={12} className="mt-0.5 shrink-0 text-[#c9a87c]" />
                      {point}
                    </motion.li>
                  ))}
                </ul>
                <p className="pt-1 text-[10px] text-[#8a8a8a]">Generated {summary.generatedAt}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
