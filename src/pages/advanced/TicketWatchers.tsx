/**
 * TicketWatchers — Watchers per ticket: add/remove watchers, avatar display
 */
import { useState, useEffect, useCallback } from 'react';
import { vedaQuery, vedaExec, toObjects } from '@/lib/vedadb-api';
import { usePermission } from '@/hooks/useRBAC';
import { Permission } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Eye, EyeOff, Plus, Trash2, Search, X, Bell, BellOff, UserPlus } from 'lucide-react';

interface WatcherRow {
  id: number;
  ticket_id: number;
  user_id: number;
  notify_on_update: number;
  created_at: string;
  ticket_title?: string;
  user_name?: string;
  user_email?: string;
  user_avatar?: string;
  user_role?: string;
}

interface UserOption {
  id: number;
  name: string;
  email: string;
  avatar?: string;
  role: string;
}

interface TicketOption {
  id: number;
  title: string;
}

export default function TicketWatchers() {
  const canManage = usePermission(Permission.TICKET_EDIT_ALL);
  const [watchers, setWatchers] = useState<WatcherRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [tickets, setTickets] = useState<TicketOption[]>([]);
  const [search, setSearch] = useState('');
  const [ticketSearch, setTicketSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [notify, setNotify] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [filteredUsers, setFilteredUsers] = useState<UserOption[]>([]);
  const [filteredTickets, setFilteredTickets] = useState<TicketOption[]>([]);

  const fetchWatchers = useCallback(async () => {
    setIsLoading(true);
    try {
      const sql = `
        SELECT tw.*, t.title as ticket_title, u.name as user_name, u.email as user_email, u.avatar as user_avatar, u.role as user_role
        FROM ticket_watchers tw
        LEFT JOIN tickets t ON t.id = tw.ticket_id
        LEFT JOIN users u ON u.id = tw.user_id
        ORDER BY tw.created_at DESC
      `;
      const res = await vedaQuery(sql);
      setWatchers(toObjects(res) as unknown as WatcherRow[]);
    } catch {
      setWatchers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await vedaQuery(`SELECT id, name, email, avatar, role FROM users WHERE is_active=1 ORDER BY name`);
      setUsers(toObjects(res) as unknown as UserOption[]);
    } catch {
      setUsers([]);
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    try {
      const res = await vedaQuery(`SELECT id, title FROM tickets ORDER BY updated_at DESC LIMIT 200`);
      setTickets(toObjects(res) as unknown as TicketOption[]);
    } catch {
      setTickets([]);
    }
  }, []);

  useEffect(() => {
    fetchWatchers();
    fetchUsers();
    fetchTickets();
  }, [fetchWatchers, fetchUsers, fetchTickets]);

  const handleSearchUser = (term: string) => {
    setUserSearch(term);
    if (!term.trim()) { setFilteredUsers([]); return; }
    const filtered = users.filter((u) =>
      u.name.toLowerCase().includes(term.toLowerCase()) ||
      u.email.toLowerCase().includes(term.toLowerCase())
    );
    setFilteredUsers(filtered.slice(0, 6));
  };

  const handleSearchTicket = (term: string) => {
    setTicketSearch(term);
    if (!term.trim()) { setFilteredTickets([]); return; }
    const idNum = parseInt(term, 10);
    const filtered = tickets.filter(
      (t) => t.title.toLowerCase().includes(term.toLowerCase()) || (!isNaN(idNum) && t.id === idNum)
    );
    setFilteredTickets(filtered.slice(0, 6));
  };

  const handleAdd = async () => {
    const tId = parseInt(selectedTicketId || ticketSearch, 10);
    const uId = parseInt(selectedUserId || userSearch, 10);
    if (isNaN(tId) || isNaN(uId)) return;
    try {
      await vedaExec(
        `INSERT INTO ticket_watchers (ticket_id, user_id, notify_on_update, created_at) VALUES (${tId}, ${uId}, ${notify ? 1 : 0}, datetime('now'))`
      );
      setTicketSearch('');
      setUserSearch('');
      setSelectedTicketId('');
      setSelectedUserId('');
      setFilteredTickets([]);
      setFilteredUsers([]);
      fetchWatchers();
    } catch {
      // silent
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await vedaExec(`DELETE FROM ticket_watchers WHERE id=${id}`);
      fetchWatchers();
    } catch {
      // silent
    }
  };

  const toggleNotify = async (row: WatcherRow) => {
    try {
      const newVal = row.notify_on_update ? 0 : 1;
      await vedaExec(`UPDATE ticket_watchers SET notify_on_update=${newVal} WHERE id=${row.id}`);
      fetchWatchers();
    } catch {
      // silent
    }
  };

  const filtered = watchers.filter(
    (w) =>
      !search ||
      w.user_name?.toLowerCase().includes(search.toLowerCase()) ||
      w.ticket_title?.toLowerCase().includes(search.toLowerCase()) ||
      w.ticket_id.toString() === search
  );

  return (
    <div className="space-y-4 p-6 bg-[#fbf9f4] min-h-screen">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#262626]">Ticket Watchers</h1>
          <p className="text-xs text-[#8a8a8a] mt-0.5">Manage watchers and notifications per ticket</p>
        </div>
      </div>

      {/* Add watcher */}
      {canManage && (
        <div className="rounded-lg border border-[#e5e0d5] bg-white p-4">
          <h3 className="text-sm font-medium text-[#262626] mb-3 flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5 text-[#c9a87c]" />
            Add Watcher
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <label className="text-xs text-[#595959]">Ticket</label>
              <Input
                value={ticketSearch}
                onChange={(e) => handleSearchTicket(e.target.value)}
                placeholder="Search ticket..."
                className="mt-1 text-xs h-8 border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c]"
              />
              {filteredTickets.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-[#e5e0d5] bg-white shadow-lg max-h-32 overflow-y-auto">
                  {filteredTickets.map((t) => (
                    <button
                      key={t.id}
                      className="w-full px-2 py-1.5 text-left text-xs hover:bg-[#f5f3ef] flex items-center gap-2"
                      onClick={() => { setTicketSearch(t.id.toString()); setSelectedTicketId(t.id.toString()); setFilteredTickets([]); }}
                    >
                      <span className="text-[#c9a87c] font-mono text-[10px]">#{t.id}</span>
                      <span className="truncate text-[#262626]">{t.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="text-xs text-[#595959]">User</label>
              <Input
                value={userSearch}
                onChange={(e) => handleSearchUser(e.target.value)}
                placeholder="Search user..."
                className="mt-1 text-xs h-8 border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c]"
              />
              {filteredUsers.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-[#e5e0d5] bg-white shadow-lg max-h-32 overflow-y-auto">
                  {filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      className="w-full px-2 py-1.5 text-left text-xs hover:bg-[#f5f3ef] flex items-center gap-2"
                      onClick={() => { setUserSearch(u.id.toString()); setSelectedUserId(u.id.toString()); setFilteredUsers([]); }}
                    >
                      <div className="h-4 w-4 rounded-full bg-[#c9a87c] flex items-center justify-center text-white text-[7px] font-medium">
                        {u.avatar ? <img src={u.avatar} className="h-full w-full rounded-full object-cover" alt="" /> : u.name[0]}
                      </div>
                      <span className="text-[#262626]">{u.name}</span>
                      <span className="text-[#8a8a8a]">{u.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Button
                variant={notify ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-8 text-xs',
                  notify && 'bg-[#c9a87c] hover:bg-[#b8996a] text-white'
                )}
                onClick={() => setNotify((p) => !p)}
              >
                {notify ? <Bell className="h-3 w-3 mr-1" /> : <BellOff className="h-3 w-3 mr-1" />}
                {notify ? 'Notify' : 'Silent'}
              </Button>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleAdd}
                disabled={!ticketSearch || !userSearch}
                className="bg-[#c9a87c] hover:bg-[#b8996a] text-white text-xs h-8"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Watcher
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8a8a]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ticket or user..."
          className="pl-8 text-sm h-8 border-[#e5e0d5] bg-white focus:border-[#c9a87c] focus:ring-[#c9a87c]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <X className="h-3 w-3 text-[#8a8a8a]" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[#e5e0d5] bg-white overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#e5e0d5] border-t-[#c9a87c]" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fbf9f4] hover:bg-[#fbf9f4]">
                <TableHead className="text-xs font-medium text-[#595959]">Ticket</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Watcher</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Role</TableHead>
                <TableHead className="text-xs font-medium text-[#595959]">Notifications</TableHead>
                <TableHead className="text-xs font-medium text-[#595959] w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((w) => (
                <TableRow key={w.id} className="hover:bg-[#fbf9f4]">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-[#c9a87c]">#{w.ticket_id}</span>
                      <span className="text-xs text-[#262626] truncate max-w-[160px]">{w.ticket_title}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-[#c9a87c] flex items-center justify-center text-white text-[10px] font-medium">
                        {w.user_avatar ? (
                          <img src={w.user_avatar} alt={w.user_name} className="h-full w-full rounded-full object-cover" />
                        ) : (
                          w.user_name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[#262626]">{w.user_name}</p>
                        <p className="text-[10px] text-[#8a8a8a]">{w.user_email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs capitalize text-[#595959]">{w.user_role}</span>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggleNotify(w)}
                      className={cn(
                        'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors',
                        w.notify_on_update ? 'bg-[#c9a87c]/10 text-[#c9a87c]' : 'bg-gray-50 text-[#8a8a8a]'
                      )}
                    >
                      {w.notify_on_update ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      {w.notify_on_update ? 'On' : 'Off'}
                    </button>
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-[#8a8a8a] hover:text-red-500"
                        onClick={() => handleRemove(w.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-sm text-[#8a8a8a]">
                    No watchers found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
