import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { Link2, Unlink, GitBranch, ArrowRight, Search } from 'lucide-react';

interface TicketLink {
  id: number;
  source_id: number;
  target_id: number;
  link_type: string;
  created_at: string;
  source_title?: string;
  target_title?: string;
  source_status?: string;
  target_status?: string;
}

interface TicketOption {
  id: number;
  title: string;
  status: string;
}

const LINK_TYPES = [
  { value: 'parent_child', label: 'Parent → Child', color: 'bg-blue-50 text-blue-700' },
  { value: 'related_to', label: 'Related To', color: 'bg-gray-50 text-gray-700' },
  { value: 'duplicate_of', label: 'Duplicate Of', color: 'bg-orange-50 text-orange-700' },
  { value: 'blocks', label: 'Blocks', color: 'bg-red-50 text-red-700' },
  { value: 'blocked_by', label: 'Blocked By', color: 'bg-purple-50 text-purple-700' },
];

export default function TicketLinks() {
  const [links, setLinks] = useState<TicketLink[]>([]);
  const [tickets, setTickets] = useState<TicketOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [linkType, setLinkType] = useState('related_to');

  const fetchLinks = useCallback(async () => {
    try {
      const res = await vedaQuery(`SELECT tl.*, s.title as source_title, s.status as source_status, t.title as target_title, t.status as target_status FROM ticket_links tl LEFT JOIN tickets s ON tl.source_id = s.id LEFT JOIN tickets t ON tl.target_id = t.id ORDER BY tl.created_at DESC`);
      setLinks(toObjects(res) as unknown as TicketLink[]);
    } catch { setLinks([]); }
  }, []);

  const fetchTickets = useCallback(async () => {
    try {
      const res = await vedaQuery(`SELECT id, title, status FROM tickets WHERE status != 'closed' ORDER BY title`);
      setTickets(toObjects(res) as unknown as TicketOption[]);
    } catch { setTickets([]); }
  }, []);

  useEffect(() => { fetchLinks(); fetchTickets(); }, [fetchLinks, fetchTickets]);

  const handleCreate = async () => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    try {
      await vedaExec(`INSERT INTO ticket_links (source_id, target_id, link_type, created_at) VALUES (${sourceId}, ${targetId}, '${linkType}', datetime('now'))`);
      setModalOpen(false);
      setSourceId(''); setTargetId(''); setLinkType('related_to');
      await fetchLinks();
    } catch (err: any) { alert('Error: ' + err.message); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this link?')) return;
    await vedaExec(`DELETE FROM ticket_links WHERE id=${id}`);
    await fetchLinks();
  };

  const filtered = links.filter(l =>
    l.source_title?.toLowerCase().includes(search.toLowerCase()) ||
    l.target_title?.toLowerCase().includes(search.toLowerCase()) ||
    l.link_type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f1f1f] tracking-tight">Ticket Links</h1>
          <p className="text-sm text-[#595959] mt-1">Link tickets: parent/child, related, duplicate, blocks</p>
        </div>
        <Button onClick={() => { setModalOpen(true); fetchTickets(); }} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white gap-2">
          <Link2 size={16} /> Link Tickets
        </Button>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" size={18} />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search links..." className="pl-10 bg-white border-[#e5e0d5]" />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center border-[#e5e0d5]">
          <Link2 className="mx-auto mb-3 text-[#8a8a8a]" size={40} />
          <p className="text-[#595959]">No ticket links yet</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(l => {
            const typeInfo = LINK_TYPES.find(t => t.value === l.link_type) || LINK_TYPES[1];
            return (
              <Card key={l.id} className="p-4 border-[#e5e0d5] hover:border-[#c9a87c] transition-colors">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="text-xs font-mono bg-[#f5f0e8] text-[#1f1f1f]">#{l.source_id}</Badge>
                      <span className="text-sm text-[#1f1f1f] truncate max-w-[200px]">{l.source_title}</span>
                      <ArrowRight size={14} className="text-[#8a8a8a]" />
                      <Badge className="text-xs font-mono bg-[#f5f0e8] text-[#1f1f1f]">#{l.target_id}</Badge>
                      <span className="text-sm text-[#1f1f1f] truncate max-w-[200px]">{l.target_title}</span>
                    </div>
                  </div>
                  <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                  <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(l.id)}><Unlink size={14} /></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Simple relationship graph */}
      {filtered.length > 0 && (
        <Card className="mt-6 p-6 border-[#e5e0d5]">
          <h3 className="text-sm font-semibold text-[#1f1f1f] mb-4 flex items-center gap-2">
            <GitBranch size={16} className="text-[#c9a87c]" /> Relationship Graph
          </h3>
          <div className="flex flex-wrap gap-4 justify-center">
            {Array.from(new Set(filtered.flatMap(l => [l.source_id, l.target_id]))).map(id => {
              const ticketLinks = filtered.filter(l => l.source_id === id || l.target_id === id);
              return (
                <div key={id} className="relative">
                  <div className="bg-[#f5f0e8] border border-[#e5e0d5] rounded-lg px-4 py-2 text-center min-w-[120px]">
                    <span className="text-xs font-mono text-[#8a8a8a]">#{id}</span>
                    <p className="text-xs text-[#1f1f1f] truncate max-w-[150px]">
                      {filtered.find(l => l.source_id === id)?.source_title || filtered.find(l => l.target_id === id)?.target_title}
                    </p>
                    <span className="text-[10px] text-[#c9a87c]">{ticketLinks.length} link{ticketLinks.length > 1 ? 's' : ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Link Tickets</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Source Ticket</label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select source ticket" /></SelectTrigger>
                <SelectContent>{tickets.map(t => <SelectItem key={t.id} value={String(t.id)}>#{t.id} - {t.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Link Type</label>
              <Select value={linkType} onValueChange={setLinkType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{LINK_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Target Ticket</label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select target ticket" /></SelectTrigger>
                <SelectContent>{tickets.map(t => <SelectItem key={t.id} value={String(t.id)}>#{t.id} - {t.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)} className="border-[#e5e0d5]">Cancel</Button>
              <Button onClick={handleCreate} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white">Create Link</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
