/**
 * ProblemManagement — Problem records with RCA
 * Route: /problems
 */
import { useState, useCallback } from 'react';
import useAppStore from '@/lib/vedadb-store';
import { usePermission } from '@/hooks/useRBAC';
import ProblemRCA from '@/components/advanced/ProblemRCA';
import {
  Search, Plus, X, Filter, ChevronLeft, ChevronRight,
  AlertTriangle, Pencil, Trash2, Flag, Link2, Clock,
  Lightbulb, Wrench, CheckCircle2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ProblemRecord {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  root_cause: string;
  workaround: string;
  solution: string;
  major_incident: number;
  linked_incidents: number;
  assigned_to: string;
  assigned_to_name: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

const STATUS_FLOW = ['New', 'Under Investigation', 'Root Cause Identified', 'Known Error', 'Closed'];
const PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];
const CATEGORIES = ['Infrastructure', 'Application', 'Network', 'Security', 'Database', 'Process', 'Other'];

export default function ProblemManagement() {
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const canEdit = usePermission('ticket:edit:all' as any);

  const [problems, setProblems] = useState<ProblemRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const PAGE_SIZE = 10;

  const [formOpen, setFormOpen] = useState(false);
  const [editingProblem, setEditingProblem] = useState<ProblemRecord | null>(null);
  const [rcaOpen, setRcaOpen] = useState(false);
  const [selectedProblem, setSelectedProblem] = useState<ProblemRecord | null>(null);

  const [formData, setFormData] = useState({
    title: '', description: '', category: 'Infrastructure', priority: 'Medium',
    status: 'New', root_cause: '', workaround: '', solution: '',
  });

  const fetchProblems = useCallback(async () => {
    setLoading(true);
    try {
      let where = '1=1';
      if (searchInput) where += ` AND (title LIKE '%${searchInput}%' OR description LIKE '%${searchInput}%')`;
      if (statusFilter) where += ` AND status = '${statusFilter}'`;
      const offset = (page - 1) * PAGE_SIZE;
      const result = await query(`SELECT p.*, u.name as assigned_to_name, c.name as created_by_name FROM problems p LEFT JOIN users u ON p.assigned_to = u.id LEFT JOIN users c ON p.created_by = c.id WHERE ${where} ORDER BY p.updated_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      setProblems(result.toObjects() as unknown as ProblemRecord[]);
      const cr = await query(`SELECT COUNT(*) as c FROM problems WHERE ${where}`);
      setTotalCount(parseInt(cr.toObjects()[0]?.c || '0', 10));
    } catch {
      setProblems([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [query, searchInput, statusFilter, page]);

  const [initialized, setInitialized] = useState(false);
  if (!initialized) {
    setInitialized(true);
    fetchProblems();
  }

  const openCreate = () => {
    setEditingProblem(null);
    setFormData({ title: '', description: '', category: 'Infrastructure', priority: 'Medium', status: 'New', root_cause: '', workaround: '', solution: '' });
    setFormOpen(true);
  };

  const openEdit = (p: ProblemRecord) => {
    setEditingProblem(p);
    setFormData({
      title: p.title, description: p.description, category: p.category, priority: p.priority,
      status: p.status, root_cause: p.root_cause, workaround: p.workaround, solution: p.solution,
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, string | null> = { ...formData, updated_at: new Date().toISOString() };
    if (editingProblem) {
      await update('problems', data, { id: editingProblem.id });
    } else {
      data.created_by = String(useAppStore.getState().currentUser?.id || '');
      data.created_at = new Date().toISOString();
      await insert('problems', data);
    }
    setFormOpen(false);
    fetchProblems();
  };

  const handleDelete = async (id: number) => {
    await deleteFrom('problems', { id });
    fetchProblems();
  };

  const advanceStatus = async (id: number, currentStatus: string) => {
    const idx = STATUS_FLOW.indexOf(currentStatus);
    if (idx < STATUS_FLOW.length - 1) {
      await update('problems', { status: STATUS_FLOW[idx + 1], updated_at: new Date().toISOString() }, { id });
      fetchProblems();
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const startItem = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);

  const priorityColors: Record<string, string> = { 'Critical': '#f5222d', 'High': '#fa8c16', 'Medium': '#faad14', 'Low': '#52c41a' };
  const statusColors: Record<string, string> = { 'New': '#1890ff', 'Under Investigation': '#faad14', 'Root Cause Identified': '#722ed1', 'Known Error': '#52c41a', 'Closed': '#8a8a8a' };

  const stats = {
    new: problems.filter((p) => p.status === 'New').length,
    investigating: problems.filter((p) => p.status === 'Under Investigation').length,
    rca: problems.filter((p) => p.status === 'Root Cause Identified').length,
    known: problems.filter((p) => p.status === 'Known Error').length,
    major: problems.filter((p) => p.major_incident === 1).length,
  };

  const sampleWhys = [
    { id: 1, level: 1, question: 'Why did the server crash?', answer: 'Memory was exhausted' },
    { id: 2, level: 2, question: 'Why was memory exhausted?', answer: 'Memory leak in application' },
    { id: 3, level: 3, question: 'Why was there a memory leak?', answer: 'Unclosed database connections' },
    { id: 4, level: 4, question: 'Why were connections not closed?', answer: 'Missing finally blocks in code' },
    { id: 5, level: 5, question: 'Why were finally blocks missing?', answer: 'Code review did not catch the issue' },
  ];

  const sampleTimeline = [
    { id: 1, timestamp: '2024-01-10T08:00:00', event: 'Problem reported', category: 'Detection' },
    { id: 2, timestamp: '2024-01-10T09:30:00', event: 'Initial investigation started', category: 'Investigation' },
    { id: 3, timestamp: '2024-01-10T14:00:00', event: 'Logs analyzed', category: 'Analysis' },
    { id: 4, timestamp: '2024-01-11T10:00:00', event: 'Root cause identified', category: 'RCA' },
  ];

  const sampleFishbone = [
    { category: 'People', causes: ['Insufficient training', 'Lack of code review'] },
    { category: 'Process', causes: ['No connection pooling policy', 'Missing code standards'] },
    { category: 'Technology', causes: ['ORM framework bug', 'Database timeout misconfig'] },
  ];

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#c9a87c]">
              <Lightbulb size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[#1f1f1f]">Problem Management</h2>
              <p className="text-xs text-[#8a8a8a]">Root Cause Analysis & Known Errors</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
              <input value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setPage(1); }} placeholder="Search problems..." className="h-9 w-full rounded-lg border border-[#e5e0d5] bg-white py-1 pl-9 pr-8 text-sm outline-none focus:border-[#c9a87c]" />
              {searchInput && <button onClick={() => { setSearchInput(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8a8a]"><X size={14} /></button>}
            </div>
            <button onClick={() => setShowFilters(!showFilters)} className="rounded-lg border p-2 transition-colors" style={{ borderColor: showFilters ? '#c9a87c' : '#e5e0d5', backgroundColor: showFilters ? '#f5f0e8' : 'white' }}>
              <Filter size={16} />
            </button>
            {canEdit && (
              <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-3 py-2 text-sm font-medium text-white hover:bg-[#b8986c]">
                <Plus size={16} /> <span className="hidden sm:inline">Add Problem</span>
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 grid grid-cols-5 gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-white border border-[#e5e0d5] px-2 py-2">
            <AlertTriangle size={12} className="text-[#1890ff]" />
            <div><p className="text-[9px] text-[#8a8a8a]">New</p><p className="text-xs font-bold text-[#1f1f1f]">{stats.new}</p></div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-white border border-[#e5e0d5] px-2 py-2">
            <Clock size={12} className="text-[#faad14]" />
            <div><p className="text-[9px] text-[#8a8a8a]">Investigating</p><p className="text-xs font-bold text-[#1f1f1f]">{stats.investigating}</p></div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-white border border-[#e5e0d5] px-2 py-2">
            <CheckCircle2 size={12} className="text-[#722ed1]" />
            <div><p className="text-[9px] text-[#8a8a8a]">RCA</p><p className="text-xs font-bold text-[#1f1f1f]">{stats.rca}</p></div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-white border border-[#e5e0d5] px-2 py-2">
            <Wrench size={12} className="text-[#52c41a]" />
            <div><p className="text-[9px] text-[#8a8a8a]">Known</p><p className="text-xs font-bold text-[#1f1f1f]">{stats.known}</p></div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-white border border-[#e5e0d5] px-2 py-2">
            <Flag size={12} className="text-[#f5222d]" />
            <div><p className="text-[9px] text-[#8a8a8a]">Major</p><p className="text-xs font-bold text-[#1f1f1f]">{stats.major}</p></div>
          </div>
        </div>

        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-[#e5e0d5] bg-white p-3">
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-md border border-[#e5e0d5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#c9a87c]">
              <option value="">All Statuses</option>
              {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {statusFilter && <button onClick={() => { setStatusFilter(''); setPage(1); }} className="flex items-center gap-1 rounded-md bg-[#f5f0e8] px-2 py-1.5 text-xs text-[#595959]"><X size={12} /> Clear</button>}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#e5e0d5] border-t-[#c9a87c]" /></div>
      ) : problems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-[#e5e0d5] bg-white">
          <Lightbulb size={48} className="mb-4 text-[#e5e0d5]" />
          <h3 className="text-lg font-medium text-[#1f1f1f]">No problem records</h3>
        </div>
      ) : (
        <div className="space-y-2">
          {problems.map((p) => (
            <div key={p.id} className="rounded-xl border border-[#e5e0d5] bg-white p-4 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-[#1f1f1f]">{p.title}</h3>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: priorityColors[p.priority] || '#8a8a8a' }}>{p.priority}</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: statusColors[p.status] || '#8a8a8a' }}>{p.status}</span>
                    <span className="rounded-full bg-[#f5f0e8] px-2 py-0.5 text-[10px] text-[#595959]">{p.category}</span>
                    {p.major_incident === 1 && <span className="rounded-full bg-[#fff2f0] px-2 py-0.5 text-[10px] text-[#f5222d] font-medium flex items-center gap-1"><Flag size={10} /> Major</span>}
                  </div>
                  <p className="mt-1 text-xs text-[#595959] line-clamp-2">{p.description}</p>
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-[#8a8a8a]">
                    <span>PRB-{String(p.id).padStart(4, '0')}</span>
                    <span className="flex items-center gap-1"><Link2 size={10} /> {p.linked_incidents || 0} incidents</span>
                    {p.assigned_to_name && <span>Assigned: {p.assigned_to_name}</span>}
                  </div>
                  {p.root_cause && (
                    <div className="mt-2 rounded-lg bg-[#fff2f0] border border-[#ffccc7] px-3 py-1.5">
                      <p className="text-[10px] font-semibold text-[#f5222d] uppercase">Root Cause</p>
                      <p className="text-xs text-[#1f1f1f]">{p.root_cause}</p>
                    </div>
                  )}
                  {p.workaround && (
                    <div className="mt-1 rounded-lg bg-[#f6ffed] border border-[#b7eb8f] px-3 py-1.5">
                      <p className="text-[10px] font-semibold text-[#52c41a] uppercase">Workaround</p>
                      <p className="text-xs text-[#1f1f1f]">{p.workaround}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {canEdit && p.status !== 'Closed' && p.status !== 'Known Error' && (
                    <button onClick={() => advanceStatus(p.id, p.status)} className="rounded p-1.5 text-[#52c41a] hover:bg-[#f6ffed]" title="Advance status">
                      <CheckCircle2 size={14} />
                    </button>
                  )}
                  <button onClick={() => { setSelectedProblem(p); setRcaOpen(true); }} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#f5f0e8]" title="RCA">
                    <Lightbulb size={14} />
                  </button>
                  {canEdit && (
                    <>
                      <button onClick={() => openEdit(p)} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#f5f0e8]"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(p.id)} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#fff2f0] hover:text-[#f5222d]"><Trash2 size={14} /></button>
                    </>
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

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">{editingProblem ? 'Edit Problem' : 'Add Problem'}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div><label className="text-xs font-medium text-[#595959]">Title *</label><input value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" /></div>
            <div><label className="text-xs font-medium text-[#595959]">Description</label><textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={3} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Category</label><select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className="text-xs font-medium text-[#595959]">Priority</label><select value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
              <div><label className="text-xs font-medium text-[#595959]">Status</label><select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            </div>
            <div><label className="text-xs font-medium text-[#595959]">Root Cause</label><textarea value={formData.root_cause} onChange={(e) => setFormData({ ...formData, root_cause: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={2} placeholder="Known or suspected root cause..." /></div>
            <div><label className="text-xs font-medium text-[#595959]">Workaround</label><textarea value={formData.workaround} onChange={(e) => setFormData({ ...formData, workaround: e.target.value })} className="mt-1 w-full rounded-lg border border-[#52c41a30] bg-[#f6ffed] px-3 py-2 text-sm outline-none focus:border-[#52c41a]" rows={2} placeholder="Temporary workaround..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleSave} disabled={!formData.title} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">{editingProblem ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RCA Dialog */}
      <Dialog open={rcaOpen} onOpenChange={setRcaOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#1f1f1f]">Root Cause Analysis — PRB-{String(selectedProblem?.id).padStart(4, '0')}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <div className="mb-3 rounded-lg bg-[#fbf9f4] px-3 py-2">
              <p className="text-sm font-semibold text-[#1f1f1f]">{selectedProblem?.title}</p>
              {selectedProblem?.root_cause && <p className="text-xs text-[#595959] mt-1"><span className="font-medium">Root Cause:</span> {selectedProblem.root_cause}</p>}
            </div>
            <ProblemRCA
              whys={sampleWhys}
              timeline={sampleTimeline}
              fishbone={sampleFishbone}
              readonly={!canEdit}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
