import { useState, useEffect, useCallback } from 'react';
import { Plug, CheckCircle, XCircle, Loader2, Timer, Activity, Server, Globe, KeyRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  setApiBase,
  setApiKey,
  getApiBase,
  getApiKey,
  vedaTestConnection,
  getConnectionStatus,
} from '@/lib/vedadb-api';

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
  const [apiUrl, setApiUrl] = useState('http://localhost:9090');
  const [apiKey, setApiKeyState] = useState('');
  const [testState, setTestState] = useState<TestState>('idle');
  const [history, setHistory] = useState<ConnHistory[]>([]);
  const [lastConnected, setLastConnected] = useState<string | null>(null);
  const [connStatus, setConnStatus] = useState(getConnectionStatus());

  useEffect(() => {
    // Load saved settings from localStorage via vedadb-api
    setApiUrl(getApiBase());
    setApiKeyState(getApiKey());

    const saved = localStorage.getItem('vedadesk_conn_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.apiUrl) setApiUrl(parsed.apiUrl);
        if (parsed.apiKey) setApiKeyState(parsed.apiKey);
        setLastConnected(parsed.lastConnected || null);
      } catch { /* ignore */ }
    }
    const savedHistory = localStorage.getItem('vedadesk_conn_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch { /* ignore */ }
    }

    // Update status periodically
    const interval = setInterval(() => {
      setConnStatus(getConnectionStatus());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const saveConfig = useCallback(() => {
    setApiBase(apiUrl);
    setApiKey(apiKey);
    const config = { apiUrl, apiKey, lastConnected };
    localStorage.setItem('vedadesk_conn_settings', JSON.stringify(config));
    showToast('Configuration saved', 'success');
  }, [apiUrl, apiKey, lastConnected, showToast]);

  const testConnection = useCallback(async () => {
    setTestState('testing');
    // Apply current values before testing
    setApiBase(apiUrl);
    setApiKey(apiKey);

    try {
      const success = await vedaTestConnection();
      const status = getConnectionStatus();
      setConnStatus(status);

      if (success) {
        setTestState('success');
        const now = new Date().toISOString();
        setLastConnected(now);
        const entry: ConnHistory = {
          time: now,
          status: 'success',
          message: `Connected to ${apiUrl} (${status.latency}ms)`,
        };
        const newHistory = [entry, ...history].slice(0, 20);
        setHistory(newHistory);
        localStorage.setItem('vedadesk_conn_history', JSON.stringify(newHistory));
        localStorage.setItem('vedadesk_conn_settings', JSON.stringify({ apiUrl, apiKey, lastConnected: now }));
        showToast('Connection successful!', 'success');
        setTimeout(() => setTestState('idle'), 3000);
      } else {
        setTestState('failed');
        const entry: ConnHistory = {
          time: new Date().toISOString(),
          status: 'failed',
          message: `Failed to connect to ${apiUrl}`,
        };
        const newHistory = [entry, ...history].slice(0, 20);
        setHistory(newHistory);
        localStorage.setItem('vedadesk_conn_history', JSON.stringify(newHistory));
        showToast('Connection failed', 'error');
        setTimeout(() => setTestState('idle'), 3000);
      }
    } catch {
      setTestState('failed');
      showToast('Connection test error', 'error');
      setTimeout(() => setTestState('idle'), 3000);
    }
  }, [apiUrl, apiKey, history, showToast]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const isConnected = connStatus.connected;

  return (
    <div>
      <h2 className="text-2xl font-medium text-[#1f1f1f] tracking-tight">VedaDB Connection</h2>
      <p className="mt-1 text-sm text-[#595959]">Configure your VedaDB HTTP REST API connection.</p>

      {/* Connection Form */}
      <div className="mt-8 max-w-md space-y-5">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal flex items-center gap-1.5">
            <Globe size={14} /> API URL
          </Label>
          <Input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="http://localhost:9090"
            className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
          />
          <p className="text-xs text-[#8a8a8a]">VedaDB Workbench HTTP API endpoint</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal flex items-center gap-1.5">
            <KeyRound size={14} /> API Key
          </Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKeyState(e.target.value)}
            placeholder="Optional API key"
            className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
          />
          <p className="text-xs text-[#8a8a8a]">Optional authentication key for secured endpoints</p>
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
            <span className="ml-auto text-sm font-medium text-[#1f1f1f]">{connStatus.latency}ms</span>
          </div>

          <div className="flex items-center gap-3">
            <Activity size={14} className="text-[#8a8a8a]" />
            <span className="text-sm text-[#595959]">Last Connected</span>
            <span className="ml-auto text-sm font-medium text-[#1f1f1f]">
              {lastConnected ? formatTime(lastConnected) : 'Never'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Server size={14} className="text-[#8a8a8a]" />
            <span className="text-sm text-[#595959]">Endpoint</span>
            <span className="ml-auto text-sm font-medium text-[#1f1f1f]">{apiUrl}</span>
          </div>

          {connStatus.error && (
            <div className="flex items-center gap-3">
              <XCircle size={14} className="text-[#f5222d]" />
              <span className="text-sm text-[#595959]">Last Error</span>
              <span className="ml-auto text-sm font-medium text-[#f5222d]">{connStatus.error}</span>
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
