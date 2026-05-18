/**
 * Audit Logs — Full audit trail with filtering, search, pagination,
 * and CSV export. Color-coded action types for quick scanning.
 */
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ScrollText,
  Search,
  Download,
  UserCircle,
  Calendar,
  Filter,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AuditLog {
  id: number;
  timestamp: string;
  userName: string;
  userAvatar?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT';
  entityType: string;
  entityId: string;
  details: string;
  oldValue?: string;
  newValue?: string;
  ipAddress: string;
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const MOCK_AUDIT_LOGS: AuditLog[] = [
  { id: 1, timestamp: '2024-12-04T10:32:15Z', userName: 'John Doe', action: 'UPDATE', entityType: 'Ticket', entityId: 'T-1042', details: 'Changed status from Open to In Progress', oldValue: 'Open', newValue: 'In Progress', ipAddress: '192.168.1.45' },
  { id: 2, timestamp: '2024-12-04T10:28:00Z', userName: 'Sarah Chen', action: 'CREATE', entityType: 'Ticket', entityId: 'T-1051', details: 'Created new ticket: VPN access request', ipAddress: '192.168.1.12' },
  { id: 3, timestamp: '2024-12-04T10:15:42Z', userName: 'Mike Ross', action: 'DELETE', entityType: 'Canned Response', entityId: 'CR-23', details: 'Deleted outdated onboarding template', ipAddress: '192.168.1.78' },
  { id: 4, timestamp: '2024-12-04T09:58:10Z', userName: 'Emily Wang', action: 'UPDATE', entityType: 'User', entityId: 'U-89', details: 'Updated role from Agent to Admin', oldValue: 'Agent', newValue: 'Admin', ipAddress: '192.168.1.33' },
  { id: 5, timestamp: '2024-12-04T09:45:00Z', userName: 'David Kim', action: 'LOGIN', entityType: 'Session', entityId: 'S-4412', details: 'Successful login from web portal', ipAddress: '192.168.1.55' },
  { id: 6, timestamp: '2024-12-04T09:30:22Z', userName: 'John Doe', action: 'CREATE', entityType: 'Department', entityId: 'D-7', details: 'Created new department: Data Science', ipAddress: '192.168.1.45' },
  { id: 7, timestamp: '2024-12-04T09:12:05Z', userName: 'Sarah Chen', action: 'EXPORT', entityType: 'Report', entityId: 'R-98', details: 'Exported ticket volume report (CSV)', ipAddress: '192.168.1.12' },
  { id: 8, timestamp: '2024-12-04T08:55:18Z', userName: 'Mike Ross', action: 'UPDATE', entityType: 'SLA Policy', entityId: 'SLA-3', details: 'Updated resolution time from 24h to 12h', oldValue: '1440m', newValue: '720m', ipAddress: '192.168.1.78' },
  { id: 9, timestamp: '2024-12-04T08:40:00Z', userName: 'Emily Wang', action: 'CREATE', entityType: 'Announcement', entityId: 'A-15', details: 'Posted maintenance announcement', ipAddress: '192.168.1.33' },
  { id: 10, timestamp: '2024-12-04T08:22:33Z', userName: 'John Doe', action: 'DELETE', entityType: 'Automation Rule', entityId: 'AR-5', details: 'Removed obsolete auto-assignment rule', ipAddress: '192.168.1.45' },
  { id: 11, timestamp: '2024-12-04T08:10:00Z', userName: 'David Kim', action: 'UPDATE', entityType: 'Ticket', entityId: 'T-1038', details: 'Reassigned from Emily to David', oldValue: 'Emily Wang', newValue: 'David Kim', ipAddress: '192.168.1.55' },
  { id: 12, timestamp: '2024-12-04T07:58:45Z', userName: 'Sarah Chen', action: 'CREATE', entityType: 'Canned Response', entityId: 'CR-29', details: 'Added password reset template', ipAddress: '192.168.1.12' },
  { id: 13, timestamp: '2024-12-04T07:42:00Z', userName: 'Mike Ross', action: 'LOGIN', entityType: 'Session', entityId: 'S-4411', details: 'Successful login from mobile app', ipAddress: '10.0.0.15' },
  { id: 14, timestamp: '2024-12-04T07:30:10Z', userName: 'Emily Wang', action: 'UPDATE', entityType: 'Service Catalog', entityId: 'SC-12', details: 'Updated fulfillment time for laptop request', oldValue: '3 days', newValue: '2 days', ipAddress: '192.168.1.33' },
  { id: 15, timestamp: '2024-12-04T07:15:00Z', userName: 'John Doe', action: 'EXPORT', entityType: 'Audit Log', entityId: 'LOG-2024', details: 'Exported full audit log for compliance review', ipAddress: '192.168.1.45' },
  { id: 16, timestamp: '2024-12-03T18:22:00Z', userName: 'David Kim', action: 'CREATE', entityType: 'Ticket', entityId: 'T-1050', details: 'Created new ticket: Email server slow', ipAddress: '192.168.1.55' },
  { id: 17, timestamp: '2024-12-03T17:45:30Z', userName: 'Sarah Chen', action: 'UPDATE', entityType: 'Announcement', entityId: 'A-14', details: 'Extended maintenance window by 2 hours', oldValue: 'Dec 8 02:00-04:00 UTC', newValue: 'Dec 8 02:00-06:00 UTC', ipAddress: '192.168.1.12' },
  { id: 18, timestamp: '2024-12-03T16:30:00Z', userName: 'Mike Ross', action: 'DELETE', entityType: 'Department', entityId: 'D-4', details: 'Archived inactive temp department', ipAddress: '192.168.1.78' },
  { id: 19, timestamp: '2024-12-03T15:55:12Z', userName: 'Emily Wang', action: 'CREATE', entityType: 'Automation Rule', entityId: 'AR-8', details: 'Created escalation rule for critical tickets', ipAddress: '192.168.1.33' },
  { id: 20, timestamp: '2024-12-03T14:40:00Z', userName: 'John Doe', action: 'UPDATE', entityType: 'User', entityId: 'U-92', details: 'Disabled account for offboarding', oldValue: 'Active', newValue: 'Inactive', ipAddress: '192.168.1.45' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const ACTION_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  CREATE: { color: '#52c41a', bg: '#f6ffed', icon: <Plus className="w-3 h-3" /> },
  UPDATE: { color: '#1890ff', bg: '#e6f7ff', icon: <Pencil className="w-3 h-3" /> },
  DELETE: { color: '#f5222d', bg: '#fff1f0', icon: <Trash2 className="w-3 h-3" /> },
  LOGIN: { color: '#722ed1', bg: '#f9f0ff', icon: <UserCircle className="w-3 h-3" /> },
  EXPORT: { color: '#faad14', bg: '#fffbe6', icon: <Download className="w-3 h-3" /> },
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function downloadAuditCSV(logs: AuditLog[]) {
  const rows = logs.map((l) => ({
    Timestamp: l.timestamp,
    User: l.userName,
    Action: l.action,
    'Entity Type': l.entityType,
    'Entity ID': l.entityId,
    Details: l.details,
    'Old Value': l.oldValue ?? '',
    'New Value': l.newValue ?? '',
    IP: l.ipAddress,
  }));
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => `"${String(row[h as keyof typeof row]).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function AuditLogs() {
  const [logs] = useState<AuditLog[]>(MOCK_AUDIT_LOGS);
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  const allUsers = useMemo(() => [...new Set(logs.map((l) => l.userName))], [logs]);
  const allEntities = useMemo(() => [...new Set(logs.map((l) => l.entityType))], [logs]);

  const filteredLogs = useMemo(() => {
    return logs
      .filter((l) => {
        if (userFilter !== 'all' && l.userName !== userFilter) return false;
        if (actionFilter !== 'all' && l.action !== actionFilter) return false;
        if (entityFilter !== 'all' && l.entityType !== entityFilter) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return (
            l.userName.toLowerCase().includes(q) ||
            l.entityId.toLowerCase().includes(q) ||
            l.details.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [logs, userFilter, actionFilter, entityFilter, searchQuery]);

  const totalPages = Math.ceil(filteredLogs.length / pageSize);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <ScrollText className="w-6 h-6" style={{ color: '#c9a87c' }} />
            Audit Logs
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Complete activity trail for compliance and security
          </p>
        </div>
        <Button
          onClick={() => downloadAuditCSV(filteredLogs)}
          variant="outline"
          className="rounded-lg border-[#e5e0d5]"
          style={{ background: '#ffffff' }}
        >
          <Download className="w-4 h-4 mr-1" /> Export CSV
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="mb-6" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium text-[#1f1f1f]">
            <Filter className="w-4 h-4" style={{ color: '#c9a87c' }} /> Filters
          </div>
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#595959' }} />
              <Input
                placeholder="Search by user or entity ID..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="pl-9 rounded-lg border-[#e5e0d5]"
              />
            </div>
            <Select value={userFilter} onValueChange={(v) => { setUserFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[150px] rounded-lg border-[#e5e0d5]">
                <UserCircle className="w-4 h-4 mr-1" style={{ color: '#c9a87c' }} />
                <SelectValue placeholder="User" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {allUsers.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[150px] rounded-lg border-[#e5e0d5]">
                <RefreshCw className="w-4 h-4 mr-1" style={{ color: '#c9a87c' }} />
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="CREATE">CREATE</SelectItem>
                <SelectItem value="UPDATE">UPDATE</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
                <SelectItem value="LOGIN">LOGIN</SelectItem>
                <SelectItem value="EXPORT">EXPORT</SelectItem>
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[160px] rounded-lg border-[#e5e0d5]">
                <Calendar className="w-4 h-4 mr-1" style={{ color: '#c9a87c' }} />
                <SelectValue placeholder="Entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {allEntities.map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Table */}
      <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-[#1f1f1f]">
            {filteredLogs.length} audit entries found
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e0d5' }}>
                  <th className="text-left py-3 px-2 font-medium text-[#595959] w-[140px]">Timestamp</th>
                  <th className="text-left py-3 px-2 font-medium text-[#595959]">User</th>
                  <th className="text-center py-3 px-2 font-medium text-[#595959] w-[100px]">Action</th>
                  <th className="text-left py-3 px-2 font-medium text-[#595959]">Entity</th>
                  <th className="text-left py-3 px-2 font-medium text-[#595959]">Details</th>
                  <th className="text-left py-3 px-2 font-medium text-[#595959] w-[120px]">Changes</th>
                  <th className="text-right py-3 px-2 font-medium text-[#595959] w-[100px]">IP Address</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.map((log, idx) => {
                  const config = ACTION_CONFIG[log.action] || ACTION_CONFIG.UPDATE;
                  return (
                    <motion.tr
                      key={log.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      className="hover:bg-[#f5f0e8]/50 transition-colors"
                      style={{ borderBottom: '1px solid #e5e0d5' }}
                    >
                      <td className="py-3 px-2 text-xs whitespace-nowrap" style={{ color: '#595959' }}>
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <Avatar className="w-6 h-6">
                            <AvatarFallback className="text-[10px] font-medium" style={{ background: '#c9a87c20', color: '#c9a87c' }}>
                              {log.userName.split(' ').map((n) => n[0]).join('')}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-[#1f1f1f]">{log.userName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <Badge
                          className="gap-1"
                          style={{ background: config.bg, color: config.color, border: `1px solid ${config.color}30` }}
                        >
                          {config.icon} {log.action}
                        </Badge>
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-[#1f1f1f]">{log.entityType}</span>
                        <span className="block text-xs" style={{ color: '#595959' }}>{log.entityId}</span>
                      </td>
                      <td className="py-3 px-2 max-w-[300px] truncate" style={{ color: '#595959' }}>
                        {log.details}
                      </td>
                      <td className="py-3 px-2">
                        {log.oldValue && log.newValue ? (
                          <div className="flex items-center gap-1 text-xs">
                            <span className="line-through" style={{ color: '#f5222d' }}>{log.oldValue}</span>
                            <ArrowRight className="w-3 h-3" style={{ color: '#595959' }} />
                            <span style={{ color: '#52c41a' }}>{log.newValue}</span>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: '#8c8c8c' }}>—</span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right text-xs font-mono" style={{ color: '#595959' }}>
                        {log.ipAddress}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {paginatedLogs.length === 0 && (
            <div className="text-center py-12 text-sm" style={{ color: '#595959' }}>
              No audit logs match your filters.
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: '1px solid #e5e0d5' }}>
              <span className="text-xs" style={{ color: '#595959' }}>
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="rounded-lg border-[#e5e0d5]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <Button
                    key={page}
                    variant={currentPage === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className="rounded-lg w-8 h-8 p-0"
                    style={currentPage === page ? { background: '#c9a87c', color: '#fff', borderColor: '#c9a87c' } : { borderColor: '#e5e0d5' }}
                  >
                    {page}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded-lg border-[#e5e0d5]"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
