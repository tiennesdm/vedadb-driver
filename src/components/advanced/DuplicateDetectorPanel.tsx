/**
 * DuplicateDetectorPanel — Shows potential duplicate tickets
 * Displays pairs of tickets that may be duplicates with confidence scores
 */
import { useState } from 'react';
import { Copy, AlertTriangle, Check, X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface DuplicatePair {
  id: string;
  ticketA: { id: number; title: string; status: string; created_at: string };
  ticketB: { id: number; title: string; status: string; created_at: string };
  confidence: number;
  reasons: string[];
}

interface DuplicateDetectorPanelProps {
  pairs: DuplicatePair[];
  onMerge?: (pairId: string) => void;
  onDismiss?: (pairId: string) => void;
  onView?: (ticketId: number) => void;
}

export default function DuplicateDetectorPanel({ pairs, onMerge, onDismiss, onView }: DuplicateDetectorPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.85) return '#f5222d';
    if (confidence >= 0.7) return '#faad14';
    return '#c9a87c';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Copy size={18} style={{ color: '#c9a87c' }} />
        <h3 className="text-sm font-medium text-[#1f1f1f]">Potential Duplicates</h3>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-100 px-1.5 text-xs font-medium text-red-600">
          {pairs.length}
        </span>
      </div>

      <AnimatePresence>
        {pairs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#e5e0d5] py-6 text-center">
            <Sparkles size={24} className="mx-auto mb-2 text-[#8a8a8a]" />
            <p className="text-sm text-[#8a8a8a]">No duplicate tickets detected</p>
          </div>
        ) : (
          pairs.map((pair) => (
            <motion.div
              key={pair.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="rounded-lg border border-[#e5e0d5] bg-white"
            >
              <div
                className="cursor-pointer p-3"
                onClick={() => setExpandedId(expandedId === pair.id ? null : pair.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle size={16} style={{ color: getConfidenceColor(pair.confidence) }} />
                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); onView?.(pair.ticketA.id); }}
                          className="text-sm font-medium text-[#1890ff] hover:underline"
                        >
                          #{pair.ticketA.id}
                        </button>
                        <span className="text-xs text-[#8a8a8a]">&</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onView?.(pair.ticketB.id); }}
                          className="text-sm font-medium text-[#1890ff] hover:underline"
                        >
                          #{pair.ticketB.id}
                        </button>
                      </div>
                      <p className="mt-0.5 text-xs text-[#595959]">{pair.ticketA.title}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span
                        className="text-sm font-bold"
                        style={{ color: getConfidenceColor(pair.confidence) }}
                      >
                        {Math.round(pair.confidence * 100)}%
                      </span>
                      <p className="text-[10px] text-[#8a8a8a]">match</p>
                    </div>
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {expandedId === pair.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-[#e5e0d5] px-3 py-2.5">
                      <p className="mb-1.5 text-xs font-medium text-[#1f1f1f]">Match reasons:</p>
                      <ul className="mb-3 space-y-1">
                        {pair.reasons.map((reason, idx) => (
                          <li key={idx} className="flex items-center gap-1.5 text-xs text-[#595959]">
                            <Sparkles size={10} style={{ color: '#c9a87c' }} />
                            {reason}
                          </li>
                        ))}
                      </ul>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onMerge?.(pair.id)}
                          className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                          style={{ backgroundColor: '#c9a87c' }}
                        >
                          <Check size={12} />
                          Merge
                        </button>
                        <button
                          onClick={() => onDismiss?.(pair.id)}
                          className="flex items-center gap-1 rounded-md border border-[#e5e0d5] bg-white px-3 py-1.5 text-xs text-[#595959] transition-colors hover:bg-[#fbf9f4]"
                        >
                          <X size={12} />
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))
        )}
      </AnimatePresence>
    </div>
  );
}
