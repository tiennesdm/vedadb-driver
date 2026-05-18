/**
 * TicketLinks — Link tickets: parent_child, related_to, duplicate_of, blocks, blocked_by
 */
import { useState, useEffect, useCallback } from 'react';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { usePermission } from '@/hooks/useRBAC';
import { Permission } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Link2,
  Plus,
  Trash2,
  Search,
  X,
  GitBranch,
  Layers,
  Copy,
  Lock,
  AlertCircle,
  ArrowRightLeft,
} from 'lucide-react';
import TicketRelationshipGraph from '@/components/advanced/TicketRelationshipGraph';
import type { TicketLink as TicketLinkType, LinkType, TicketNode } from '@/components/advanced/TicketRelationshipGraph';

export { type TicketLinkType, type LinkType };

const LINK_TYPES: { value: LinkType; label: string; icon: typeof Link2 }[] = [
  { value: 'parent_child', label: 'Parent / Child', icon: GitBranch },
  { value: 'related_to', label: 'Related To', icon: Layers },
  { value: 'duplicate_of', label: 'Duplicate Of', icon: Copy },
  { value: 'blocks', label: 'Blocks', icon: Lock },
  { value: 'blocked_by', label: 'Blocked By', icon: AlertCircle },
];

interface TicketOption {
  id: number;
  title: string;
  status: string;
  priority: string;
}

interface LinkRow {
  id: number;
  source_id: number;
  target_id: number;
  link_type: LinkType;
  created_by: number | null;
  created_at: string;
  source_title?: string;
  target_title?: string;
}

export default function TicketLinks() {
  const canManage = usePermission(Permission.TICKET_EDIT_ALL);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [tickets, setTickets] = useState<TicketOption[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [linkType, setLinkType] = useState<LinkType>('related_to');
  const [search, setSearch] = useState('');
  const [filteredSource, setFilteredSource] = useState<TicketOption[]>([]);
  const [filteredTarget, setFilteredTarget] = useState<TicketOption[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showGraph, setShowGraph] = useState(true);

  const fetchLinks = useCallback(async () => {
    setIsLoading(true);
    try {
      const sql = `
        SELECT tl.*, s.title as source_title, t.title as target_title
        FROM ticket_links tl
        LEFT JOIN tickets s ON s.id = tl.source_id
        LEFT JOIN tickets t ON t.id = tl.target_id
        ORDER BY tl.created_at DESC
      `;
      const res = await vedaQuery(sql);
      setLinks(toObjects(res) as unknown as LinkRow[]);
    } catch {
      setLinks([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    try {
      const sql = `SELECT id, title, status, priority FROM tickets ORDER BY updated_at DESC LIMIT 200`;
      const res = await vedaQuery(sql);
      setTickets(toObjects(res) as unknown as TicketOption[]);
    } catch {
      setTickets([]);
    }
  }, []);

  useEffect(() => {
    fetchLinks();
    fetchTickets();
  }, [fetchLinks, fetchTickets]);

  const handleSearchSource = (term: string) => {
    setSourceId(term);
    if (!term.trim()) {
      setFilteredSource([]);
      return;
    }
    const idNum = parseInt(term, 10);
    const filtered = tickets.filter(
      (t) =>
        t.title.toLowerCase().includes(term.toLowerCase()) ||
        (!isNaN(idNum) && t.id === idNum)
    );
    setFilteredSource(filtered.slice(0, 8));
  };

  const handleSearchTarget = (term: string) => {
    setTargetId(term);
    if (!term.trim()) {
      setFilteredTarget([]);
      return;
    }
    const idNum = parseInt(term, 10);
    const filtered = tickets.filter(
      (t) =>
        t.title.toLowerCase().includes(term.toLowerCase()) ||
        (!isNaN(idNum) && t.id === idNum)
    );
    setFilteredTarget(filtered.slice(0, 8));
  };

  const handleCreate = async () => {
    const sId = parseInt(sourceId, 10);
    const tId = parseInt(targetId, 10);
    if (isNaN(sId) || isNaN(tId) || sId === tId) return;
    try {
      await vedaExec(
        `INSERT INTO ticket_links (source_id, target_id, link_type, created_at) VALUES (${sId}, ${tId}, '${linkType}', datetime('now'))`
      );
      setSourceId('');
      setTargetId('');
      setFilteredSource([]);
      setFilteredTarget([]);
      fetchLinks();
    } catch {
      // silent
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await vedaExec(`DELETE FROM ticket_links WHERE id=${id}`);
      fetchLinks();
    } catch {
      // silent
    }
  };

  const filteredLinks = links.filter(
    (l) =>
      !search ||
      l.source_title?.toLowerCase().includes(search.toLowerCase()) ||
      l.target_title?.toLowerCase().includes(search.toLowerCase()) ||
      l.source_id.toString() === search ||
      l.target_id.toString() === search
  );

  const getTicketNode = useCallback(
    (id: number): TicketNode | undefined => {
      const t = tickets.find((tk) => tk.id === id);
      if (!t) return undefined;
      return { id: t.id, title: t.title, status: t.status, priority: t.priority };
    },
    [tickets]
  );

  const graphLinks: TicketLinkType[] = (selectedTicketId
    ? links.filter((l) => l.source_id === selectedTicketId || l.target_id === selectedTicketId)
    : links
  ).map((l) => ({
    id: l.id,
    source_id: l.source_id,
    target_id: l.target_id,
    link_type: l.link_type,
    source: getTicketNode(l.source_id),
    target: getTicketNode(l.target_id),
  }));

  const rootTicket = selectedTicketId
    ? getTicketNode(selectedTicketId) ?? { id: selectedTicketId, title: `Ticket #${selectedTicketId}`, status: 'unknown', priority: 'medium' }
    : getTicketNode(links[0]?.source_id) ?? { id: 0, title: 'No ticket selected', status: 'unknown', priority: 'medium' };

  return (
    <div className="space-y-4 p-6 bg-[#fbf9f4] min-h-screen">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#262626]">Linked Tickets</h1>
          <p className="text-xs text-[#8a8a8a] mt-0.5">Create and manage relationships between tickets</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-[#e5e0d5] text-xs h-8"
          onClick={() => setShowGraph((p) => !p)}
        >
          <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
          {showGraph ? 'Hide' : 'Show'} Graph
        </Button>
      </div>

      {/* Create link */}
      {canManage && (
        <div className="rounded-lg border border-[#e5e0d5] bg-white p-4">
          <h3 className="text-sm font-medium text-[#262626] mb-3 flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5 text-[#c9a87c]" />
            New Link
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Label className="text-xs text-[#595959]">Source Ticket</Label>
              <div className="flex gap-1 mt-1">
                <Input
                  value={sourceId}
                  onChange={(e) => handleSearchSource(e.target.value)}
                  placeholder="ID or search..."
                  className="text-xs h-8 border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c]"
                />
              </div>
              {filteredSource.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-[#e5e0d5] bg-white shadow-lg max-h-32 overflow-y-auto">
                  {filteredSource.map((t) => (
                    <button
                      key={t.id}
                      className="w-full px-2 py-1.5 text-left text-xs hover:bg-[#f5f3ef] flex items-center gap-2"
                      onClick={() => { setSourceId(t.id.toString()); setFilteredSource([]); }}
                    >
                      <span className="text-[#c9a87c] font-mono text-[10px]">#{t.id}</span>
                      <span className="truncate text-[#262626]">{t.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <Label className="text-xs text-[#595959]">Target Ticket</Label>
              <div className="flex gap-1 mt-1">
                <Input
                  value={targetId}
                  onChange={(e) => handleSearchTarget(e.target.value)}
                  placeholder="ID or search..."
                  className="text-xs h-8 border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c]"
                />
              </div>
              {filteredTarget.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-[#e5e0d5] bg-white shadow-lg max-h-32 overflow-y-auto">
                  {filteredTarget.map((t) => (
                    <button
                      key={t.id}
                      className="w-full px-2 py-1.5 text-left text-xs hover:bg-[#f5f3ef] flex items-center gap-2"
                      onClick={() => { setTargetId(t.id.toString()); setFilteredTarget([]); }}
                    >
                      <span className="text-[#c9a87c] font-mono text-[10px]">#{t.id}</span>
                      <span className="truncate text-[#262626]">{t.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Link Type</Label>
              <Select value={linkType} onValueChange={(v: LinkType) => setLinkType(v)}>
                <SelectTrigger className="mt-1 text-xs h-8 border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_TYPES.map((lt) => (
                    <SelectItem key={lt.value} value={lt.value}>
                      <div className="flex items-center gap-1.5">
                        <lt.icon className="h-3 w-3" />
                        {lt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleCreate}
                disabled={!sourceId || !targetId}
                className="bg-[#c9a87c] hover:bg-[#b8996a] text-white text-xs h-8"
              >
                <Link2 className="h-3.5 w-3.5 mr-1" />
                Link
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2 items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8a8a]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search links..."
            className="pl-8 text-sm h-8 border-[#e5e0d5] bg-white focus:border-[#c9a87c] focus:ring-[#c9a87c]"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-[#8a8a8a]" />
            </button>
          )}
        </div>
        {selectedTicketId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-[#8a8a8a]"
            onClick={() => setSelectedTicketId(null)}
          >
            Clear filter
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Table */}
        <div className={cn('lg:col-span-2 rounded-lg border border-[#e5e0d5] bg-white overflow-hidden')}> 
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#e5e0d5] border-t-[#c9a87c]" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-[#fbf9f4] hover:bg-[#fbf9f4]">
                  <TableHead className="text-xs font-medium text-[#595959]">Source</TableHead>
                  <TableHead className="text-xs font-medium text-[#595959]">Link</TableHead>
                  <TableHead className="text-xs font-medium text-[#595959]">Target</TableHead>
                  <TableHead className="text-xs font-medium text-[#595959] w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLinks.map((l) => {
                  const lt = LINK_TYPES.find((x) => x.value === l.link_type);
                  const Icon = lt?.icon ?? Link2;
                  return (
                    <TableRow
                      key={l.id}
                      className={cn(
                        'hover:bg-[#fbf9f4] cursor-pointer',
                        selectedTicketId === l.source_id || selectedTicketId === l.target_id ? 'bg-[#c9a87c]/5' : ''
                      )}
                      onClick={() => setSelectedTicketId(l.source_id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono text-[#c9a87c]">#{l.source_id}</span>
                          <span className="text-xs text-[#262626] truncate max-w-[120px]">{l.source_title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full',
                          l.link_type === 'parent_child' && 'bg-[#c9a87c]/10 text-[#c9a87c]',
                          l.link_type === 'related_to' && 'bg-blue-50 text-blue-600',
                          l.link_type === 'duplicate_of' && 'bg-gray-50 text-gray-600',
                          l.link_type === 'blocks' && 'bg-red-50 text-red-600',
                          l.link_type === 'blocked_by' && 'bg-orange-50 text-orange-600',
                        )}>
                          <Icon className="h-2.5 w-2.5" />
                          {lt?.label ?? l.link_type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono text-[#c9a87c]">#{l.target_id}</span>
                          <span className="text-xs text-[#262626] truncate max-w-[120px]">{l.target_title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-[#8a8a8a] hover:text-red-500"
                            onClick={(e) => { e.stopPropagation(); handleDelete(l.id); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredLinks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-sm text-[#8a8a8a]">
                      No links found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Graph */}
        {showGraph && (
          <div className="lg:col-span-1">
            {selectedTicketId && (
              <div className="mb-2 text-xs text-[#595959]">
                Showing links for ticket #{selectedTicketId}
                <button onClick={() => setSelectedTicketId(null)} className="ml-2 text-[#c9a87c] underline">
                  clear
                </button>
              </div>
            )}
            <TicketRelationshipGraph
              rootTicket={rootTicket}
              links={graphLinks}
              onTicketClick={(id) => setSelectedTicketId(id)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
