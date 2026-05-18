/**
 * APIKeyCard - API key display with copy/regenerate
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Copy, RefreshCw, Eye, EyeOff, Trash2, Key } from 'lucide-react';

export interface APIKeyItem {
  id: string;
  name: string;
  key: string;
  prefix: string;
  scopes: ('read' | 'write' | 'admin')[];
  created: string;
  expires: string | null;
  lastUsed: string | null;
  status: 'active' | 'revoked' | 'expired';
  requestsToday: number;
}

interface APIKeyCardProps {
  apiKey: APIKeyItem;
  onCopy: (key: string) => void;
  onRegenerate: (id: string) => void;
  onRevoke: (id: string) => void;
  onToggleStatus: (id: string, active: boolean) => void;
}

export default function APIKeyCard({ apiKey, onCopy, onRegenerate, onRevoke, onToggleStatus }: APIKeyCardProps) {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy(apiKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const maskedKey = `${apiKey.prefix}...${apiKey.key.slice(-4)}`;
  const isActive = apiKey.status === 'active';

  const scopeColors = {
    read: 'bg-blue-50 text-blue-600 border-blue-100',
    write: 'bg-amber-50 text-amber-600 border-amber-100',
    admin: 'bg-red-50 text-red-600 border-red-100',
  };

  const statusColors = {
    active: 'bg-green-50 text-green-600',
    revoked: 'bg-red-50 text-red-600',
    expired: 'bg-gray-100 text-gray-500',
  };

  return (
    <Card className={cn('border-[#e5e0d5] bg-white transition-all', !isActive && 'opacity-60')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Header */}
            <div className="mb-2 flex items-center gap-2">
              <Key className="h-3.5 w-3.5 text-[#c9a87c]" />
              <span className="truncate text-sm font-medium text-[#1a1a1a]">{apiKey.name}</span>
              <Badge variant="secondary" className={cn('h-4 px-1 text-[10px]', statusColors[apiKey.status])}>
                {apiKey.status}
              </Badge>
            </div>

            {/* Key display */}
            <div className="mb-2 flex items-center gap-2">
              <code className="rounded bg-[#fbf9f4] px-2 py-0.5 font-mono text-xs text-[#595959]">
                {showKey ? apiKey.key : maskedKey}
              </code>
              <button
                onClick={() => setShowKey(!showKey)}
                className="rounded p-0.5 text-[#8a8a8a] hover:bg-[#fbf9f4] hover:text-[#1a1a1a]"
              >
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                onClick={handleCopy}
                className={cn(
                  'rounded p-0.5 transition-colors',
                  copied ? 'text-green-600' : 'text-[#8a8a8a] hover:bg-[#fbf9f4] hover:text-[#1a1a1a]'
                )}
                title="Copy"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>

            {/* Scopes */}
            <div className="mb-1.5 flex flex-wrap gap-1">
              {apiKey.scopes.map((scope) => (
                <Badge key={scope} variant="outline" className={cn('h-4 px-1 text-[10px]', scopeColors[scope])}>
                  {scope}
                </Badge>
              ))}
            </div>

            {/* Metadata */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#8a8a8a]">
              <span>Created: {apiKey.created}</span>
              {apiKey.expires && <span>Expires: {apiKey.expires}</span>}
              {apiKey.lastUsed && <span>Last used: {apiKey.lastUsed}</span>}
              <span className={apiKey.requestsToday > 100 ? 'text-amber-600 font-medium' : ''}>
                {apiKey.requestsToday} req today
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col items-end gap-1">
            <Switch
              checked={isActive}
              onCheckedChange={(v) => onToggleStatus(apiKey.id, v)}
              className="data-[state=checked]:bg-[#c9a87c]"
              
            />
            <Button
              variant="ghost"
              
              className="h-6 w-6 p-0 text-[#8a8a8a] hover:text-[#c9a87c]"
              onClick={() => onRegenerate(apiKey.id)}
              title="Regenerate"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              
              className="h-6 w-6 p-0 text-[#8a8a8a] hover:text-red-600"
              onClick={() => onRevoke(apiKey.id)}
              title="Revoke"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
