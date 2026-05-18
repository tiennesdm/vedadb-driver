/**
 * Global Command Palette (Cmd/Ctrl+K) — Search across tickets, users, articles
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { Search, Ticket, User, BookOpen, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import useAppStore from '@/lib/vedadb-store';

interface SearchResult {
  type: 'ticket' | 'user' | 'article';
  id: number;
  title: string;
  subtitle: string;
}

export default function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const select = useAppStore((s) => s.select);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setSelectedIdx(0);
    }
  }, [open]);

  // Search
  const performSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      const lower = q.toLowerCase();
      const all: SearchResult[] = [];

      try {
        const tickets = await select('tickets', { limit: 5 });
        tickets.toObjects().forEach((t: Record<string, unknown>) => {
          if (
            String(t.title).toLowerCase().includes(lower) ||
            String(t.id).includes(lower)
          ) {
            all.push({
              type: 'ticket',
              id: t.id as number,
              title: `Ticket #${t.id}: ${t.title}`,
              subtitle: `${t.status} · ${t.priority} · ${t.category}`,
            });
          }
        });

        const users = await select('users', { limit: 5 });
        users.toObjects().forEach((u: Record<string, unknown>) => {
          if (
            String(u.name).toLowerCase().includes(lower) ||
            String(u.email).toLowerCase().includes(lower)
          ) {
            all.push({
              type: 'user',
              id: u.id as number,
              title: u.name as string,
              subtitle: `${u.email} · ${u.department}`,
            });
          }
        });

        const articles = await select('knowledge_articles', { limit: 5 });
        articles.toObjects().forEach((a: Record<string, unknown>) => {
          if (String(a.title).toLowerCase().includes(lower)) {
            all.push({
              type: 'article',
              id: a.id as number,
              title: a.title as string,
              subtitle: `${a.category} · ${a.views} views`,
            });
          }
        });
      } catch { /* ignore */ }

      setResults(all.slice(0, 10));
      setSelectedIdx(0);
    },
    [select]
  );

  useEffect(() => {
    const timer = setTimeout(() => performSearch(query), 150);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault();
      goToResult(results[selectedIdx]);
    }
  };

  const goToResult = (r: SearchResult) => {
    setOpen(false);
    if (r.type === 'ticket') navigate(`/tickets/${r.id}`);
    else if (r.type === 'user') navigate('/users');
    else if (r.type === 'article') navigate(`/knowledge/${r.id}`);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-[4px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[90vw] max-w-xl overflow-hidden rounded-xl border border-[#e5e0d5] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[#e5e0d5] px-4 py-3">
          <Search size={18} className="text-[#8a8a8a]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tickets, users, articles..."
            className="flex-1 bg-transparent text-sm text-[#1f1f1f] outline-none placeholder:text-[#8a8a8a]"
          />
          <kbd className="hidden rounded bg-[#f5f0e8] px-1.5 py-0.5 text-[10px] font-mono text-[#8a8a8a] md:inline">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 && query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-[#8a8a8a]">
              No results found for &quot;{query}&quot;
            </div>
          )}
          {results.length === 0 && !query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-[#8a8a8a]">
              Type to search across tickets, users, and knowledge articles
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => goToResult(r)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                i === selectedIdx ? 'bg-[#f5f0e8]' : 'hover:bg-[#fbf9f4]'
              )}
            >
              {r.type === 'ticket' && <Ticket size={16} className="shrink-0 text-[#c9a87c]" />}
              {r.type === 'user' && <User size={16} className="shrink-0 text-[#1890ff]" />}
              {r.type === 'article' && <BookOpen size={16} className="shrink-0 text-[#52c41a]" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[#1f1f1f]">{r.title}</p>
                <p className="truncate text-xs text-[#8a8a8a]">{r.subtitle}</p>
              </div>
              <ArrowRight size={14} className="shrink-0 text-[#8a8a8a]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
