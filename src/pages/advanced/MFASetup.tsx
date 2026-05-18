/**
 * MFASetup - Route: /mfa-setup
 * TOTP-based MFA with QR codes, enforcement levels, and per-user status.
 */
import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Shield, Smartphone, KeyRound, Users, AlertTriangle, CheckCircle,
  RefreshCw, Download, Lock,
} from 'lucide-react';
import QRCodeDisplay from '@/components/advanced/QRCodeDisplay';

type MFAEnforcement = 'optional' | 'recommended' | 'admins' | 'all';

interface MFAUserStatus {
  id: number;
  name: string;
  email: string;
  role: string;
  mfaEnabled: boolean;
  lastAuth: string | null;
  registeredAt: string | null;
}

const STORAGE_KEY = 'veda_mfa_config';

function loadMFAConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return {
    enabled: false,
    enforcement: 'optional' as MFAEnforcement,
    secret: generateSecret(),
    recoveryCodes: generateRecoveryCodes(),
    users: generateMockUsers(),
  };
}

function saveMFAConfig(cfg: ReturnType<typeof loadMFAConfig>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* */ }
}

function generateSecret(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // Base32
  let s = '';
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () =>
    Array.from({ length: 4 }, () =>
      Math.random().toString(36).substring(2, 6).toUpperCase()
    ).join('-')
  );
}

function generateMockUsers(): MFAUserStatus[] {
  return [
    { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'admin', mfaEnabled: true, lastAuth: '2025-01-15T10:30:00Z', registeredAt: '2025-01-01T08:00:00Z' },
    { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'manager', mfaEnabled: true, lastAuth: '2025-01-14T16:45:00Z', registeredAt: '2025-01-02T09:00:00Z' },
    { id: 3, name: 'Carol White', email: 'carol@example.com', role: 'agent', mfaEnabled: false, lastAuth: null, registeredAt: null },
    { id: 4, name: 'David Lee', email: 'david@example.com', role: 'agent', mfaEnabled: true, lastAuth: '2025-01-15T08:20:00Z', registeredAt: '2025-01-05T10:00:00Z' },
    { id: 5, name: 'Eva Martinez', email: 'eva@example.com', role: 'customer', mfaEnabled: false, lastAuth: null, registeredAt: null },
    { id: 6, name: 'Frank Brown', email: 'frank@example.com', role: 'super_admin', mfaEnabled: true, lastAuth: '2025-01-15T11:00:00Z', registeredAt: '2024-12-20T07:00:00Z' },
    { id: 7, name: 'Grace Kim', email: 'grace@example.com', role: 'agent', mfaEnabled: false, lastAuth: null, registeredAt: null },
    { id: 8, name: 'Henry Wilson', email: 'henry@example.com', role: 'manager', mfaEnabled: true, lastAuth: '2025-01-13T14:30:00Z', registeredAt: '2025-01-03T11:00:00Z' },
  ];
}

const ENFORCEMENT_OPTIONS: { value: MFAEnforcement; label: string; description: string; icon: typeof Lock }[] = [
  { value: 'optional', label: 'Optional', description: 'Users may enable MFA at their discretion', icon: Shield },
  { value: 'recommended', label: 'Recommended', description: 'Prompt users to enable MFA during login', icon: CheckCircle },
  { value: 'admins', label: 'Required for Admins', description: 'Administrators and managers must use MFA', icon: Lock },
  { value: 'all', label: 'Required for All', description: 'Every user must enable MFA to access the portal', icon: AlertTriangle },
];

export default function MFASetup() {
  const [config, setConfig] = useState(loadMFAConfig);
  const [showCodes, setShowCodes] = useState(false);

  const update = useCallback((partial: Partial<typeof config>) => {
    setConfig((prev: typeof config) => {
      const next = { ...prev, ...partial };
      saveMFAConfig(next);
      return next;
    });
  }, []);

  const handleRegenerateSecret = () => {
    update({ secret: generateSecret(), recoveryCodes: generateRecoveryCodes() });
  };

  const handleDownloadCodes = () => {
    const content = config.recoveryCodes.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mfa-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    const total = config.users.length;
    const enabled = config.users.filter((u: MFAUserStatus) => u.mfaEnabled).length;
    const adminRequired = config.enforcement === 'admins' || config.enforcement === 'all';
    const adminCount = config.users.filter((u: MFAUserStatus) => ['admin', 'super_admin', 'manager'].includes(u.role)).length;
    const adminEnabled = config.users.filter((u: MFAUserStatus) => ['admin', 'super_admin', 'manager'].includes(u.role) && u.mfaEnabled).length;
    return { total, enabled, rate: Math.round((enabled / total) * 100), adminCount, adminEnabled, adminRequired };
  }, [config.users, config.enforcement]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#1a1a1a]">
            <Shield className="h-5 w-5 text-[#c9a87c]" />
            Multi-Factor Authentication
          </h1>
          <p className="mt-0.5 text-sm text-[#8a8a8a]">
            TOTP-based MFA setup, enforcement policies, and user status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8a8a8a]">MFA Globally</span>
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => update({ enabled: v })}
            className="data-[state=checked]:bg-[#c9a87c]"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#c9a87c]/10">
                <Users className="h-4 w-4 text-[#c9a87c]" />
              </div>
              <div>
                <div className="text-lg font-semibold text-[#1a1a1a]">{stats.enabled} / {stats.total}</div>
                <div className="text-[10px] text-[#8a8a8a]">Users with MFA enabled</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <div className="text-lg font-semibold text-[#1a1a1a]">{stats.rate}%</div>
                <div className="text-[10px] text-[#8a8a8a]">Adoption rate</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn('flex h-9 w-9 items-center justify-center rounded-full', stats.adminRequired ? 'bg-amber-50' : 'bg-blue-50')}>
                <Lock className={cn('h-4 w-4', stats.adminRequired ? 'text-amber-600' : 'text-blue-600')} />
              </div>
              <div>
                <div className="text-lg font-semibold text-[#1a1a1a]">{stats.adminEnabled}/{stats.adminCount}</div>
                <div className="text-[10px] text-[#8a8a8a]">Admins with MFA</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="setup" className="w-full">
        <TabsList className="bg-[#fbf9f4] border border-[#e5e0d5]">
          <TabsTrigger value="setup" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Smartphone className="mr-1 h-3 w-3" />
            TOTP Setup
          </TabsTrigger>
          <TabsTrigger value="enforcement" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Lock className="mr-1 h-3 w-3" />
            Enforcement
          </TabsTrigger>
          <TabsTrigger value="recovery" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <KeyRound className="mr-1 h-3 w-3" />
            Recovery Codes
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Users className="mr-1 h-3 w-3" />
            User Status
          </TabsTrigger>
        </TabsList>

        {/* TOTP Setup */}
        <TabsContent value="setup" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <QRCodeDisplay
              secret={config.secret}
              issuer="Veda Support Portal"
              accountName="admin@veda.local"
              onRegenerate={handleRegenerateSecret}
            />
            <Card className="border-[#e5e0d5] bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-[#1a1a1a]">Setup Instructions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#c9a87c] text-[10px] font-bold text-white">1</div>
                  <p className="text-xs text-[#595959]">Download an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator.</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#c9a87c] text-[10px] font-bold text-white">2</div>
                  <p className="text-xs text-[#595959]">Scan the QR code with your authenticator app, or manually enter the secret key.</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#c9a87c] text-[10px] font-bold text-white">3</div>
                  <p className="text-xs text-[#595959]">Enter the 6-digit code from your app to verify the setup.</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#c9a87c] text-[10px] font-bold text-white">4</div>
                  <p className="text-xs text-[#595959]">Save your recovery codes in a secure location. They are your only way back in if you lose your device.</p>
                </div>
                <div className="mt-4 rounded-lg bg-amber-50 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                    <p className="text-[10px] text-amber-700">
                      The QR code and secret key are for demonstration. In production, each user receives a unique secret generated server-side.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Enforcement */}
        <TabsContent value="enforcement" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-[#1a1a1a]">MFA Enforcement Level</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ENFORCEMENT_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = config.enforcement === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update({ enforcement: opt.value })}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all hover:bg-[#fbf9f4]',
                      isSelected
                        ? 'border-[#c9a87c] bg-[#c9a87c]/5 ring-1 ring-[#c9a87c]'
                        : 'border-[#e5e0d5] bg-white'
                    )}
                  >
                    <div className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                      isSelected ? 'bg-[#c9a87c]/10' : 'bg-[#fbf9f4]'
                    )}>
                      <Icon className={cn('h-4 w-4', isSelected ? 'text-[#c9a87c]' : 'text-[#8a8a8a]')} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-sm font-medium', isSelected ? 'text-[#c9a87c]' : 'text-[#1a1a1a]')}>
                          {opt.label}
                        </span>
                        {isSelected && (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px] bg-[#c9a87c]/10 text-[#c9a87c]">
                            Active
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-[#8a8a8a]">{opt.description}</p>
                    </div>
                    <div className={cn(
                      'h-4 w-4 rounded-full border-2',
                      isSelected ? 'border-[#c9a87c] bg-[#c9a87c]' : 'border-[#e5e0d5]'
                    )}>
                      {isSelected && <CheckCircle className="h-3.5 w-3.5 text-white" />}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recovery Codes */}
        <TabsContent value="recovery" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base font-semibold text-[#1a1a1a]">
                <span>Recovery Codes</span>
                <div className="flex gap-1">
                  <Button variant="outline"  className="h-6 border-[#e5e0d5] text-xs" onClick={handleRegenerateSecret}>
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Regenerate
                  </Button>
                  <Button variant="outline"  className="h-6 border-[#e5e0d5] text-xs" onClick={handleDownloadCodes}>
                    <Download className="mr-1 h-3 w-3" />
                    Download
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 rounded-lg bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                  <p className="text-[10px] text-amber-700">
                    Each code can only be used once. Store these in a secure password manager.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {config.recoveryCodes.map((code: string, i: number) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded-md border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-center font-mono text-xs',
                      !showCodes && 'select-none blur-sm'
                    )}
                  >
                    {showCodes ? code : '••••-••••-••••'}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                
                className="mt-3 border-[#e5e0d5] text-xs"
                onClick={() => setShowCodes(!showCodes)}
              >
                {showCodes ? 'Hide Codes' : 'Show Codes'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* User Status */}
        <TabsContent value="users" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-[#1a1a1a]">MFA Status Per User</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#e5e0d5]">
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">User</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Role</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Status</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Registered</th>
                      <th className="pb-2 font-medium text-[#8a8a8a]">Last Auth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.users.map((user: MFAUserStatus) => (
                      <tr key={user.id} className="border-b border-[#f5f3ee] hover:bg-[#fbf9f4]">
                        <td className="py-2 pr-4">
                          <div>
                            <div className="font-medium text-[#1a1a1a]">{user.name}</div>
                            <div className="text-[10px] text-[#8a8a8a]">{user.email}</div>
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant="secondary" className="text-[10px] capitalize bg-[#fbf9f4] text-[#595959]">
                            {user.role.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant="secondary"
                            className={cn(
                              'text-[10px]',
                              user.mfaEnabled
                                ? 'bg-green-50 text-green-600'
                                : 'bg-gray-100 text-gray-500'
                            )}
                          >
                            {user.mfaEnabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-[#8a8a8a]">
                          {user.registeredAt ? new Date(user.registeredAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-2 text-[#8a8a8a]">
                          {user.lastAuth ? new Date(user.lastAuth).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
