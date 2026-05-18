/**
 * MajorIncidents — Major incident declaration and coordination
 * Route: /major-incidents
 */
import { useState, useCallback } from 'react';
import useAppStore from '@/lib/vedadb-store';
import { usePermission } from '@/hooks/useRBAC';
import {
  Search, Plus, X, ChevronLeft, ChevronRight, Flag,
  Phone, MessageSquare, FileText, Clock, AlertTriangle,
  CheckCircle2, Radio, Send, Zap, Trash2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface MajorIncident {
  id: number;
  title: string;
  description: string;
  severity: string;
  status: string;
  bridge_line: string;
  war_room_url: string;
  commander: string;
  commander_name: string;
  impact_summary: string;
  started_at: string;
  resolved_at: string;
  post_incident_review: string;
  status_page_updates: string;
  created_at: string;
  updated_at: string;
}

interface CommunicationLog {
  id: number;
  major_incident_id: number;
  stakeholder: string;
  message: string;
  channel: string;
  sent_by: string;
  sent_at: string;
}

interface TimelineEvent {
  id: number;
  major_incident_id: number;
  timestamp: string;
  event: string;
  user_name?: string;
}

const STATUS_FLOW = ['Active', 'Contained', 'Resolved', 'Post-Review', 'Closed'];
const SEVERITY_OPTIONS = ['Critical', 'High', 'Medium'];

export default function MajorIncidents() {
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const canEdit = usePermission('ticket:edit:all' as any);

  const [incidents, setIncidents] = useState<MajorIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter] = useState('');
  const PAGE_SIZE = 10;

  const [formOpen, setFormOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<MajorIncident | null>(null);
  const [commsOpen, setCommsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [pirOpen, setPirOpen] = useState(false);

  const [formData, setFormData] = useState({
    title: '', description: '', severity: 'Critical', bridge_line: '',
    war_room_url: '', impact_summary: '',
  });

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    try {
      let where = '1=1';
      if (searchInput) where += ` AND (title LIKE '%${searchInput}%' OR description LIKE '%${searchInput}%')`;
      if (statusFilter) where += ` AND status = '${statusFilter}'`;
      const offset = (page - 1) * PAGE_SIZE;
      const result = await query(`SELECT m.*, u.name as commander_name FROM major_incidents m LEFT JOIN users u ON m.commander = u.id WHERE ${where} ORDER BY m.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      setIncidents(result.toObjects() as unknown as MajorIncident[]);
      const cr = await query(`SELECT COUNT(*) as c FROM major_incidents WHERE ${where}`);
      setTotalCount(parseInt(cr.toObjects()[0]?.c || '0', 10));
    } catch {
      setIncidents([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [query, searchInput, statusFilter, page]);

  const [initialized, setInitialized] = useState(false);
  if (!initialized) {
    setInitialized(true);
    fetchIncidents();
  }

  const openCreate = () => {
    setFormData({ title: '', description: '', severity: 'Critical', bridge_line: '', war_room_url: '', impact_summary: '' });
    setFormOpen(true);
  };

  const handleCreate = async () => {
    const data: Record<string, string | null> = {
      ...formData,
      status: 'Active',
      commander: String(useAppStore.getState().currentUser?.id || ''),
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await insert('major_incidents', data);
    setFormOpen(false);
    fetchIncidents();
  };

  const advanceStatus = async (id: number, currentStatus: string) => {
    const idx = STATUS_FLOW.indexOf(currentStatus);
    if (idx < STATUS_FLOW.length - 1) {
      const updates: Record<string, string> = { status: STATUS_FLOW[idx + 1], updated_at: new Date().toISOString() };
      if (STATUS_FLOW[idx + 1] === 'Resolved') updates.resolved_at = new Date().toISOString();
      await update('major_incidents', updates, { id });
      fetchIncidents();
    }
  };

  const handleDelete = async (id: number) => {
    await deleteFrom('major_incidents', { id });
    fetchIncidents();
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const startItem = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);

  const severityColors: Record<string, string> = { 'Critical': '#f5222d', 'High': '#faad14', 'Medium': '#fa8c16' };
  const statusColors: Record<string, string> = { 'Active': '#f5222d', 'Contained': '#faad14', 'Resolved': '#52c41a', 'Post-Review': '#1890ff', 'Closed': '#8a8a8a' };

  const sampleComms: CommunicationLog[] = [
    { id: 1, major_incident_id: 1, stakeholder: 'Executive Team', message: 'Incident declared, investigating', channel: 'Email', sent_by: 'Incident Commander', sent_at: '2024-01-15T09:00:00' },
    { id: 2, major_incident_id: 1, stakeholder: 'All Staff', message: 'Service degradation on main app', channel: 'Slack', sent_by: 'Incident Commander', sent_at: '2024-01-15T09:15:00' },
  ];

  const sampleTimeline: TimelineEvent[] = [
    { id: 1, major_incident_id: 1, timestamp: '2024-01-15T08:30:00', event: 'Alert triggered - High error rate', user_name: 'Monitoring' },
    { id: 2, major_incident_id: 1, timestamp: '2024-01-15T08:45:00', event: 'Major incident declared', user_name: 'On-call Engineer' },
    { id: 3, major_incident_id: 1, timestamp: '2024-01-15T09:00:00', event: 'War room convened', user_name: 'Incident Commander' },
    { id: 4, major_incident_id: 1, timestamp: '2024-01-15T10:30:00', event: 'Root cause identified - DB failover', user_name: 'DBA Team' },
    { id: 5, major_incident_id: 1, timestamp: '2024-01-15T11:00:00', event: 'Service restored', user_name: 'Engineering' },
  ];

  const stats = {
    active: incidents.filter((i) => i.status === 'Active').length,
    contained: incidents.filter((i) => i.status === 'Contained').length,
    resolved: incidents.filter((i) => i.status === 'Resolved' || i.status === 'Post-Review' || i.status === 'Closed').length,
  };

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f5222d]">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[#1f1f1f]">Major Incidents</h2>
              <p className="text-xs text-[#8a8a8a]">War Room & Post-Incident Reviews</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
              <input value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setPage(1); }} placeholder="Search incidents..." className="h-9 w-full rounded-lg border border-[#e5e0d5] bg-white py-1 pl-9 pr-8 text-sm outline-none focus:border-[#c9a87c]" />
              {searchInput && <button onClick={() => { setSearchInput(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8a8a]"><X size={14} /></button>}
            </div>
            {canEdit && (
              <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-[#f5222d] px-3 py-2 text-sm font-medium text-white hover:bg-[#d91f36]">
                <Plus size={16} /> <span className="hidden sm:inline">Declare MI</span>
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <Radio size={14} className="text-[#f5222d]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Active</p><p className="text-sm font-bold text-[#1f1f1f]">{stats.active}</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <AlertTriangle size={14} className="text-[#faad14]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Contained</p><p className="text-sm font-bold text-[#1f1f1f]">{stats.contained}</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <CheckCircle2 size={14} className="text-[#52c41a]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Resolved</p><p className="text-sm font-bold text-[#1f1f1f]">{stats.resolved}</p></div>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#e5e0d5] border-t-[#c9a87c]" /></div>
      ) : incidents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-[#e5e0d5] bg-white">
          <Flag size={48} className="mb-4 text-[#e5e0d5]" />
          <h3 className="text-lg font-medium text-[#1f1f1f]">No major incidents</h3>
          <p className="text-sm text-[#8a8a8a]">Declare a major incident when critical services are impacted</p>
        </div>
      ) : (
        <div className="space-y-2">
          {incidents.map((inc) => (
            <div key={inc.id} className="rounded-xl border border-[#e5e0d5] bg-white p-4 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-[#1f1f1f]">{inc.title}</h3>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: severityColors[inc.severity] || '#8a8a8a' }}>{inc.severity}</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: statusColors[inc.status] || '#8a8a8a' }}>{inc.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#595959] line-clamp-2">{inc.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[#8a8a8a]">
                    <span className="font-mono">MI-{String(inc.id).padStart(4, '0')}</span>
                    <span className="flex items-center gap-1"><Flag size={10} /> {inc.commander_name || 'Unassigned'}</span>
                    {inc.bridge_line && <span className="flex items-center gap-1"><Phone size={10} /> {inc.bridge_line}</span>}
                    {inc.started_at && <span className="flex items-center gap-1"><Clock size={10} /> Started {new Date(inc.started_at).toLocaleString()}</span>}
                    {inc.resolved_at && <span className="flex items-center gap-1"><CheckCircle2 size={10} /> Resolved {new Date(inc.resolved_at).toLocaleString()}</span>}
                  </div>
                  {inc.impact_summary && (
                    <div className="mt-2 rounded-lg bg-[#fff2f0] border border-[#ffccc7] px-3 py-1.5">
                      <p className="text-[10px] font-semibold text-[#f5222d] uppercase">Impact</p>
                      <p className="text-xs text-[#1f1f1f]">{inc.impact_summary}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  <button onClick={() => { setSelectedIncident(inc); setCommsOpen(true); }} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#f5f0e8]" title="Communications">
                    <MessageSquare size={14} />
                  </button>
                  <button onClick={() => { setSelectedIncident(inc); setTimelineOpen(true); }} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#f5f0e8]" title="Timeline">
                    <Clock size={14} />
                  </button>
                  <button onClick={() => { setSelectedIncident(inc); setPirOpen(true); }} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#f5f0e8]" title="PIR">
                    <FileText size={14} />
                  </button>
                  {canEdit && inc.status !== 'Closed' && (
                    <button onClick={() => advanceStatus(inc.id, inc.status)} className="rounded p-1.5 text-[#52c41a] hover:bg-[#f6ffed]" title="Advance">
                      <CheckCircle2 size={14} />
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => handleDelete(inc.id)} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#fff2f0] hover:text-[#f5222d]">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[#e5e0d5] bg-white px-4 py-3">
          <div className="text-xs text-[#8a8a8a]">Showing {startItem}–{endItem} of {totalCount}</div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg border border-[#e5e0d5] p-1.5 disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="text-xs text-[#595959] px-2">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="rounded-lg border border-[#e5e0d5] p-1.5 disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {/* Declare MI Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg">
          <DialogHeader><DialogTitle className="text-[#1f1f1f] flex items-center gap-2"><AlertTriangle size={18} className="text-[#f5222d]" /> Declare Major Incident</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div><label className="text-xs font-medium text-[#595959]">Title *</label><input value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="e.g., Database cluster outage" /></div>
            <div><label className="text-xs font-medium text-[#595959]">Description</label><textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={3} placeholder="What's happening..." /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Severity</label><select value={formData.severity} onChange={(e) => setFormData({ ...formData, severity: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              <div><label className="text-xs font-medium text-[#595959]">Bridge Line</label><input value={formData.bridge_line} onChange={(e) => setFormData({ ...formData, bridge_line: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="+1-800-..." /></div>
            </div>
            <div><label className="text-xs font-medium text-[#595959]">War Room URL</label><input value={formData.war_room_url} onChange={(e) => setFormData({ ...formData, war_room_url: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="https://meet.example.com/..." /></div>
            <div><label className="text-xs font-medium text-[#595959]">Impact Summary</label><textarea value={formData.impact_summary} onChange={(e) => setFormData({ ...formData, impact_summary: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={2} placeholder="Who and what is affected..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleCreate} disabled={!formData.title} className="bg-[#f5222d] text-white hover:bg-[#d91f36]">Declare Major Incident</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Communications Dialog */}
      <Dialog open={commsOpen} onOpenChange={setCommsOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">Communications — MI-{String(selectedIncident?.id).padStart(4, '0')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {sampleComms.map((comm) => (
              <div key={comm.id} className="rounded-lg border border-[#e5e0d5] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#1f1f1f]">{comm.stakeholder}</span>
                  <span className="rounded-full bg-[#f5f0e8] px-2 py-0.5 text-[10px] text-[#595959]">{comm.channel}</span>
                </div>
                <p className="mt-1 text-xs text-[#595959]">{comm.message}</p>
                <p className="mt-1 text-[10px] text-[#8a8a8a]">{new Date(comm.sent_at).toLocaleString()}</p>
              </div>
            ))}
            {canEdit && (
              <div className="flex gap-2">
                <input className="flex-1 rounded-lg border border-[#e5e0d5] px-3 py-2 text-xs outline-none focus:border-[#c9a87c]" placeholder="New message..." />
                <Button size="sm" className="bg-[#c9a87c] text-white hover:bg-[#b8986c]"><Send size={14} /></Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Timeline Dialog */}
      <Dialog open={timelineOpen} onOpenChange={setTimelineOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">Incident Timeline — MI-{String(selectedIncident?.id).padStart(4, '0')}</DialogTitle></DialogHeader>
          <div className="space-y-0 py-2">
            {[...sampleTimeline].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((evt, idx, arr) => (
              <div key={evt.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: idx === 0 ? '#f5222d20' : '#f5f0e8' }}>
                    <Clock size={12} style={{ color: idx === 0 ? '#f5222d' : '#c9a87c' }} />
                  </div>
                  {idx < arr.length - 1 && <div className="mt-1 w-0.5 flex-1 bg-[#e5e0d5]" />}
                </div>
                <div className="pb-4">
                  <p className="text-xs font-medium text-[#1f1f1f]">{evt.event}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#8a8a8a]">
                    <span>{new Date(evt.timestamp).toLocaleString()}</span>
                    {evt.user_name && <span>by {evt.user_name}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* PIR Dialog */}
      <Dialog open={pirOpen} onOpenChange={setPirOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">Post-Incident Review — MI-{String(selectedIncident?.id).padStart(4, '0')}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-[#fbf9f4] p-3">
              <p className="text-[10px] font-semibold text-[#595959] uppercase mb-1">Incident Summary</p>
              <p className="text-xs text-[#1f1f1f]">{selectedIncident?.description || 'No summary recorded'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[#fbf9f4] p-3">
                <p className="text-[10px] font-semibold text-[#595959] uppercase mb-1">What Went Well</p>
                <textarea className="w-full rounded-md border border-[#e5e0d5] px-2 py-1 text-xs outline-none focus:border-[#c9a87c]" rows={3} placeholder="Positive aspects..." defaultValue={"Quick detection via monitoring\nWar room convened promptly"} />
              </div>
              <div className="rounded-lg bg-[#fff2f0] border border-[#ffccc7] p-3">
                <p className="text-[10px] font-semibold text-[#f5222d] uppercase mb-1">What Went Wrong</p>
                <textarea className="w-full rounded-md border border-[#ffccc7] px-2 py-1 text-xs outline-none focus:border-[#f5222d]" rows={3} placeholder="Issues encountered..." defaultValue={"DB failover took too long\nRunbook was outdated"} />
              </div>
            </div>
            <div className="rounded-lg bg-[#f6ffed] border border-[#b7eb8f] p-3">
              <p className="text-[10px] font-semibold text-[#52c41a] uppercase mb-1">Action Items</p>
              <textarea className="w-full rounded-md border border-[#b7eb8f] px-2 py-1 text-xs outline-none focus:border-[#52c41a]" rows={3} placeholder="Follow-up actions..." defaultValue={"1. Update DB failover runbook\n2. Add automated failover tests\n3. Review connection pool settings"} />
            </div>
            <div className="rounded-lg bg-[#fbf9f4] p-3">
              <p className="text-[10px] font-semibold text-[#595959] uppercase mb-1">Status Page Updates</p>
              <textarea
                className="w-full rounded-md border border-[#e5e0d5] px-2 py-1 text-xs outline-none focus:border-[#c9a87c]"
                rows={2}
                defaultValue={selectedIncident?.status_page_updates || "Investigating - Service degradation reported.\nResolved - All services restored."}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPirOpen(false)} className="border-[#e5e0d5] text-[#595959]">Close</Button>
            <Button onClick={() => setPirOpen(false)} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">Save PIR</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
