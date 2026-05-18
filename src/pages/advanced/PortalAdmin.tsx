/**
 * PortalAdmin - Route: /portal-admin
 * Session timeout, password policy, data retention, health, backup, audit log.
 */
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Settings2, Clock, Lock, Archive, Activity, Database,
  HardDrive, Gauge, Save, History,
} from 'lucide-react';

/* ─── Types ─── */
interface PortalConfig {
  sessionTimeout: number;
  pwdMinLength: number;
  pwdRequireUppercase: boolean;
  pwdRequireLowercase: boolean;
  pwdRequireNumber: boolean;
  pwdRequireSpecial: boolean;
  pwdExpiryDays: number;
  ticketArchiveDays: number;
  autoArchive: boolean;
}

interface HealthStatus {
  dbConnected: boolean;
  dbLatency: number;
  storageUsed: string;
  storageTotal: string;
  uptime: string;
  lastBackup: string | null;
  version: string;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  details: string;
}

/* ─── Storage helpers ─── */
const PORTAL_CONFIG_KEY = 'veda_portal_config';
const AUDIT_LOG_KEY = 'veda_audit_log';

function loadPortalConfig(): PortalConfig {
  try {
    const raw = localStorage.getItem(PORTAL_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return {
    sessionTimeout: 30,
    pwdMinLength: 8,
    pwdRequireUppercase: true,
    pwdRequireLowercase: true,
    pwdRequireNumber: true,
    pwdRequireSpecial: false,
    pwdExpiryDays: 90,
    ticketArchiveDays: 365,
    autoArchive: false,
  };
}

function savePortalConfig(cfg: PortalConfig) {
  try { localStorage.setItem(PORTAL_CONFIG_KEY, JSON.stringify(cfg)); } catch { /* */ }
}

function loadAuditLog(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return [
    { id: '1', timestamp: '2025-01-15T11:00:00Z', actor: 'Alice Johnson', action: 'UPDATE', target: 'SSO Config', details: 'Enabled SAML 2.0' },
    { id: '2', timestamp: '2025-01-15T10:45:00Z', actor: 'Frank Brown', action: 'CREATE', target: 'API Key', details: 'Created key "Mobile App Integration"' },
    { id: '3', timestamp: '2025-01-15T09:30:00Z', actor: 'Alice Johnson', action: 'UPDATE', target: 'Branding', details: 'Changed primary color to #c9a87c' },
    { id: '4', timestamp: '2025-01-14T16:00:00Z', actor: 'Bob Smith', action: 'DELETE', target: 'Custom Role', details: 'Deleted "Temp Role" (0 users)' },
    { id: '5', timestamp: '2025-01-14T14:20:00Z', actor: 'Frank Brown', action: 'UPDATE', target: 'MFA Policy', details: 'Changed enforcement to "Required for Admins"' },
    { id: '6', timestamp: '2025-01-14T11:00:00Z', actor: 'Alice Johnson', action: 'CREATE', target: 'Backup', details: 'Manual database backup initiated' },
    { id: '7', timestamp: '2025-01-13T09:00:00Z', actor: 'System', action: 'SCHEDULED', target: 'Auto Archive', details: 'Archived 45 tickets older than 365 days' },
    { id: '8', timestamp: '2025-01-12T15:30:00Z', actor: 'Bob Smith', action: 'UPDATE', target: 'IP Restrictions', details: 'Added 10.0.0.0/8 to allowlist' },
  ];
}

function addAuditEntry(entry: AuditEntry) {
  try {
    const log = loadAuditLog();
    log.unshift(entry);
    if (log.length > 200) log.pop();
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(log));
  } catch { /* */ }
}

function getHealth(): HealthStatus {
  return {
    dbConnected: true,
    dbLatency: Math.floor(Math.random() * 30) + 5,
    storageUsed: '1.2 GB',
    storageTotal: '10 GB',
    uptime: '14d 7h 23m',
    lastBackup: '2025-01-14T11:00:00Z',
    version: '2.4.1',
  };
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-50 text-green-600',
  UPDATE: 'bg-blue-50 text-blue-600',
  DELETE: 'bg-red-50 text-red-600',
  SCHEDULED: 'bg-gray-100 text-gray-600',
};

export default function PortalAdmin() {
  const [config, setConfig] = useState<PortalConfig>(loadPortalConfig);
  const [health] = useState<HealthStatus>(getHealth());
  const [auditLog] = useState<AuditEntry[]>(loadAuditLog);
  const [backupStatus, setBackupStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [savedToast, setSavedToast] = useState(false);

  const update = useCallback((partial: Partial<PortalConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      savePortalConfig(next);
      return next;
    });
  }, []);

  const handleSave = () => {
    savePortalConfig(config);
    addAuditEntry({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Current User',
      action: 'UPDATE',
      target: 'Portal Settings',
      details: 'Updated portal configuration',
    });
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3000);
  };

  const handleBackup = () => {
    setBackupStatus('running');
    addAuditEntry({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Current User',
      action: 'CREATE',
      target: 'Backup',
      details: 'Manual database backup initiated',
    });
    setTimeout(() => {
      setBackupStatus('done');
      setTimeout(() => setBackupStatus('idle'), 3000);
    }, 2000);
  };


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#1a1a1a]">
            <Settings2 className="h-5 w-5 text-[#c9a87c]" />
            Portal Administration
          </h1>
          <p className="mt-0.5 text-sm text-[#8a8a8a]">
            Session, password policy, retention, health, and audit log
          </p>
        </div>
        <Button  className="bg-[#c9a87c] text-white hover:bg-[#b8996c]" onClick={handleSave}>
          <Save className="mr-1 h-3 w-3" />
          Save Changes
        </Button>
      </div>

      {savedToast && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-xs text-green-600">
          Settings saved successfully.
        </div>
      )}

      {/* Health Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className={cn('flex h-9 w-9 items-center justify-center rounded-full', health.dbConnected ? 'bg-green-50' : 'bg-red-50')}>
              <Database className={cn('h-4 w-4', health.dbConnected ? 'text-green-600' : 'text-red-600')} />
            </div>
            <div>
              <div className={cn('text-sm font-semibold', health.dbConnected ? 'text-green-600' : 'text-red-600')}>{health.dbConnected ? 'Connected' : 'Offline'}</div>
              <div className="text-[10px] text-[#8a8a8a]">VedaDB</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50">
              <Gauge className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1a1a1a]">{health.dbLatency}ms</div>
              <div className="text-[10px] text-[#8a8a8a]">DB Latency</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50">
              <HardDrive className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1a1a1a]">{health.storageUsed}</div>
              <div className="text-[10px] text-[#8a8a8a]">of {health.storageTotal} used</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#e5e0d5] bg-white">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-50">
              <Activity className="h-4 w-4 text-purple-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1a1a1a]">{health.uptime}</div>
              <div className="text-[10px] text-[#8a8a8a]">Uptime</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="session" className="w-full">
        <TabsList className="bg-[#fbf9f4] border border-[#e5e0d5] flex-wrap">
          <TabsTrigger value="session" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Clock className="mr-1 h-3 w-3" />
            Session
          </TabsTrigger>
          <TabsTrigger value="password" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Lock className="mr-1 h-3 w-3" />
            Password Policy
          </TabsTrigger>
          <TabsTrigger value="retention" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Archive className="mr-1 h-3 w-3" />
            Data Retention
          </TabsTrigger>
          <TabsTrigger value="backup" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Database className="mr-1 h-3 w-3" />
            Backup
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <History className="mr-1 h-3 w-3" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        {/* Session */}
        <TabsContent value="session" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-[#1a1a1a]">Session Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs text-[#595959]">
                  <Clock className="h-3 w-3" />
                  Session Timeout (minutes)
                </Label>
                <Input
                  type="number"
                  min={5}
                  max={240}
                  value={config.sessionTimeout}
                  onChange={(e) => update({ sessionTimeout: parseInt(e.target.value) || 30 })}
                  className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                />
                <p className="text-[10px] text-[#8a8a8a]">Users will be logged out after this period of inactivity.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Password Policy */}
        <TabsContent value="password" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-[#1a1a1a]">Password Policy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <Label className="text-xs text-[#595959]">Minimum Length</Label>
                <Input
                  type="number"
                  min={6}
                  max={64}
                  value={config.pwdMinLength}
                  onChange={(e) => update({ pwdMinLength: parseInt(e.target.value) || 8 })}
                  className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-[#595959]">Complexity Requirements</Label>
                {[
                  { key: 'pwdRequireUppercase' as const, label: 'Require uppercase letter (A-Z)' },
                  { key: 'pwdRequireLowercase' as const, label: 'Require lowercase letter (a-z)' },
                  { key: 'pwdRequireNumber' as const, label: 'Require number (0-9)' },
                  { key: 'pwdRequireSpecial' as const, label: 'Require special character (!@#$...)' },
                ].map((req) => (
                  <label key={req.key} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[#fbf9f4]">
                    <Switch
                      checked={!!config[req.key]}
                      onCheckedChange={(v) => update({ [req.key]: v })}
                      className="data-[state=checked]:bg-[#c9a87c]"
                      
                    />
                    <span className="text-xs text-[#595959]">{req.label}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[#595959]">Password Expiry (days, 0 = never)</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={config.pwdExpiryDays}
                  onChange={(e) => update({ pwdExpiryDays: parseInt(e.target.value) || 0 })}
                  className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Data Retention */}
        <TabsContent value="retention" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-[#1a1a1a]">Data Retention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <Label className="text-xs text-[#595959]">Archive tickets after (days)</Label>
                <Input
                  type="number"
                  min={30}
                  max={9999}
                  value={config.ticketArchiveDays}
                  onChange={(e) => update({ ticketArchiveDays: parseInt(e.target.value) || 365 })}
                  className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                />
                <p className="text-[10px] text-[#8a8a8a]">Closed tickets older than this will be archived and moved to cold storage.</p>
              </div>
              <label className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[#fbf9f4]">
                <Switch
                  checked={config.autoArchive}
                  onCheckedChange={(v) => update({ autoArchive: v })}
                  className="data-[state=checked]:bg-[#c9a87c]"
                  
                />
                <span className="text-xs text-[#595959]">Enable automatic archiving</span>
              </label>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Backup */}
        <TabsContent value="backup" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base font-semibold text-[#1a1a1a]">
                <span>Database Backup</span>
                <Button
                  
                  className={cn(
                    'text-xs',
                    backupStatus === 'running' && 'bg-amber-600',
                    backupStatus === 'done' && 'bg-green-600',
                    backupStatus === 'idle' && 'bg-[#c9a87c] hover:bg-[#b8996c]'
                  )}
                  onClick={handleBackup}
                  disabled={backupStatus !== 'idle'}
                >
                  {backupStatus === 'running' && <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                  {backupStatus === 'idle' && <Database className="mr-1 h-3 w-3" />}
                  {backupStatus === 'done' && 'Backup Complete'}
                  {backupStatus === 'idle' && 'Backup Now'}
                  {backupStatus === 'running' && 'Backing up...'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-[#fbf9f4] p-3">
                  <div className="text-[10px] text-[#8a8a8a]">Last Backup</div>
                  <div className="text-sm font-medium text-[#1a1a1a]">
                    {health.lastBackup ? new Date(health.lastBackup).toLocaleString() : 'Never'}
                  </div>
                </div>
                <div className="rounded-lg bg-[#fbf9f4] p-3">
                  <div className="text-[10px] text-[#8a8a8a]">Portal Version</div>
                  <div className="text-sm font-medium text-[#1a1a1a]">{health.version}</div>
                </div>
              </div>
              {/* Schedule */}
              <div className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] p-3">
                <div className="mb-2 text-xs font-medium text-[#1a1a1a]">Backup Schedule</div>
                <div className="flex items-center gap-2">
                  <Switch checked className="data-[state=checked]:bg-[#c9a87c]"  />
                  <span className="text-xs text-[#595959]">Daily at 02:00 UTC</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit Log */}
        <TabsContent value="audit" className="mt-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-[#1a1a1a]">Audit Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[500px]">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-[#e5e0d5]">
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Time</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Actor</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Action</th>
                      <th className="pb-2 pr-4 font-medium text-[#8a8a8a]">Target</th>
                      <th className="pb-2 font-medium text-[#8a8a8a]">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry) => (
                      <tr key={entry.id} className="border-b border-[#f5f3ee] hover:bg-[#fbf9f4]">
                        <td className="py-2 pr-4 text-[#8a8a8a] whitespace-nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
                        <td className="py-2 pr-4 font-medium text-[#1a1a1a]">{entry.actor}</td>
                        <td className="py-2 pr-4">
                          <Badge variant="secondary" className={cn('text-[10px]', ACTION_COLORS[entry.action])}>
                            {entry.action}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-[#595959]">{entry.target}</td>
                        <td className="py-2 text-[#8a8a8a]">{entry.details}</td>
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
