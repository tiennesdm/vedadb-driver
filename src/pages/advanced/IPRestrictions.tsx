/**
 * IPRestrictions - Route: /ip-restrictions
 * IP allowlist/blocklist management with CIDR support and per-user tracking.
 */
import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Globe, Plus, Trash2, Shield, ShieldAlert, MapPin,
  Network, CheckCircle,
} from 'lucide-react';

interface IPEntry {
  id: string;
  ip: string;
  type: 'allow' | 'block';
  note: string;
  created: string;
  hitCount: number;
}

interface UserIPRecord {
  id: number;
  name: string;
  email: string;
  role: string;
  lastIp: string;
  lastAccess: string;
  location: string;
}

const IP_STORAGE_KEY = 'veda_ip_restrictions';
const USER_IP_KEY = 'veda_user_ips';

function isValidIP(ip: string): boolean {
  // IPv4 or CIDR
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
  if (!ipv4Regex.test(ip)) return false;
  const parts = ip.split('/')[0].split('.');
  return parts.every((p) => parseInt(p, 10) >= 0 && parseInt(p, 10) <= 255);
}

function loadIPEntries(): IPEntry[] {
  try {
    const raw = localStorage.getItem(IP_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return [
    { id: 'ip-1', ip: '192.168.1.0/24', type: 'allow', note: 'Office network', created: '2025-01-01', hitCount: 1240 },
    { id: 'ip-2', ip: '10.0.0.0/8', type: 'allow', note: 'VPN range', created: '2025-01-02', hitCount: 856 },
    { id: 'ip-3', ip: '172.16.0.50', type: 'block', note: 'Suspicious activity', created: '2025-01-05', hitCount: 0 },
  ];
}

function saveIPEntries(entries: IPEntry[]) {
  try { localStorage.setItem(IP_STORAGE_KEY, JSON.stringify(entries)); } catch { /* */ }
}

function loadUserIPs(): UserIPRecord[] {
  try {
    const raw = localStorage.getItem(USER_IP_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return [
    { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'admin', lastIp: '192.168.1.45', lastAccess: '2025-01-15T10:30:00Z', location: 'New York, US' },
    { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'manager', lastIp: '192.168.1.62', lastAccess: '2025-01-15T09:15:00Z', location: 'New York, US' },
    { id: 3, name: 'Carol White', email: 'carol@example.com', role: 'agent', lastIp: '10.0.2.105', lastAccess: '2025-01-14T18:45:00Z', location: 'London, UK' },
    { id: 4, name: 'David Lee', email: 'david@example.com', role: 'agent', lastIp: '192.168.1.88', lastAccess: '2025-01-15T08:00:00Z', location: 'New York, US' },
    { id: 5, name: 'Eva Martinez', email: 'eva@example.com', role: 'customer', lastIp: '203.0.113.12', lastAccess: '2025-01-10T14:20:00Z', location: 'São Paulo, BR' },
  ];
}

export default function IPRestrictions() {
  const [entries, setEntries] = useState<IPEntry[]>(loadIPEntries);
  const [userIPs] = useState<UserIPRecord[]>(loadUserIPs);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'allowlist' | 'blocklist'>('allowlist');
  const [newIP, setNewIP] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newType, setNewType] = useState<'allow' | 'block'>('allow');
  const [error, setError] = useState('');

  const allowCount = useMemo(() => entries.filter((e) => e.type === 'allow').length, [entries]);
  const blockCount = useMemo(() => entries.filter((e) => e.type === 'block').length, [entries]);

  const handleAdd = useCallback(() => {
    if (!isValidIP(newIP)) {
      setError('Invalid IPv4 address or CIDR range');
      return;
    }
    setError('');
    const entry: IPEntry = {
      id: `ip-${Date.now()}`,
      ip: newIP,
      type: newType,
      note: newNote,
      created: new Date().toISOString().split('T')[0],
      hitCount: 0,
    };
    setEntries((prev) => { const next = [...prev, entry]; saveIPEntries(next); return next; });
    setNewIP('');
    setNewNote('');
  }, [newIP, newNote, newType]);

  const handleDelete = useCallback((id: string) => {
    setEntries((prev) => { const next = prev.filter((e) => e.id !== id); saveIPEntries(next); return next; });
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#1a1a1a]">
            <Shield className="h-5 w-5 text-[#c9a87c]" />
            IP Restrictions
          </h1>
          <p className="mt-0.5 text-sm text-[#8a8a8a]">
            Control access by IP address with allowlists and blocklists
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8a8a8a]">IP Restrictions</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} className="data-[state=checked]:bg-[#c9a87c]" />
        </div>
      </div>

      {/* Mode selector */}
      {enabled && (
        <div className="flex items-center gap-4 rounded-lg border border-[#e5e0d5] bg-white p-3">
          <span className="text-xs font-medium text-[#595959]">Restriction Mode:</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('allowlist')}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                mode === 'allowlist' ? 'bg-[#c9a87c] text-white' : 'bg-[#fbf9f4] text-[#595959] hover:bg-[#e5e0d5]'
              )}
            >
              <CheckCircle className="mr-1 inline h-3 w-3" />
              Allowlist ({allowCount})
            </button>
            <button
              type="button"
              onClick={() => setMode('blocklist')}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                mode === 'blocklist' ? 'bg-red-600 text-white' : 'bg-[#fbf9f4] text-[#595959] hover:bg-[#e5e0d5]'
              )}
            >
              <ShieldAlert className="mr-1 inline h-3 w-3" />
              Blocklist ({blockCount})
            </button>
          </div>
        </div>
      )}

      <Tabs defaultValue="manage" className="w-full">
        <TabsList className="bg-[#fbf9f4] border border-[#e5e0d5]">
          <TabsTrigger value="manage" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Network className="mr-1 h-3 w-3" />
            Manage IPs
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Globe className="mr-1 h-3 w-3" />
            User Access Log
          </TabsTrigger>
          <TabsTrigger value="geo" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <MapPin className="mr-1 h-3 w-3" />
            Geographic
          </TabsTrigger>
        </TabsList>

        {/* Manage IPs */}
        <TabsContent value="manage" className="mt-4 space-y-4">
          {/* Add form */}
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-[#1a1a1a]">Add IP or Range</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-xs text-[#595959]">IP Address / CIDR</Label>
                  <Input
                    value={newIP}
                    onChange={(e) => { setNewIP(e.target.value); setError(''); }}
                    placeholder="192.168.1.0/24"
                    className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                  />
                </div>
                <div className="w-48">
                  <Label className="text-xs text-[#595959]">Note</Label>
                  <Input
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Office network"
                    className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-[#595959]">Type</Label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setNewType('allow')}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs',
                        newType === 'allow' ? 'bg-green-50 text-green-600 border border-green-200' : 'border border-[#e5e0d5] text-[#595959]'
                      )}
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewType('block')}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs',
                        newType === 'block' ? 'bg-red-50 text-red-600 border border-red-200' : 'border border-[#e5e0d5] text-[#595959]'
                      )}
                    >
                      Block
                    </button>
                  </div>
                </div>
                <Button onClick={handleAdd} className="bg-[#c9a87c] hover:bg-[#b8996c] text-white" size="sm">
                  <Plus className="mr-1 h-3 w-3" />
                  Add
                </Button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <p className="text-[10px] text-[#8a8a8a]">Supports single IPv4 addresses (e.g., 192.168.1.1) and CIDR ranges (e.g., 192.168.1.0/24)</p>
            </CardContent>
          </Card>

          {/* IP list */}
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-[#1a1a1a]">
                {mode === 'allowlist' ? 'Allowed IPs' : 'Blocked IPs'} ({entries.filter((e) => (mode === 'allowlist' ? e.type === 'allow' : e.type === 'block')).length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {entries
                  .filter((e) => (mode === 'allowlist' ? e.type === 'allow' : e.type === 'block'))
                  .map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        {entry.type === 'allow' ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <ShieldAlert className="h-4 w-4 text-red-600" />
                        )}
                        <div>
                          <code className="text-sm font-medium text-[#1a1a1a]">{entry.ip}</code>
                          {entry.note && <span className="ml-2 text-xs text-[#8a8a8a]">{entry.note}</span>}
                        </div>
                        <Badge variant="secondary" className="text-[10px]">
                          {entry.hitCount} hits
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-[#8a8a8a] hover:text-red-600"
                        onClick={() => handleDelete(entry.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                {entries.filter((e) => (mode === 'allowlist' ? e.type === 'allow' : e.type === 'block')).length === 0 && (
                  <p className="text-center text-xs text-[#8a8a8a] py-4">No entries</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* User Access Log */}
        <TabsContent value="users" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-[#1a1a1a]">Last Accessed IP Per User</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#e5e0d5]">
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">User</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Role</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Last IP</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Location</th>
                      <th className="pb-2 font-medium text-[#8a8a8a]">Last Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userIPs.map((u) => (
                      <tr key={u.id} className="border-b border-[#f5f3ee] hover:bg-[#fbf9f4]">
                        <td className="py-2 pr-4">
                          <div className="font-medium text-[#1a1a1a]">{u.name}</div>
                          <div className="text-[10px] text-[#8a8a8a]">{u.email}</div>
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant="secondary" className="text-[10px] capitalize bg-[#fbf9f4] text-[#595959]">
                            {u.role}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 font-mono text-[#1a1a1a]">{u.lastIp}</td>
                        <td className="py-2 pr-4 text-[#8a8a8a]">{u.location}</td>
                        <td className="py-2 text-[#8a8a8a]">{new Date(u.lastAccess).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Geographic placeholder */}
        <TabsContent value="geo" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-[#1a1a1a]">
                <MapPin className="h-4 w-4 text-[#c9a87c]" />
                Geographic Restrictions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-[#fbf9f4] p-4 text-center">
                <Globe className="mx-auto mb-2 h-8 w-8 text-[#e5e0d5]" />
                <p className="text-sm font-medium text-[#1a1a1a]">Geographic restriction coming soon</p>
                <p className="mt-1 text-xs text-[#8a8a8a]">
                  Restrict access by country or region using IP geolocation.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {['North America', 'Europe', 'Asia Pacific', 'South America'].map((region) => (
                  <div key={region} className="flex items-center gap-2 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 opacity-50">
                    <Switch disabled />
                    <span className="text-xs text-[#595959]">{region}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
