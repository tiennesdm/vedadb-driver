import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { Eye, EyeOff, UserPlus, Search, Ticket } from 'lucide-react';

interface WatcherEntry {
  id: number;
  ticket_id: number;
  user_id: number;
  created_at: string;
  ticket_title?: string;
  user_name?: string;
  user_avatar?: string;
  user_role?: string;
}

interface UserOption {
  id: number;
  name: string;
  role: string;
}

export default function TicketWatchers() {
  const [watchers, setWatchers] = useState<WatcherEntry[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [tickets, setTickets] = useState<{ id: number; title: string }[]>([]);
  const [search, setSearch] = useState('');
  const [selectedTicket, setSelectedTicket] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const fetchData = useCallback(async () => {
    try {
      const wRes = await vedaQuery(`SELECT w.*, t.title as ticket_title, u.name as user_name, u.role as user_role FROM ticket_watchers w LEFT JOIN tickets t ON w.ticket_id = t.id LEFT JOIN users u ON w.user_id = u.id ORDER BY w.created_at DESC`);
      setWatchers(toObjects(wRes) as unknown as WatcherEntry[]);
      const uRes = await vedaQuery(`SELECT id, name, role FROM users WHERE is_active = 1 ORDER BY name`);
      setUsers(toObjects(uRes) as unknown as UserOption[]);
      const tRes = await vedaQuery(`SELECT id, title FROM tickets WHERE status != 'closed' ORDER BY title`);
      setTickets(toObjects(tRes) as unknown as { id: number; title: string }[]);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = async () => {
    if (!selectedTicket || !selectedUser) return;
    try {
      await vedaExec(`INSERT INTO ticket_watchers (ticket_id, user_id, created_at) VALUES (${selectedTicket}, ${selectedUser}, datetime('now'))`);
      setSelectedTicket(''); setSelectedUser('');
      await fetchData();
    } catch (err: any) { alert('Error: ' + err.message); }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this watcher?')) return;
    await vedaExec(`DELETE FROM ticket_watchers WHERE id=${id}`);
    await fetchData();
  };

  const filtered = watchers.filter(w =>
    w.ticket_title?.toLowerCase().includes(search.toLowerCase()) ||
    w.user_name?.toLowerCase().includes(search.toLowerCase())
  );

  const groupedByTicket = filtered.reduce((acc, w) => {
    const key = w.ticket_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(w);
    return acc;
  }, {} as Record<number, WatcherEntry[]>);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1f1f1f] tracking-tight">Ticket Watchers</h1>
        <p className="text-sm text-[#595959] mt-1">Manage who watches which tickets</p>
      </div>

      {/* Add Watcher */}
      <Card className="p-4 mb-6 border-[#e5e0d5]">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Ticket</label>
            <Select value={selectedTicket} onValueChange={setSelectedTicket}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select ticket" /></SelectTrigger>
              <SelectContent>{tickets.map(t => <SelectItem key={t.id} value={String(t.id)}>#{t.id} {t.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-[#595959] uppercase tracking-wider">Watcher</label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select user" /></SelectTrigger>
              <SelectContent>{users.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.role})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} className="bg-[#c9a87c] hover:bg-[#b8976b] text-white gap-2">
            <UserPlus size={16} /> Add Watcher
          </Button>
        </div>
      </Card>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" size={18} />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search watchers..." className="pl-10 bg-white border-[#e5e0d5]" />
      </div>

      {/* Grouped by ticket */}
      {Object.keys(groupedByTicket).length === 0 ? (
        <Card className="p-12 text-center border-[#e5e0d5]">
          <Eye className="mx-auto mb-3 text-[#8a8a8a]" size={40} />
          <p className="text-[#595959]">No watchers configured</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByTicket).map(([ticketId, ws]) => (
            <Card key={ticketId} className="p-4 border-[#e5e0d5]">
              <div className="flex items-center gap-2 mb-3">
                <Ticket size={16} className="text-[#c9a87c]" />
                <span className="font-semibold text-sm text-[#1f1f1f]">#{ticketId} {ws[0]?.ticket_title}</span>
                <Badge variant="outline" className="text-xs">{ws.length} watcher{ws.length > 1 ? 's' : ''}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {ws.map(w => (
                  <div key={w.id} className="flex items-center gap-2 bg-[#f5f0e8] rounded-full pl-3 pr-2 py-1">
                    <Eye size={12} className="text-[#c9a87c]" />
                    <span className="text-xs text-[#1f1f1f]">{w.user_name}</span>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-[#8a8a8a] hover:text-red-500" onClick={() => handleRemove(w.id)}><EyeOff size={12} /></Button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
