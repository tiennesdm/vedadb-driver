/**
 * VedaDB Connection Status Indicator Pill
 */
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import useAppStore from '@/lib/vedadb-store';
import { getConnectionStatus, getApiBase } from '@/lib/vedadb-api';

export default function VedaDBStatus() {
  const dbStatus = useAppStore((s) => s.dbStatus);
  const [latency, setLatency] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setLatency(getConnectionStatus().latency);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const apiUrl = getApiBase();

  const statusConfig = {
    connected: {
      dotClass: 'bg-[#52c41a] animate-pulse-dot',
      text: 'VedaDB Connected',
      textClass: 'text-[#52c41a]',
      bgClass: 'bg-[#f6ffed]',
    },
    connecting: {
      dotClass: 'bg-[#faad14] animate-pulse-dot-fast',
      text: 'Connecting...',
      textClass: 'text-[#faad14]',
      bgClass: 'bg-[#fff7e6]',
    },
    disconnected: {
      dotClass: 'bg-[#f5222d]',
      text: 'Disconnected',
      textClass: 'text-[#f5222d]',
      bgClass: 'bg-[#fff1f0]',
    },
  };

  const sc = statusConfig[dbStatus];

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 rounded-full px-3 py-1 text-xs transition-all',
          sc.bgClass
        )}
      >
        <span className={cn('h-2 w-2 rounded-full', sc.dotClass)} />
        <span className={cn('hidden font-medium lg:inline', sc.textClass)}>{sc.text}</span>
        {expanded ? (
          <ChevronUp size={12} className={sc.textClass} />
        ) : (
          <ChevronDown size={12} className={sc.textClass} />
        )}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-[#e5e0d5] bg-white p-3 shadow-dropdown">
          <img src="./vedadb-logo.svg" alt="VedaDB" className="mb-2 h-5 w-auto opacity-60" />
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-[#8a8a8a]">API URL</span>
              <span className="font-mono text-[#1f1f1f] truncate max-w-[120px]">{apiUrl}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8a8a8a]">Latency</span>
              <span className="font-mono text-[#1f1f1f]">{latency}ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8a8a8a]">Status</span>
              <span className={cn('font-medium capitalize', sc.textClass)}>{dbStatus}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
