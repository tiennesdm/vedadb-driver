/**
 * VedaDB Connection Status Indicator — Enhanced
 * Shows real-time connection status, endpoint, API key, and latency
 */
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Database, Wifi, WifiOff, RefreshCw, Key, Globe, Zap, Clock, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import useAppStore from '@/lib/vedadb-store';
import { getConnectionStatus, getApiBase, getApiKey, vedaTestConnection } from '@/lib/vedadb-api';

export default function VedaDBStatus() {
  const dbStatus = useAppStore((s) => s.dbStatus);
  const [latency, setLatency] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastTested, setLastTested] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const interval = setInterval(() => {
      const status = getConnectionStatus();
      setLatency(status.latency);
      if (status.error) setError(status.error);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const apiUrl = getApiBase();
  const apiKey = getApiKey();
  const hasKey = apiKey.length > 0;

  const handleTestConnection = async () => {
    setTesting(true);
    setError('');
    try {
      const ok = await vedaTestConnection();
      setLastTested(new Date().toLocaleTimeString());
      if (!ok) setError('Connection failed. Check API URL and server status.');
    } catch (e: any) {
      setError(e.message || 'Connection failed');
    }
    setTesting(false);
  };

  const statusConfig = {
    connected: {
      dotClass: 'bg-[#52c41a] animate-pulse',
      icon: <Wifi size={14} className="text-[#52c41a]" />,
      text: 'VedaDB Connected',
      textClass: 'text-[#52c41a]',
      bgClass: 'bg-[#f6ffed] border-[#b7eb8f]',
    },
    connecting: {
      dotClass: 'bg-[#faad14] animate-pulse',
      icon: <RefreshCw size={14} className="text-[#faad14] animate-spin" />,
      text: 'Connecting...',
      textClass: 'text-[#d48806]',
      bgClass: 'bg-[#fff7e6] border-[#ffd591]',
    },
    disconnected: {
      dotClass: 'bg-[#f5222d]',
      icon: <WifiOff size={14} className="text-[#f5222d]" />,
      text: 'VedaDB Disconnected',
      textClass: 'text-[#cf1322]',
      bgClass: 'bg-[#fff1f0] border-[#ffa39e]',
    },
  };

  const sc = statusConfig[dbStatus];

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-all border',
          sc.bgClass,
          'hover:shadow-md'
        )}
      >
        <span className={cn('h-2.5 w-2.5 rounded-full', sc.dotClass)} />
        <Database size={14} className={sc.textClass} />
        <span className={cn('hidden font-medium md:inline', sc.textClass)}>{sc.text}</span>
        <span className={cn('hidden lg:inline font-mono text-[10px]', sc.textClass)}>
          {dbStatus === 'connected' && `${latency}ms`}
        </span>
        {expanded ? (
          <ChevronUp size={12} className={sc.textClass} />
        ) : (
          <ChevronDown size={12} className={sc.textClass} />
        )}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[#e5e0d5] bg-white p-4 shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[#e5e0d5]">
            <Database size={18} className="text-[#c9a87c]" />
            <span className="font-semibold text-sm text-[#1f1f1f]">VedaDB Connection</span>
            {dbStatus === 'connected' ? (
              <CheckCircle size={16} className="text-[#52c41a] ml-auto" />
            ) : (
              <XCircle size={16} className="text-[#f5222d] ml-auto" />
            )}
          </div>

          {/* Connection Details */}
          <div className="space-y-3 text-xs">
            {/* Endpoint URL */}
            <div className="bg-[#fbf9f4] rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Globe size={12} className="text-[#8a8a8a]" />
                <span className="text-[#8a8a8a] uppercase tracking-wider font-medium">Endpoint URL</span>
              </div>
              <div className="font-mono text-[#1f1f1f] break-all text-[11px] bg-white rounded px-2 py-1 border border-[#e5e0d5]">
                {apiUrl}
              </div>
            </div>

            {/* API Key */}
            <div className="bg-[#fbf9f4] rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Key size={12} className="text-[#8a8a8a]" />
                <span className="text-[#8a8a8a] uppercase tracking-wider font-medium">API Key</span>
              </div>
              <div className="font-mono text-[#1f1f1f] text-[11px] bg-white rounded px-2 py-1 border border-[#e5e0d5]">
                {hasKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'Not configured'}
              </div>
            </div>

            {/* Status Row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#fbf9f4] rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap size={12} className="text-[#8a8a8a]" />
                  <span className="text-[#8a8a8a]">Latency</span>
                </div>
                <span className="font-mono font-semibold text-[#1f1f1f]">{latency > 0 ? `${latency}ms` : '—'}</span>
              </div>
              <div className="bg-[#fbf9f4] rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock size={12} className="text-[#8a8a8a]" />
                  <span className="text-[#8a8a8a]">Last Tested</span>
                </div>
                <span className="font-mono text-[#1f1f1f]">{lastTested || 'Never'}</span>
              </div>
            </div>

            {/* Status Badge */}
            <div className={cn(
              'rounded-lg p-2.5 text-center font-medium',
              dbStatus === 'connected' ? 'bg-[#f6ffed] text-[#52c41a]' :
              dbStatus === 'connecting' ? 'bg-[#fff7e6] text-[#faad14]' :
              'bg-[#fff1f0] text-[#f5222d]'
            )}>
              <div className="flex items-center justify-center gap-2">
                {dbStatus === 'connected' ? <CheckCircle size={14} /> : dbStatus === 'connecting' ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />}
                <span className="capitalize">{dbStatus}</span>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-[#fff1f0] border border-[#ffa39e] rounded-lg p-2.5 text-[#cf1322] text-[11px]">
                {error}
              </div>
            )}

            {/* Test Button */}
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                testing
                  ? 'bg-[#f5f0e8] text-[#8a8a8a] cursor-wait'
                  : 'bg-[#c9a87c] text-white hover:bg-[#b8976b] active:scale-[0.98]'
              )}
            >
              {testing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {testing ? 'Testing...' : 'Test Connection'}
            </button>

            {/* Settings Link */}
            <a
              href="#/settings"
              onClick={() => setExpanded(false)}
              className="block text-center text-[11px] text-[#c9a87c] hover:text-[#b8976b] hover:underline"
            >
              Configure in Settings →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
