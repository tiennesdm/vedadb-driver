/**
 * ProblemRCA — Root Cause Analysis section component
 */
import { useState } from 'react';
import { HelpCircle, ArrowRight, GitBranch, Clock, Fish } from 'lucide-react';

export interface WhyNode {
  id: number;
  level: number;
  question: string;
  answer: string;
}

export interface TimelineEventRCA {
  id: number;
  timestamp: string;
  event: string;
  category: string;
}

export interface FishboneCategory {
  category: string;
  causes: string[];
}

export default function ProblemRCA({
  whys,
  timeline,
  fishbone,
  onUpdateWhys,
  readonly = false,
}: {
  whys: WhyNode[];
  timeline: TimelineEventRCA[];
  fishbone: FishboneCategory[];
  onUpdateWhys?: (whys: WhyNode[]) => void;
  readonly?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'5whys' | 'fishbone' | 'timeline'>('5whys');
  const [editingWhys, setEditingWhys] = useState<WhyNode[]>(whys);

  const handleWhyChange = (id: number, field: 'question' | 'answer', value: string) => {
    const updated = editingWhys.map((w) => (w.id === id ? { ...w, [field]: value } : w));
    setEditingWhys(updated);
    onUpdateWhys?.(updated);
  };

  const tabs = [
    { key: '5whys' as const, label: '5 Whys', icon: <HelpCircle size={14} /> },
    { key: 'fishbone' as const, label: 'Fishbone', icon: <Fish size={14} /> },
    { key: 'timeline' as const, label: 'Timeline', icon: <Clock size={14} /> },
  ];

  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white">
      {/* Tabs */}
      <div className="flex border-b border-[#e5e0d5]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === t.key
                ? 'border-[#c9a87c] text-[#c9a87c]'
                : 'border-transparent text-[#8a8a8a] hover:text-[#1f1f1f]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {/* 5 Whys */}
        {activeTab === '5whys' && (
          <div className="space-y-3">
            {editingWhys.map((why, idx) => (
              <div key={why.id} className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#c9a87c] text-[10px] font-bold text-white">
                  {why.level}
                </div>
                <div className="flex-1 space-y-1.5">
                  {readonly ? (
                    <>
                      <p className="text-xs font-medium text-[#1f1f1f]">{why.question}</p>
                      <p className="text-xs text-[#595959]">{why.answer}</p>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={why.question}
                        onChange={(e) => handleWhyChange(why.id, 'question', e.target.value)}
                        className="w-full rounded-md border border-[#e5e0d5] px-2 py-1 text-xs text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                        placeholder={`Why ${idx + 1}?`}
                      />
                      <input
                        type="text"
                        value={why.answer}
                        onChange={(e) => handleWhyChange(why.id, 'answer', e.target.value)}
                        className="w-full rounded-md border border-[#e5e0d5] px-2 py-1 text-xs text-[#595959] outline-none focus:border-[#c9a87c]"
                        placeholder="Answer..."
                      />
                    </>
                  )}
                </div>
                {idx < editingWhys.length - 1 && (
                  <ArrowRight size={14} className="mt-2 shrink-0 text-[#e5e0d5]" />
                )}
              </div>
            ))}

            {editingWhys.length === 0 && (
              <p className="text-center text-xs text-[#8a8a8a] py-4">No 5 Whys analysis recorded yet</p>
            )}

            {!readonly && editingWhys.length < 5 && (
              <button
                onClick={() => {
                  const nextLevel = editingWhys.length + 1;
                  const updated = [
                    ...editingWhys,
                    { id: Date.now(), level: nextLevel, question: '', answer: '' },
                  ];
                  setEditingWhys(updated);
                  onUpdateWhys?.(updated);
                }}
                className="mt-2 rounded-lg border border-dashed border-[#c9a87c] px-3 py-2 text-xs font-medium text-[#c9a87c] hover:bg-[#f5f0e8] transition-colors"
              >
                + Add Why Level {editingWhys.length + 1}
              </button>
            )}
          </div>
        )}

        {/* Fishbone */}
        {activeTab === 'fishbone' && (
          <div className="space-y-3">
            <div className="text-center text-xs text-[#8a8a8a] mb-3">
              <Fish size={24} className="mx-auto mb-2 text-[#c9a87c]" />
              Ishikawa (Fishbone) Diagram
            </div>
            {fishbone.map((cat, i) => (
              <div key={i} className="rounded-lg border border-[#e5e0d5] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <GitBranch size={14} className="text-[#c9a87c]" />
                  <span className="text-xs font-semibold text-[#1f1f1f]">{cat.category}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cat.causes.map((cause, j) => (
                    <span
                      key={j}
                      className="rounded-full bg-[#f5f0e8] px-2.5 py-1 text-[11px] text-[#595959]"
                    >
                      {cause}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {fishbone.length === 0 && (
              <p className="text-center text-xs text-[#8a8a8a] py-4">No fishbone analysis recorded</p>
            )}
          </div>
        )}

        {/* Timeline */}
        {activeTab === 'timeline' && (
          <div className="space-y-0">
            {[...timeline].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((evt, idx, arr) => {
              const isLast = idx === arr.length - 1;
              return (
                <div key={evt.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f5f0e8]">
                      <Clock size={12} className="text-[#c9a87c]" />
                    </div>
                    {!isLast && <div className="mt-1 w-0.5 flex-1 bg-[#e5e0d5]" />}
                  </div>
                  <div className="pb-3">
                    <p className="text-xs font-medium text-[#1f1f1f]">{evt.event}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[#8a8a8a]">{new Date(evt.timestamp).toLocaleString()}</span>
                      <span className="rounded bg-[#f5f0e8] px-1.5 py-0.5 text-[10px] text-[#595959]">{evt.category}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {timeline.length === 0 && (
              <p className="text-center text-xs text-[#8a8a8a] py-4">No timeline events recorded</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
