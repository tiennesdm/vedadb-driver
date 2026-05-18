/**
 * APIManagement - Route: /api-management
 * API key management, usage stats, rate limiting, and API documentation viewer.
 */
import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Key, Plus, Search, BookOpen, Activity, SlidersHorizontal,
  BarChart3, Clock, Zap,
} from 'lucide-react';
import APIKeyCard, { type APIKeyItem } from '@/components/advanced/APIKeyCard';

const API_STORAGE_KEY = 'veda_api_keys';
const RATE_LIMIT_KEY = 'veda_api_rate_limits';

function generateKey(): string {
  const prefix = 'vd_';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 48; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return prefix + s;
}

function generatePrefix(key: string): string {
  return key.slice(0, 8);
}

function loadAPIKeys(): APIKeyItem[] {
  try {
    const raw = localStorage.getItem(API_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return [
    {
      id: 'key-1',
      name: 'Production Integration',
      key: 'vd_a1b2c3d4e5f6789012345678901234567890abcdef',
      prefix: 'vd_a1b2c3',
      scopes: ['read', 'write'],
      created: '2025-01-01',
      expires: '2025-12-31',
      lastUsed: '2025-01-15T10:30:00Z',
      status: 'active',
      requestsToday: 1240,
    },
    {
      id: 'key-2',
      name: 'Reporting Service',
      key: 'vd_report1234567890abcdef1234567890abcdef12',
      prefix: 'vd_report',
      scopes: ['read'],
      created: '2025-01-05',
      expires: null,
      lastUsed: '2025-01-14T16:00:00Z',
      status: 'active',
      requestsToday: 85,
    },
    {
      id: 'key-3',
      name: 'Legacy System',
      key: 'vd_legacy9876543210fedcba0987654321fedcba09',
      prefix: 'vd_legacy',
      scopes: ['read', 'admin'],
      created: '2024-06-15',
      expires: '2025-01-15',
      lastUsed: '2025-01-10T08:00:00Z',
      status: 'expired',
      requestsToday: 0,
    },
  ];
}

function saveAPIKeys(keys: APIKeyItem[]) {
  try { localStorage.setItem(API_STORAGE_KEY, JSON.stringify(keys)); } catch { /* */ }
}

interface RateLimits {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstLimit: number;
}

function loadRateLimits(): RateLimits {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { requestsPerMinute: 60, requestsPerHour: 1000, requestsPerDay: 10000, burstLimit: 10 };
}

function saveRateLimits(limits: RateLimits) {
  try { localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(limits)); } catch { /* */ }
}

/* ─── API Documentation ─── */
const API_DOCS = [
  {
    section: 'Authentication',
    endpoints: [
      { method: 'POST', path: '/api/v1/auth/login', desc: 'Authenticate and receive JWT token' },
      { method: 'POST', path: '/api/v1/auth/refresh', desc: 'Refresh an expired access token' },
      { method: 'POST', path: '/api/v1/auth/logout', desc: 'Invalidate current session' },
    ],
  },
  {
    section: 'Tickets',
    endpoints: [
      { method: 'GET', path: '/api/v1/tickets', desc: 'List all tickets (paginated)' },
      { method: 'GET', path: '/api/v1/tickets/:id', desc: 'Get a single ticket by ID' },
      { method: 'POST', path: '/api/v1/tickets', desc: 'Create a new ticket' },
      { method: 'PUT', path: '/api/v1/tickets/:id', desc: 'Update ticket fields' },
      { method: 'DELETE', path: '/api/v1/tickets/:id', desc: 'Soft-delete a ticket' },
      { method: 'POST', path: '/api/v1/tickets/:id/comments', desc: 'Add a comment to a ticket' },
      { method: 'POST', path: '/api/v1/tickets/:id/assign', desc: 'Assign ticket to an agent' },
    ],
  },
  {
    section: 'Users',
    endpoints: [
      { method: 'GET', path: '/api/v1/users', desc: 'List all users' },
      { method: 'GET', path: '/api/v1/users/:id', desc: 'Get user profile' },
      { method: 'POST', path: '/api/v1/users', desc: 'Create a new user' },
      { method: 'PUT', path: '/api/v1/users/:id', desc: 'Update user profile' },
      { method: 'PUT', path: '/api/v1/users/:id/role', desc: 'Change user role' },
    ],
  },
  {
    section: 'Knowledge Base',
    endpoints: [
      { method: 'GET', path: '/api/v1/kb/articles', desc: 'List KB articles' },
      { method: 'GET', path: '/api/v1/kb/articles/:id', desc: 'Get article content' },
      { method: 'POST', path: '/api/v1/kb/articles', desc: 'Create article' },
      { method: 'PUT', path: '/api/v1/kb/articles/:id', desc: 'Update article' },
      { method: 'DELETE', path: '/api/v1/kb/articles/:id', desc: 'Delete article' },
    ],
  },
  {
    section: 'VedaDB Direct',
    endpoints: [
      { method: 'POST', path: '/api/v1/query', desc: 'Execute raw VedaDB SQL query' },
      { method: 'POST', path: '/api/v1/exec', desc: 'Execute non-select VedaDB command' },
      { method: 'GET', path: '/api/v1/status', desc: 'Check VedaDB connection status' },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-50 text-blue-600 border-blue-100',
  POST: 'bg-green-50 text-green-600 border-green-100',
  PUT: 'bg-amber-50 text-amber-600 border-amber-100',
  DELETE: 'bg-red-50 text-red-600 border-red-100',
};

export default function APIManagement() {
  const [keys, setKeys] = useState<APIKeyItem[]>(loadAPIKeys);
  const [search, setSearch] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<('read' | 'write' | 'admin')[]>(['read']);
  const [rateLimits, setRateLimits] = useState<RateLimits>(loadRateLimits);
  const [justCreated, setJustCreated] = useState<APIKeyItem | null>(null);

  const filteredKeys = useMemo(() => {
    if (!search) return keys;
    const q = search.toLowerCase();
    return keys.filter((k) => k.name.toLowerCase().includes(q));
  }, [keys, search]);

  const totalRequests = useMemo(() => keys.reduce((s, k) => s + k.requestsToday, 0), [keys]);
  const activeKeys = useMemo(() => keys.filter((k) => k.status === 'active').length, [keys]);

  const handleCreateKey = useCallback(() => {
    if (!newKeyName.trim()) return;
    const key = generateKey();
    const newItem: APIKeyItem = {
      id: `key-${Date.now()}`,
      name: newKeyName.trim(),
      key,
      prefix: generatePrefix(key),
      scopes: [...newKeyScopes],
      created: new Date().toISOString().split('T')[0],
      expires: null,
      lastUsed: null,
      status: 'active',
      requestsToday: 0,
    };
    setKeys((prev) => { const next = [...prev, newItem]; saveAPIKeys(next); return next; });
    setNewKeyName('');
    setNewKeyScopes(['read']);
    setShowNewKey(false);
    setJustCreated(newItem);
    setTimeout(() => setJustCreated(null), 5000);
  }, [newKeyName, newKeyScopes]);

  const handleRevoke = useCallback((id: string) => {
    setKeys((prev) => {
      const next = prev.filter((k) => k.id !== id);
      saveAPIKeys(next);
      return next;
    });
  }, []);

  const handleRegenerate = useCallback((id: string) => {
    const key = generateKey();
    setKeys((prev) => {
      const next = prev.map((k) =>
        k.id === id ? { ...k, key, prefix: generatePrefix(key), created: new Date().toISOString().split('T')[0] } : k
      );
      saveAPIKeys(next);
      return next;
    });
  }, []);

  const handleToggleStatus = useCallback((id: string, active: boolean) => {
    setKeys((prev) => {
      const next = prev.map((k) =>
        k.id === id ? { ...k, status: (active ? 'active' : 'revoked') as APIKeyItem['status'] } : k
      );
      saveAPIKeys(next);
      return next;
    });
  }, []);

  const updateRateLimits = (partial: Partial<RateLimits>) => {
    setRateLimits((prev) => {
      const next = { ...prev, ...partial };
      saveRateLimits(next);
      return next;
    });
  };

  const toggleScope = (scope: 'read' | 'write' | 'admin') => {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#1a1a1a]">
            <Key className="h-5 w-5 text-[#c9a87c]" />
            API Management
          </h1>
          <p className="mt-0.5 text-sm text-[#8a8a8a]">Manage API keys, rate limits, and view documentation</p>
        </div>
        <Button className="bg-[#c9a87c] text-white hover:bg-[#b8996c]" size="sm" onClick={() => setShowNewKey(true)}>
          <Plus className="mr-1 h-3 w-3" />
          New API Key
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#c9a87c]/10">
              <Key className="h-4 w-4 text-[#c9a87c]" />
            </div>
            <div>
              <div className="text-lg font-semibold text-[#1a1a1a]">{keys.length}</div>
              <div className="text-[10px] text-[#8a8a8a]">Total Keys</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50">
              <Zap className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <div className="text-lg font-semibold text-[#1a1a1a]">{activeKeys}</div>
              <div className="text-[10px] text-[#8a8a8a]">Active Keys</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50">
              <Activity className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <div className="text-lg font-semibold text-[#1a1a1a]">{totalRequests.toLocaleString()}</div>
              <div className="text-[10px] text-[#8a8a8a]">Requests Today</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50">
              <BarChart3 className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <div className="text-lg font-semibold text-[#1a1a1a]">{rateLimits.requestsPerMinute}/min</div>
              <div className="text-[10px] text-[#8a8a8a]">Rate Limit</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* New key creation */}
      {showNewKey && (
        <Card className="border-[#c9a87c] bg-white ring-1 ring-[#c9a87c]/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#1a1a1a]">Create New API Key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#595959]">Key Name</Label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Mobile App Integration"
                className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#595959]">Scopes</Label>
              <div className="flex gap-2">
                {(['read', 'write', 'admin'] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => toggleScope(scope)}
                    className={cn(
                      'rounded-md border px-3 py-1 text-xs capitalize transition-colors',
                      newKeyScopes.includes(scope)
                        ? 'border-[#c9a87c] bg-[#c9a87c]/10 text-[#c9a87c]'
                        : 'border-[#e5e0d5] text-[#595959] hover:bg-[#fbf9f4]'
                    )}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="border-[#e5e0d5] text-xs" onClick={() => setShowNewKey(false)}>
                Cancel
              </Button>
              <Button size="sm" className="bg-[#c9a87c] text-white hover:bg-[#b8996c] text-xs" onClick={handleCreateKey} disabled={!newKeyName.trim()}>
                Create Key
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Just created reveal */}
      {justCreated && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-3">
            <div className="mb-2 text-xs font-medium text-green-700">API Key created — copy it now, it will not be shown again:</div>
            <code className="block rounded bg-white p-2 font-mono text-xs text-[#1a1a1a] break-all">{justCreated.key}</code>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="keys" className="w-full">
        <TabsList className="bg-[#fbf9f4] border border-[#e5e0d5]">
          <TabsTrigger value="keys" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Key className="mr-1 h-3 w-3" />
            API Keys ({filteredKeys.length})
          </TabsTrigger>
          <TabsTrigger value="limits" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <SlidersHorizontal className="mr-1 h-3 w-3" />
            Rate Limits
          </TabsTrigger>
          <TabsTrigger value="docs" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <BookOpen className="mr-1 h-3 w-3" />
            Documentation
          </TabsTrigger>
        </TabsList>

        {/* Keys */}
        <TabsContent value="keys" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-[#8a8a8a]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keys..."
              className="h-8 max-w-xs border-[#e5e0d5] bg-[#fbf9f4] text-sm"
            />
          </div>
          {filteredKeys.map((k) => (
            <APIKeyCard
              key={k.id}
              apiKey={k}
              onCopy={(key) => navigator.clipboard.writeText(key).catch(() => {})}
              onRegenerate={handleRegenerate}
              onRevoke={handleRevoke}
              onToggleStatus={handleToggleStatus}
            />
          ))}
          {filteredKeys.length === 0 && (
            <div className="rounded-lg border border-dashed border-[#e5e0d5] bg-[#fbf9f4] p-6 text-center">
              <Key className="mx-auto mb-2 h-6 w-6 text-[#e5e0d5]" />
              <p className="text-xs text-[#8a8a8a]">No API keys found</p>
            </div>
          )}
        </TabsContent>

        {/* Rate Limits */}
        <TabsContent value="limits" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-[#1a1a1a]">Rate Limiting Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs text-[#595959]">
                    <Clock className="h-3 w-3" />
                    Requests per Minute
                  </Label>
                  <Input
                    type="number"
                    value={rateLimits.requestsPerMinute}
                    onChange={(e) => updateRateLimits({ requestsPerMinute: parseInt(e.target.value) || 0 })}
                    className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs text-[#595959]">
                    <Clock className="h-3 w-3" />
                    Requests per Hour
                  </Label>
                  <Input
                    type="number"
                    value={rateLimits.requestsPerHour}
                    onChange={(e) => updateRateLimits({ requestsPerHour: parseInt(e.target.value) || 0 })}
                    className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs text-[#595959]">
                    <Clock className="h-3 w-3" />
                    Requests per Day
                  </Label>
                  <Input
                    type="number"
                    value={rateLimits.requestsPerDay}
                    onChange={(e) => updateRateLimits({ requestsPerDay: parseInt(e.target.value) || 0 })}
                    className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs text-[#595959]">
                    <Zap className="h-3 w-3" />
                    Burst Limit
                  </Label>
                  <Input
                    type="number"
                    value={rateLimits.burstLimit}
                    onChange={(e) => updateRateLimits({ burstLimit: parseInt(e.target.value) || 0 })}
                    className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                  />
                </div>
              </div>
              <div className="rounded-lg bg-[#fbf9f4] p-3">
                <p className="text-[10px] text-[#8a8a8a]">
                  Rate limits are enforced per API key. Exceeding any limit returns HTTP 429 (Too Many Requests).
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documentation */}
        <TabsContent value="docs" className="mt-4 space-y-4">
          {API_DOCS.map((section) => (
            <Card key={section.section} className="border-[#e5e0d5] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-[#1a1a1a]">{section.section}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {section.endpoints.map((ep) => (
                  <div
                    key={ep.path}
                    className="flex items-center gap-3 rounded-md border border-[#f5f3ee] px-3 py-2 hover:bg-[#fbf9f4]"
                  >
                    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] font-mono', METHOD_COLORS[ep.method])}>
                      {ep.method}
                    </Badge>
                    <code className="font-mono text-xs text-[#1a1a1a]">{ep.path}</code>
                    <span className="text-xs text-[#8a8a8a]">{ep.desc}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
