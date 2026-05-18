/**
 * TicketMergeModal — Merge two tickets
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GitMerge, Search, AlertTriangle } from 'lucide-react';
import { vedaQuery, toObjects } from '@/lib/vedadb-api';
import type { Ticket } from '@/hooks/useTickets';

interface TicketMergeModalProps {
  open: boolean;
  onClose: () => void;
  sourceTicket: Ticket;
  onMerge: (targetId: number, strategy: 'keep_source' | 'keep_target' | 'combine') => void;
}

export default function TicketMergeModal({
  open,
  onClose,
  sourceTicket,
  onMerge,
}: TicketMergeModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Ticket[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<'keep_source' | 'keep_target' | 'combine'>('combine');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setIsSearching(true);
    try {
      const sql = `SELECT id, title, status, priority, category, created_at, assigned_to, created_by FROM tickets WHERE id != ${sourceTicket.id} AND title ILIKE '%${searchTerm}%' LIMIT 10`;
      const res = await vedaQuery(sql);
      const rows = toObjects(res) as unknown as Ticket[];
      setSearchResults(rows);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleMerge = () => {
    if (!selectedTarget) return;
    onMerge(selectedTarget, strategy);
    setSearchTerm('');
    setSearchResults([]);
    setSelectedTarget(null);
    setStrategy('combine');
    onClose();
  };

  const selectedTicket = searchResults.find((t) => t.id === selectedTarget);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg bg-white border-[#e5e0d5]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#262626]">
            <GitMerge className="h-4 w-4 text-[#c9a87c]" />
            Merge Ticket
          </DialogTitle>
          <DialogDescription className="text-[#8a8a8a]">
            Merge ticket <strong>#{sourceTicket.id}</strong> — {sourceTicket.title} into another ticket.
          </DialogDescription>
        </DialogHeader>

        {/* Search target */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs text-[#595959]">Search Target Ticket</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Enter ticket title or ID..."
                  className="text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSearch}
                  disabled={isSearching}
                  className="border-[#e5e0d5] hover:bg-[#f5f3ef]"
                >
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Results */}
          {searchResults.length > 0 && (
            <div className="rounded-md border border-[#e5e0d5] divide-y divide-[#e5e0d5] max-h-40 overflow-y-auto">
              {searchResults.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTarget(t.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f5f3ef] transition-colors',
                    selectedTarget === t.id && 'bg-[#c9a87c]/10 ring-1 ring-[#c9a87c]'
                  )}
                >
                  <span className="text-xs font-mono text-[#c9a87c]">#{t.id}</span>
                  <span className="text-xs text-[#262626] truncate flex-1">{t.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f5f3ef] text-[#8a8a8a] capitalize">
                    {t.status}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Selected target preview */}
          {selectedTicket && (
            <div className="p-3 rounded-md bg-[#fbf9f4] border border-[#e5e0d5]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-[#c9a87c]">#{selectedTicket.id}</span>
                <span className="text-sm font-medium text-[#262626]">{selectedTicket.title}</span>
              </div>
              <div className="flex gap-2 text-[10px] text-[#8a8a8a]">
                <span className="capitalize">{selectedTicket.status}</span>
                <span>·</span>
                <span className="capitalize">{selectedTicket.priority}</span>
                <span>·</span>
                <span>{selectedTicket.category}</span>
              </div>
            </div>
          )}

          {/* Merge strategy */}
          {selectedTarget && (
            <div>
              <Label className="text-xs text-[#595959]">Merge Strategy</Label>
              <Select
                value={strategy}
                onValueChange={(v: typeof strategy) => setStrategy(v)}
              >
                <SelectTrigger className="mt-1 text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="combine">Combine (merge comments &amp; history)</SelectItem>
                  <SelectItem value="keep_source">Keep Source (this ticket as primary)</SelectItem>
                  <SelectItem value="keep_target">Keep Target (other ticket as primary)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-start gap-2 p-2 rounded bg-[#c9a87c]/5 border border-[#c9a87c]/20">
            <AlertTriangle className="h-3.5 w-3.5 text-[#c9a87c] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#595959]">
              Merging is irreversible. The source ticket will be closed and linked as a duplicate.
              All comments will be copied to the target ticket.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="border-[#e5e0d5]">
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-[#c9a87c] hover:bg-[#b8996a] text-white"
            disabled={!selectedTarget}
            onClick={handleMerge}
          >
            <GitMerge className="h-3.5 w-3.5 mr-1" />
            Merge Tickets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
