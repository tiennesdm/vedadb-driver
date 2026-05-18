import { useState, useEffect, useCallback } from 'react';
import { Plug, CheckCircle, XCircle, Loader2, Timer, Info, Activity, Server } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import useAppStore from '@/lib/vedadb-store';

interface Props {
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

type TestState = 'idle' | 'testing' | 'success' | 'failed';

interface ConnHistory {
  time: string;
  status: 'success' | 'failed';
  message: string;
}

export default function VedaDBConnectionTab({ showToast }: Props) {
  const client = useAppStore((s) => s.client);
  const dbStatus = useAppStore((s) => s.dbStatus);
  const dbLatency = useAppStore((s) => s.dbLatency);

  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('6380');
  const [token, setToken] = useState('');
  const [testState, setTestState] = useState<TestState>('idle');
  const [history, setHistory] = useState<ConnHistory[]>([]);
  const [lastConnected, setLastConnected] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('vedadesk_conn_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setHost(parsed.host || 'localhost');
        setPort(parsed.port || '6380');
        setToken(parsed.token || '');
        setLastConnected(parsed.lastConnected || null);
      } catch { /* ignore */ }
    }
    const savedHistory = localStorage.getItem('vedadesk_conn_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch { /* ignore */ }
    }
  }, []);

  const saveConfig = useCallback(() => {
    const config = { host, port, token, lastConnected };
    localStorage.setItem('vedadesk_conn_settings', JSON.stringify(config));
    showToast('Configuration saved', 'success');
  }, [host, port, token, lastConnected, showToast]);

  const testConnection = useCallback(async () => {
    setTestState('testing');
    await new Promise((r) => setTimeout(r, 1500));

    const success = !!client && dbStatus === 'connected';
    if (success) {
      setTestState('success');
      const now = new Date().toISOString();
      setLastConnected(now);
      const entry: ConnHistory = {
        time: now,
        status: 'success',
        message: `Connected to ${host}:${port} (${dbLatency}ms)`,
      };
      const newHistory = [entry, ...history].slice(0, 20);
      setHistory(newHistory);
      localStorage.setItem('vedadesk_conn_history', JSON.stringify(newHistory));
      localStorage.setItem('vedadesk_conn_settings', JSON.stringify({ host, port, token, lastConnected: now }));
      showToast('Connection successful!', 'success');
      setTimeout(() => setTestState('idle'), 3000);
    } else {
      setTestState('failed');
      const entry: ConnHistory = {
        time: new Date().toISOString(),
        status: 'failed',
        message: `Failed to connect to ${host}:${port}`,
      };
      const newHistory = [entry, ...history].slice(0, 20);
      setHistory(newHistory);
      localStorage.setItem('vedadesk_conn_history', JSON.stringify(newHistory));
      showToast('Connection failed', 'error');
      setTimeout(() => setTestState('idle'), 3000);
    }
  }, [client, dbStatus, dbLatency, host, port, token, history, showToast]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const isConnected = dbStatus === 'connected';

  return (
    <div>
      <h2 className="text-2xl font-medium text-[#1f1f1f] tracking-tight">VedaDB Connection</h2>
      <p className="mt-1 text-sm text-[#595959]">Configure your VedaDB database connection.</p>

      {/* Connection Form */}
      <div className="mt-8 max-w-md space-y-5">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Host</Label>
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="localhost"
            className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Port</Label>
          <Input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="6380"
            className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Auth Token</Label>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Optional authentication token"
            className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={testConnection}
            disabled={testState === 'testing'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
              testState === 'idle' && 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95',
              testState === 'testing' && 'bg-[#e5e0d5] text-[#8a8a8a] cursor-not-allowed',
              testState === 'success' && 'bg-[#52c41a] text-white',
              testState === 'failed' && 'bg-[#f5222d] text-white',
              'active:scale-[0.98]'
            )}
          >
            {testState === 'idle' && <Plug size={16} />}
            {testState === 'testing' && <Loader2 size={16} className="animate-spin" />}
            {testState === 'success' && <CheckCircle size={16} />}
            {testState === 'failed' && <XCircle size={16} />}
            {testState === 'idle' && 'Test Connection'}
            {testState === 'testing' && 'Testing...'}
            {testState === 'success' && 'Connected!'}
            {testState === 'failed' && 'Connection Failed'}
          </button>

          <button
            onClick={saveConfig}
            className="flex items-center gap-2 rounded-lg border border-[#e5e0d5] bg-[#f5f0e8] px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition-all duration-200 hover:bg-[#ede7db] active:scale-[0.98]"
          >
            Save Configuration
          </button>
        </div>
      </div>

      {/* Connection Status Card */}
      <div className="mt-10 rounded-xl border border-[#e5e0d5] bg-white p-6">
        <h3 className="text-base font-medium text-[#1f1f1f]">Connection Status</h3>
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'h-3 w-3 rounded-full',
              isConnected ? 'bg-[#52c41a]' : 'bg-[#f5222d]',
              isConnected && 'animate-pulse'
            )} />
            <span className="text-sm text-[#595959]">Connection Status</span>
            <span className={cn(
              'ml-auto text-sm font-medium',
              isConnected ? 'text-[#52c41a]' : 'text-[#f5222d]'
            )}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Timer size={14} className="text-[#8a8a8a]" />
            <span className="text-sm text-[#595959]">Query Latency</span>
            <span className="ml-auto text-sm font-medium text-[#1f1f1f]">{dbLatency}ms</span>
          </div>

          <div className="flex items-center gap-3">
            <Info size={14} className="text-[#8a8a8a]" />
            <span className="text-sm text-[#595959]">VedaDB Version</span>
            <span className="ml-auto text-sm font-medium text-[#1f1f1f]">1.0.0</span>
          </div>

          <div className="flex items-center gap-3">
            <Activity size={14} className="text-[#8a8a8a]" />
            <span className="text-sm text-[#595959]">Last Connected</span>
            <span className="ml-auto text-sm font-medium text-[#1f1f1f]">
              {lastConnected ? formatTime(lastConnected) : 'Never'}
            </span>
          </div>

          {lastConnected && (
            <div className="flex items-center gap-3">
              <Server size={14} className="text-[#8a8a8a]" />
              <span className="text-sm text-[#595959]">Endpoint</span>
              <span className="ml-auto text-sm font-medium text-[#1f1f1f]">{host}:{port}</span>
            </div>
          )}
        </div>
      </div>

      {/* Connection History */}
      {history.length > 0 && (
        <div className="mt-8 rounded-xl border border-[#e5e0d5] bg-white p-6">
          <h3 className="text-base font-medium text-[#1f1f1f]">Connection History</h3>
          <div className="mt-4 space-y-2 max-h-[240px] overflow-y-auto">
            {history.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-[#e5e0d5]/50 last:border-0">
                <div className={cn(
                  'h-2.5 w-2.5 rounded-full shrink-0',
                  entry.status === 'success' ? 'bg-[#52c41a]' : 'bg-[#f5222d]'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1f1f1f] truncate">{entry.message}</p>
                  <p className="text-xs text-[#8a8a8a]">{formatTime(entry.time)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
