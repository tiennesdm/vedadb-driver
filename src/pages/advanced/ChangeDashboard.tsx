/**
 * ChangeDashboard — ITIL Change Management
 * Route: /changes
 */
import { useState, useCallback } from 'react';
import useAppStore from '@/lib/vedadb-store';
import { usePermission } from '@/hooks/useRBAC';
import ChangeCalendar from '@/components/advanced/ChangeCalendar';
import RiskMatrix from '@/components/advanced/RiskMatrix';
import CABPanel from '@/components/advanced/CABPanel';
import {
  Search, Plus, X, Filter, ChevronLeft, ChevronRight, RotateCcw,
  Trash2, Pencil, ShieldAlert, ShieldCheck, Clock,
  CheckCircle2, CalendarDays,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const CHANGE_TYPES = ['Standard', 'Normal', 'Emergency'];
const RISK_LEVELS = ['Low', 'Medium', 'High'];
const STATUS_FLOW = ['Pending', 'CAB Review', 'Approved', 'Scheduled', 'Implementing', 'Review', 'Closed'];

interface ChangeRequest {
  id: number;
  title: string;
  description: string;
  change_type: string;
  risk_level: string;
  impact: string;
  urgency: string;
  status: string;
  affected_cis: string;
  rollback_plan: string;
  implementation_plan: string;
  requested_by: string;
  requested_by_name: string;
  scheduled_date: string;
  cab_approved: number;
  created_at: string;
}

export default function ChangeDashboard() {
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const canEdit = usePermission('ticket:edit:all' as any);

  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const PAGE_SIZE = 10;

  const [formOpen, setFormOpen] = useState(false);
  const [editingChange, setEditingChange] = useState<ChangeRequest | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedChange, setSelectedChange] = useState<ChangeRequest | null>(null);
  const [cabOpen, setCabOpen] = useState(false);

  const [formData, setFormData] = useState({
    title: '', description: '', change_type: 'Normal', risk_level: 'Low',
    impact: 'Low', urgency: 'Low', affected_cis: '', rollback_plan: '',
    implementation_plan: '', scheduled_date: '',
  });

  const fetchChanges = useCallback(async () => {
    setLoading(true);
    try {
      let where = '1=1';
      if (searchInput) where += ` AND (title LIKE '%${searchInput}%' OR description LIKE '%${searchInput}%')`;
      if (typeFilter) where += ` AND change_type = '${typeFilter}'`;
      if (statusFilter) where += ` AND status = '${statusFilter}'`;
      const offset = (page - 1) * PAGE_SIZE;
      const result = await query(`SELECT c.*, u.name as requested_by_name FROM change_requests c LEFT JOIN users u ON c.requested_by = u.id WHERE ${where} ORDER BY c.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      setChanges(result.toObjects() as unknown as ChangeRequest[]);
      const cr = await query(`SELECT COUNT(*) as c FROM change_requests WHERE ${where}`);
      setTotalCount(parseInt(cr.toObjects()[0]?.c || '0', 10));
    } catch {
      setChanges([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [query, searchInput, typeFilter, statusFilter, page]);

  const [initialized, setInitialized] = useState(false);
  if (!initialized) {
    setInitialized(true);
    fetchChanges();
  }

  const openCreate = () => {
    setEditingChange(null);
    setFormData({ title: '', description: '', change_type: 'Normal', risk_level: 'Low', impact: 'Low', urgency: 'Low', affected_cis: '', rollback_plan: '', implementation_plan: '', scheduled_date: '' });
    setFormOpen(true);
  };

  const openEdit = (cr: ChangeRequest) => {
    setEditingChange(cr);
    setFormData({
      title: cr.title, description: cr.description, change_type: cr.change_type,
      risk_level: cr.risk_level, impact: cr.impact || 'Low', urgency: cr.urgency || 'Low',
      affected_cis: cr.affected_cis, rollback_plan: cr.rollback_plan,
      implementation_plan: cr.implementation_plan,
      scheduled_date: cr.scheduled_date ? cr.scheduled_date.split('T')[0] : '',
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, string | null> = {
      ...formData,
      updated_at: new Date().toISOString(),
    };
    if (editingChange) {
      await update('change_requests', data, { id: editingChange.id });
    } else {
      data.status = 'Pending';
      data.requested_by = String(useAppStore.getState().currentUser?.id || '');
      data.created_at = new Date().toISOString();
      await insert('change_requests', data);
    }
    setFormOpen(false);
    fetchChanges();
  };

  const advanceStatus = async (id: number, newStatus: string) => {
    await update('change_requests', { status: newStatus, updated_at: new Date().toISOString() }, { id });
    fetchChanges();
  };

  const handleDelete = async (id: number) => {
    await deleteFrom('change_requests', { id });
    fetchChanges();
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const startItem = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);
  const activeFilterCount = [typeFilter, statusFilter].filter(Boolean).length;

  // Stats
  const pendingCount = changes.filter((c) => c.status === 'Pending' || c.status === 'CAB Review').length;
  const approvedCount = changes.filter((c) => c.status === 'Approved' || c.status === 'Scheduled').length;
  const emergencyCount = changes.filter((c) => c.change_type === 'Emergency').length;

  const calendarChanges = changes.map((c) => ({
    id: c.id,
    title: c.title,
    scheduled_date: c.scheduled_date || c.created_at,
    type: c.change_type as 'Standard' | 'Normal' | 'Emergency',
    status: c.status,
    risk_level: c.risk_level,
  }));

  const cabMembers = [
    { id: 1, name: 'IT Director', role: 'Director', vote: 'approved' as const, voted_at: '2024-01-15', comment: 'Looks good' },
    { id: 2, name: 'Security Lead', role: 'Security', vote: 'approved' as const, voted_at: '2024-01-15' },
    { id: 3, name: 'Ops Manager', role: 'Operations', vote: 'pending' as const },
  ];

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#c9a87c]">
              <RotateCcw size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[#1f1f1f]">Change Management</h2>
              <p className="text-xs text-[#8a8a8a]">ITIL Change Control</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
              <input value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setPage(1); }} placeholder="Search changes..." className="h-9 w-full rounded-lg border border-[#e5e0d5] bg-white py-1 pl-9 pr-8 text-sm outline-none focus:border-[#c9a87c]" />
              {searchInput && <button onClick={() => { setSearchInput(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8a8a]"><X size={14} /></button>}
            </div>
            <button onClick={() => setShowFilters(!showFilters)} className="relative rounded-lg border p-2 transition-colors" style={{ borderColor: showFilters ? '#c9a87c' : '#e5e0d5', backgroundColor: showFilters ? '#f5f0e8' : 'white', color: showFilters ? '#1f1f1f' : '#8a8a8a' }}>
              <Filter size={16} />
              {activeFilterCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#c9a87c] text-[9px] font-bold text-white">{activeFilterCount}</span>}
            </button>
            {canEdit && (
              <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-3 py-2 text-sm font-medium text-white hover:bg-[#b8986c]">
                <Plus size={16} /> <span className="hidden sm:inline">New RFC</span>
              </button>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <Clock size={14} className="text-[#faad14]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Pending</p><p className="text-sm font-bold text-[#1f1f1f]">{pendingCount}</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <ShieldCheck size={14} className="text-[#52c41a]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Approved</p><p className="text-sm font-bold text-[#1f1f1f]">{approvedCount}</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <ShieldAlert size={14} className="text-[#f5222d]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Emergency</p><p className="text-sm font-bold text-[#1f1f1f]">{emergencyCount}</p></div>
          </div>
        </div>

        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-[#e5e0d5] bg-white p-3">
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="rounded-md border border-[#e5e0d5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#c9a87c]">
              <option value="">All Types</option>
              {CHANGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-md border border-[#e5e0d5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#c9a87c]">
              <option value="">All Statuses</option>
              {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {activeFilterCount > 0 && (
              <button onClick={() => { setTypeFilter(''); setStatusFilter(''); setPage(1); }} className="flex items-center gap-1 rounded-md bg-[#f5f0e8] px-2 py-1.5 text-xs font-medium text-[#595959]"><X size={12} /> Clear</button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Change list */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#e5e0d5] border-t-[#c9a87c]" /></div>
          ) : changes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-[#e5e0d5] bg-white">
              <RotateCcw size={48} className="mb-4 text-[#e5e0d5]" />
              <h3 className="text-lg font-medium text-[#1f1f1f]">No change requests</h3>
            </div>
          ) : (
            <div className="space-y-2">
              {changes.map((cr) => {
                const typeColors: Record<string, string> = { 'Standard': '#52c41a', 'Normal': '#1890ff', 'Emergency': '#f5222d' };
                const riskColors: Record<string, string> = { 'Low': '#52c41a', 'Medium': '#faad14', 'High': '#f5222d' };
                const statusIdx = STATUS_FLOW.indexOf(cr.status);
                return (
                  <div key={cr.id} className="rounded-xl border border-[#e5e0d5] bg-white p-4 hover:shadow-sm transition-all">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-[#1f1f1f] truncate cursor-pointer hover:text-[#c9a87c]" onClick={() => { setSelectedChange(cr); setDetailOpen(true); }}>{cr.title}</h3>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white shrink-0" style={{ backgroundColor: typeColors[cr.change_type] || '#8a8a8a' }}>{cr.change_type}</span>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0" style={{ backgroundColor: (riskColors[cr.risk_level] || '#8a8a8a') + '20', color: riskColors[cr.risk_level] || '#8a8a8a' }}>{cr.risk_level} Risk</span>
                        </div>
                        <p className="mt-1 text-xs text-[#595959] line-clamp-2">{cr.description}</p>
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-[#8a8a8a]">
                          <span>RFC-{String(cr.id).padStart(4, '0')}</span>
                          <span>by {cr.requested_by_name || 'Unknown'}</span>
                          {cr.scheduled_date && <span className="flex items-center gap-1"><CalendarDays size={10} /> {new Date(cr.scheduled_date).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        {canEdit && statusIdx < STATUS_FLOW.length - 1 && (
                          <button onClick={() => advanceStatus(cr.id, STATUS_FLOW[statusIdx + 1])} className="rounded p-1.5 text-[#52c41a] hover:bg-[#f6ffed]" title={`Advance to ${STATUS_FLOW[statusIdx + 1]}`}>
                            <CheckCircle2 size={14} />
                          </button>
                        )}
                        <button onClick={() => { setSelectedChange(cr); setCabOpen(true); }} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#f5f0e8]" title="CAB Panel">
                          <ShieldCheck size={14} />
                        </button>
                        {canEdit && (
                          <>
                            <button onClick={() => openEdit(cr)} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#f5f0e8]"><Pencil size={14} /></button>
                            <button onClick={() => handleDelete(cr.id)} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#fff2f0] hover:text-[#f5222d]"><Trash2 size={14} /></button>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Status flow */}
                    <div className="mt-3 flex items-center gap-0">
                      {STATUS_FLOW.map((s, i) => (
                        <div key={s} className="flex items-center flex-1">
                          <div className={`h-1.5 flex-1 rounded-full ${i <= statusIdx ? 'bg-[#c9a87c]' : 'bg-[#f0ece3]'}`} />
                          {i < STATUS_FLOW.length - 1 && <div className="w-0" />}
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] text-[#8a8a8a]">
                      {STATUS_FLOW.slice(0, 4).map((s, i) => <span key={s} className={i <= statusIdx ? 'text-[#c9a87c] font-medium' : ''}>{s}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalCount > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-[#e5e0d5] bg-white px-4 py-3">
              <div className="text-xs text-[#8a8a8a]">Showing {startItem}–{endItem} of {totalCount}</div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg border border-[#e5e0d5] p-1.5 disabled:opacity-40"><ChevronLeft size={14} /></button>
                <span className="text-xs text-[#595959] px-2">Page {page} of {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="rounded-lg border border-[#e5e0d5] p-1.5 disabled:opacity-40"><ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <RiskMatrix />
          <ChangeCalendar changes={calendarChanges} />
        </div>
      </div>

      {/* RFC Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">{editingChange ? 'Edit RFC' : 'New Request for Change'}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div><label className="text-xs font-medium text-[#595959]">Title *</label><input value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="Upgrade network switches" /></div>
            <div><label className="text-xs font-medium text-[#595959]">Description</label><textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={3} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Type</label><select value={formData.change_type} onChange={(e) => setFormData({ ...formData, change_type: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{CHANGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label className="text-xs font-medium text-[#595959]">Impact</label><select value={formData.impact} onChange={(e) => setFormData({ ...formData, impact: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]"><option>Low</option><option>Medium</option><option>High</option></select></div>
              <div><label className="text-xs font-medium text-[#595959]">Urgency</label><select value={formData.urgency} onChange={(e) => setFormData({ ...formData, urgency: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]"><option>Low</option><option>Medium</option><option>High</option></select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Risk Level</label><select value={formData.risk_level} onChange={(e) => setFormData({ ...formData, risk_level: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
              <div><label className="text-xs font-medium text-[#595959]">Scheduled Date</label><input type="date" value={formData.scheduled_date} onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" /></div>
            </div>
            <div><label className="text-xs font-medium text-[#595959]">Affected CIs</label><input value={formData.affected_cis} onChange={(e) => setFormData({ ...formData, affected_cis: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="SW-001, ROUTER-002" /></div>
            <div><label className="text-xs font-medium text-[#595959]">Implementation Plan</label><textarea value={formData.implementation_plan} onChange={(e) => setFormData({ ...formData, implementation_plan: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={3} placeholder="Step-by-step plan..." /></div>
            <div><label className="text-xs font-medium text-[#595959]">Rollback Plan</label><textarea value={formData.rollback_plan} onChange={(e) => setFormData({ ...formData, rollback_plan: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={2} placeholder="Rollback procedure..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleSave} disabled={!formData.title} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">{editingChange ? 'Update RFC' : 'Submit RFC'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">RFC-{String(selectedChange?.id).padStart(4, '0')}: {selectedChange?.title}</DialogTitle></DialogHeader>
          {selectedChange && (
            <div className="space-y-3 py-2">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#f5f0e8] text-[#595959]">{selectedChange.change_type}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#f5f0e8] text-[#595959]">{selectedChange.status}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: selectedChange.risk_level === 'High' ? '#f5222d' : selectedChange.risk_level === 'Medium' ? '#faad14' : '#52c41a' }}>{selectedChange.risk_level} Risk</span>
              </div>
              <div className="rounded-lg bg-[#fbf9f4] p-3"><p className="text-xs font-medium text-[#595959] mb-1">Description</p><p className="text-xs text-[#1f1f1f]">{selectedChange.description || 'No description'}</p></div>
              {selectedChange.implementation_plan && <div className="rounded-lg bg-[#fbf9f4] p-3"><p className="text-xs font-medium text-[#595959] mb-1">Implementation Plan</p><p className="text-xs text-[#1f1f1f]">{selectedChange.implementation_plan}</p></div>}
              {selectedChange.rollback_plan && <div className="rounded-lg bg-[#fbf9f4] p-3"><p className="text-xs font-medium text-[#595959] mb-1">Rollback Plan</p><p className="text-xs text-[#1f1f1f]">{selectedChange.rollback_plan}</p></div>}
              {selectedChange.affected_cis && <div className="rounded-lg bg-[#fbf9f4] p-3"><p className="text-xs font-medium text-[#595959] mb-1">Affected CIs</p><p className="text-xs font-mono text-[#1f1f1f]">{selectedChange.affected_cis}</p></div>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* CAB Dialog */}
      <Dialog open={cabOpen} onOpenChange={setCabOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">CAB Approval — RFC-{String(selectedChange?.id).padStart(4, '0')}</DialogTitle></DialogHeader>
          <CABPanel members={cabMembers} readonly={!canEdit} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
