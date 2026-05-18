/**
 * WebhookDeliveryLog - Webhook delivery history table
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, XCircle, RefreshCw, Clock } from 'lucide-react';

export interface DeliveryEntry {
  id: string;
  timestamp: string;
  event: string;
  status: 'success' | 'failed' | 'retrying' | 'pending';
  responseCode: number;
  retryCount: number;
  duration: number;
  payload: string;
}

interface WebhookDeliveryLogProps {
  entries: DeliveryEntry[];
}

export default function WebhookDeliveryLog({ entries }: WebhookDeliveryLogProps) {
  const statusConfig: Record<string, { icon: React.ElementType; variant: string; label: string }> = {
    success: { icon: CheckCircle, variant: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Success' },
    failed: { icon: XCircle, variant: 'bg-red-100 text-red-700 border-red-200', label: 'Failed' },
    retrying: { icon: RefreshCw, variant: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Retrying' },
    pending: { icon: Clock, variant: 'bg-gray-100 text-gray-700 border-gray-200', label: 'Pending' },
  };

  return (
    <ScrollArea className="h-[400px]">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-[#e5e0d5]">
            <TableHead className="text-xs text-[#8a8a8a]">Timestamp</TableHead>
            <TableHead className="text-xs text-[#8a8a8a]">Event</TableHead>
            <TableHead className="text-xs text-[#8a8a8a]">Status</TableHead>
            <TableHead className="text-xs text-[#8a8a8a]">Response</TableHead>
            <TableHead className="text-xs text-[#8a8a8a]">Retries</TableHead>
            <TableHead className="text-xs text-[#8a8a8a]">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-[#8a8a8a] py-8">
                No delivery logs yet
              </TableCell>
            </TableRow>
          )}
          {entries.map((entry) => {
            const config = statusConfig[entry.status];
            const StatusIcon = config.icon;
            return (
              <TableRow key={entry.id} className="border-b border-[#f0ece3]">
                <TableCell className="text-xs text-[#595959] font-mono">
                  {entry.timestamp}
                </TableCell>
                <TableCell className="text-xs text-[#262626]">
                  {entry.event}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-5 ${config.variant}`}
                  >
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {config.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-[#595959] font-mono">
                  {entry.responseCode || '-'}
                </TableCell>
                <TableCell className="text-xs text-[#595959]">
                  {entry.retryCount}/3
                </TableCell>
                <TableCell className="text-xs text-[#595959]">
                  {entry.duration}ms
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
