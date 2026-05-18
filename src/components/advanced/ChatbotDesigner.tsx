/**
 * ChatbotDesigner — Intent/response configuration panel
 * Visual designer for chatbot intents, training phrases, and responses
 */
import { useState } from 'react';
import { Plus, Trash2, MessageSquare, BookOpen, ArrowUpRight, GripVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Intent {
  id: string;
  name: string;
  trainingPhrases: string[];
  responseType: 'text' | 'kb_article' | 'escalate';
  responseText: string;
  kbArticleId?: string;
  confidence: number;
}

interface ChatbotDesignerProps {
  intents: Intent[];
  onIntentsChange: (intents: Intent[]) => void;
}

const RESPONSE_TYPES = [
  { value: 'text' as const, label: 'Text Response', icon: MessageSquare },
  { value: 'kb_article' as const, label: 'KB Article Link', icon: BookOpen },
  { value: 'escalate' as const, label: 'Escalate to Agent', icon: ArrowUpRight },
];

export default function ChatbotDesigner({ intents, onIntentsChange }: ChatbotDesignerProps) {
  const [selectedIntent, setSelectedIntent] = useState<string | null>(null);
  const [newPhrase, setNewPhrase] = useState('');

  const addIntent = () => {
    const newIntent: Intent = {
      id: Date.now().toString(),
      name: 'New Intent',
      trainingPhrases: [],
      responseType: 'text',
      responseText: '',
      confidence: 0.85,
    };
    onIntentsChange([...intents, newIntent]);
    setSelectedIntent(newIntent.id);
  };

  const updateIntent = (id: string, updates: Partial<Intent>) => {
    onIntentsChange(intents.map((i) => (i.id === id ? { ...i, ...updates } : i)));
  };

  const deleteIntent = (id: string) => {
    onIntentsChange(intents.filter((i) => i.id !== id));
    if (selectedIntent === id) setSelectedIntent(null);
  };

  const addPhrase = (intentId: string) => {
    if (!newPhrase.trim()) return;
    const intent = intents.find((i) => i.id === intentId);
    if (intent) {
      updateIntent(intentId, { trainingPhrases: [...intent.trainingPhrases, newPhrase.trim()] });
      setNewPhrase('');
    }
  };

  const removePhrase = (intentId: string, phraseIdx: number) => {
    const intent = intents.find((i) => i.id === intentId);
    if (intent) {
      updateIntent(intentId, { trainingPhrases: intent.trainingPhrases.filter((_, i) => i !== phraseIdx) });
    }
  };

  const activeIntent = intents.find((i) => i.id === selectedIntent);

  return (
    <div className="flex h-[600px] gap-4">
      {/* Intent List */}
      <div className="w-72 shrink-0 rounded-xl border border-[#e5e0d5] bg-white">
        <div className="flex items-center justify-between border-b border-[#e5e0d5] p-3">
          <h3 className="text-sm font-medium text-[#1f1f1f]">Intents ({intents.length})</h3>
          <button onClick={addIntent} className="rounded-lg p-1.5 transition-colors hover:bg-[#fbf9f4]">
            <Plus size={16} style={{ color: '#c9a87c' }} />
          </button>
        </div>
        <div className="max-h-[540px] overflow-y-auto p-2">
          <AnimatePresence>
            {intents.map((intent) => (
              <motion.button
                key={intent.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                onClick={() => setSelectedIntent(intent.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selectedIntent === intent.id ? 'bg-[#c9a87c]/10 border border-[#c9a87c]/30' : 'hover:bg-[#fbf9f4] border border-transparent'
                }`}
              >
                <GripVertical size={14} className="text-[#8a8a8a] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#1f1f1f]">{intent.name}</p>
                  <p className="text-xs text-[#8a8a8a]">{intent.trainingPhrases.length} phrases</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteIntent(intent.id); }}
                  className="rounded p-1 opacity-0 transition-opacity hover:bg-red-50 group-hover:opacity-100"
                  style={{ opacity: selectedIntent === intent.id ? 1 : undefined }}
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Intent Editor */}
      <div className="flex-1 rounded-xl border border-[#e5e0d5] bg-white">
        {activeIntent ? (
          <div className="space-y-5 p-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#1f1f1f]">Intent Name</label>
              <input
                value={activeIntent.name}
                onChange={(e) => updateIntent(activeIntent.id, { name: e.target.value })}
                className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
              />
            </div>

            {/* Response Type */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#1f1f1f]">Response Type</label>
              <div className="flex gap-2">
                {RESPONSE_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.value}
                      onClick={() => updateIntent(activeIntent.id, { responseType: type.value })}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                        activeIntent.responseType === type.value
                          ? 'border-[#c9a87c] bg-[#c9a87c]/10 text-[#1f1f1f]'
                          : 'border-[#e5e0d5] text-[#595959] hover:bg-[#fbf9f4]'
                      }`}
                    >
                      <Icon size={16} />
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Response Content */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#1f1f1f]">
                {activeIntent.responseType === 'text' ? 'Response Text' : activeIntent.responseType === 'kb_article' ? 'KB Article ID' : 'Escalation Message'}
              </label>
              {activeIntent.responseType === 'text' || activeIntent.responseType === 'escalate' ? (
                <textarea
                  value={activeIntent.responseText}
                  onChange={(e) => updateIntent(activeIntent.id, { responseText: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                  placeholder={activeIntent.responseType === 'escalate' ? 'Message before escalating...' : 'Enter response text...'}
                />
              ) : (
                <input
                  value={activeIntent.kbArticleId || ''}
                  onChange={(e) => updateIntent(activeIntent.id, { kbArticleId: e.target.value })}
                  className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                  placeholder="Enter KB article ID..."
                />
              )}
            </div>

            {/* Confidence Threshold */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-[#1f1f1f]">Confidence Threshold</label>
                <span className="text-sm font-medium" style={{ color: '#c9a87c' }}>{Math.round(activeIntent.confidence * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.05}
                value={activeIntent.confidence}
                onChange={(e) => updateIntent(activeIntent.id, { confidence: parseFloat(e.target.value) })}
                className="w-full accent-[#c9a87c]"
              />
            </div>

            {/* Training Phrases */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#1f1f1f]">Training Phrases</label>
              <div className="mb-2 flex gap-2">
                <input
                  value={newPhrase}
                  onChange={(e) => setNewPhrase(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPhrase(activeIntent.id)}
                  placeholder="Add a training phrase..."
                  className="flex-1 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                />
                <button
                  onClick={() => addPhrase(activeIntent.id)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-[#1f1f1f] transition-colors hover:opacity-90"
                  style={{ backgroundColor: '#c9a87c' }}
                >
                  Add
                </button>
              </div>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] p-2">
                {activeIntent.trainingPhrases.map((phrase, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm">
                    <span className="text-[#1f1f1f]">{phrase}</span>
                    <button
                      onClick={() => removePhrase(activeIntent.id, idx)}
                      className="rounded p-1 transition-colors hover:bg-red-50"
                    >
                      <Trash2 size={12} className="text-red-400" />
                    </button>
                  </div>
                ))}
                {activeIntent.trainingPhrases.length === 0 && (
                  <p className="py-4 text-center text-xs text-[#8a8a8a]">No training phrases yet. Add some above.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[#8a8a8a]">Select an intent to edit or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}
