/**
 * KEDB — Known Error Database
 * Route: /kedb
 */
import { useState, useCallback } from 'react';
import useAppStore from '@/lib/vedadb-store';
import { usePermission } from '@/hooks/useRBAC';
import {
  Search, Plus, X, Trash2, Pencil, ChevronLeft, ChevronRight,
  BookOpen, AlertCircle, Archive, Link2, FileText,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface KnownError {
  id: number;
  error_code: string;
  title: string;
  symptoms: string;
  root_cause: string;
  workaround: string;
  status: string;
  category: string;
  linked_incidents: number;
  linked_problems: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

const STATUS_OPTIONS = ['Draft', 'Published', 'Archived'];
const CATEGORIES = ['Network', 'Hardware', 'Software', 'Authentication', 'Database', 'Infrastructure', 'Other'];

export default function KEDB() {
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const canEdit = usePermission('ticket:edit:all' as any);

  const [errors, setErrors] = useState<KnownError[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter] = useState('');
  const PAGE_SIZE = 12;

  const [formOpen, setFormOpen] = useState(false);
  const [editingError, setEditingError] = useState<KnownError | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedError, setSelectedError] = useState<KnownError | null>(null);

  const [formData, setFormData] = useState({
    error_code: '', title: '', symptoms: '', root_cause: '',
    workaround: '', status: 'Draft', category: 'Other',
  });

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    try {
      let where = '1=1';
      if (searchInput) where += ` AND (error_code LIKE '%${searchInput}%' OR title LIKE '%${searchInput}%' OR symptoms LIKE '%${searchInput}%')`;
      if (statusFilter) where += ` AND status = '${statusFilter}'`;
      const offset = (page - 1) * PAGE_SIZE;
      const result = await query(`SELECT k.*, u.name as created_by_name FROM known_errors k LEFT JOIN users u ON k.created_by = u.id WHERE ${where} ORDER BY k.updated_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      setErrors(result.toObjects() as unknown as KnownError[]);
      const cr = await query(`SELECT COUNT(*) as c FROM known_errors WHERE ${where}`);
      setTotalCount(parseInt(cr.toObjects()[0]?.c || '0', 10));
    } catch {
      setErrors([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [query, searchInput, statusFilter, page]);

  const [initialized, setInitialized] = useState(false);
  if (!initialized) {
    setInitialized(true);
    fetchErrors();
  }

  const openCreate = () => {
    setEditingError(null);
    setFormData({ error_code: '', title: '', symptoms: '', root_cause: '', workaround: '', status: 'Draft', category: 'Other' });
    setFormOpen(true);
  };

  const openEdit = (err: KnownError) => {
    setEditingError(err);
    setFormData({
      error_code: err.error_code, title: err.title, symptoms: err.symptoms,
      root_cause: err.root_cause, workaround: err.workaround, status: err.status, category: err.category,
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, string | null> = { ...formData, updated_at: new Date().toISOString() };
    if (editingError) {
      await update('known_errors', data, { id: editingError.id });
    } else {
      data.error_code = formData.error_code || `KE-${Date.now()}`;
      data.created_by = String(useAppStore.getState().currentUser?.id || '');
      data.created_at = new Date().toISOString();
      await insert('known_errors', data);
    }
    setFormOpen(false);
    fetchErrors();
  };

  const handleDelete = async (id: number) => {
    await deleteFrom('known_errors', { id });
    fetchErrors();
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const startItem = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);

  const statusCounts = {
    published: errors.filter((e) => e.status === 'Published').length,
    draft: errors.filter((e) => e.status === 'Draft').length,
    archived: errors.filter((e) => e.status === 'Archived').length,
  };

  const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    'Draft': { bg: '#f5f0e8', text: '#8a8a8a' },
    'Published': { bg: '#f6ffed', text: '#52c41a' },
    'Archived': { bg: '#f0f0f0', text: '#8a8a8a' },
  };

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#c9a87c]">
              <BookOpen size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[#1f1f1f]">Known Error DB</h2>
              <p className="text-xs text-[#8a8a8a]">ITIL KEDB — Workarounds & Root Causes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
              <input value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setPage(1); }} placeholder="Search by code, title, symptoms..." className="h-9 w-full rounded-lg border border-[#e5e0d5] bg-white py-1 pl-9 pr-8 text-sm outline-none focus:border-[#c9a87c]" />
              {searchInput && <button onClick={() => { setSearchInput(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8a8a]"><X size={14} /></button>}
            </div>
            {canEdit && (
              <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-3 py-2 text-sm font-medium text-white hover:bg-[#b8986c]">
                <Plus size={16} /> <span className="hidden sm:inline">Add Error</span>
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <AlertCircle size={14} className="text-[#52c41a]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Published</p><p className="text-sm font-bold text-[#1f1f1f]">{statusCounts.published}</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <FileText size={14} className="text-[#8a8a8a]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Draft</p><p className="text-sm font-bold text-[#1f1f1f]">{statusCounts.draft}</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white border border-[#e5e0d5] px-3 py-2">
            <Archive size={14} className="text-[#8a8a8a]" />
            <div><p className="text-[10px] text-[#8a8a8a]">Archived</p><p className="text-sm font-bold text-[#1f1f1f]">{statusCounts.archived}</p></div>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#e5e0d5] border-t-[#c9a87c]" /></div>
      ) : errors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-[#e5e0d5] bg-white">
          <BookOpen size={48} className="mb-4 text-[#e5e0d5]" />
          <h3 className="text-lg font-medium text-[#1f1f1f]">No known errors</h3>
          <p className="text-sm text-[#8a8a8a]">Add your first known error record</p>
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map((err) => {
            const sc = STATUS_COLORS[err.status] || STATUS_COLORS['Draft'];
            return (
              <div key={err.id} className="rounded-xl border border-[#e5e0d5] bg-white p-4 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#c9a87c]">{err.error_code}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: sc.bg, color: sc.text }}>{err.status}</span>
                      <span className="rounded-full bg-[#f5f0e8] px-2 py-0.5 text-[10px] text-[#595959]">{err.category}</span>
                    </div>
                    <h3
                      className="mt-1 text-sm font-semibold text-[#1f1f1f] cursor-pointer hover:text-[#c9a87c]"
                      onClick={() => { setSelectedError(err); setDetailOpen(true); }}
                    >
                      {err.title}
                    </h3>
                    <p className="mt-1 text-xs text-[#595959] line-clamp-2">{err.symptoms}</p>
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-[#8a8a8a]">
                      <span className="flex items-center gap-1"><Link2 size={10} /> {err.linked_incidents || 0} incidents</span>
                      <span className="flex items-center gap-1"><Link2 size={10} /> {err.linked_problems || 0} problems</span>
                      <span>by {err.created_by_name || 'Unknown'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    {canEdit && (
                      <>
                        <button onClick={() => openEdit(err)} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#f5f0e8]"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(err.id)} className="rounded p-1.5 text-[#8a8a8a] hover:bg-[#fff2f0] hover:text-[#f5222d]"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>

                {err.root_cause && (
                  <div className="mt-2 rounded-lg bg-[#fbf9f4] px-3 py-2">
                    <p className="text-[10px] font-semibold text-[#595959] uppercase">Root Cause</p>
                    <p className="text-xs text-[#1f1f1f]">{err.root_cause}</p>
                  </div>
                )}
                {err.workaround && (
                  <div className="mt-1 rounded-lg bg-[#f6ffed] border border-[#b7eb8f] px-3 py-2">
                    <p className="text-[10px] font-semibold text-[#52c41a] uppercase">Workaround</p>
                    <p className="text-xs text-[#1f1f1f]">{err.workaround}</p>
                  </div>
                )}
              </div>
            );
          })}
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
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">{editingError ? 'Edit Known Error' : 'Add Known Error'}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Error Code</label><input value={formData.error_code} onChange={(e) => setFormData({ ...formData, error_code: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="KE-001" /></div>
              <div><label className="text-xs font-medium text-[#595959]">Category</label><select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div><label className="text-xs font-medium text-[#595959]">Title *</label><input value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="Brief description" /></div>
            <div><label className="text-xs font-medium text-[#595959]">Symptoms</label><textarea value={formData.symptoms} onChange={(e) => setFormData({ ...formData, symptoms: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={2} placeholder="What the user sees..." /></div>
            <div><label className="text-xs font-medium text-[#595959]">Root Cause</label><textarea value={formData.root_cause} onChange={(e) => setFormData({ ...formData, root_cause: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={2} placeholder="Underlying cause..." /></div>
            <div><label className="text-xs font-medium text-[#595959]">Workaround</label><textarea value={formData.workaround} onChange={(e) => setFormData({ ...formData, workaround: e.target.value })} className="mt-1 w-full rounded-lg border border-[#52c41a30] bg-[#f6ffed] px-3 py-2 text-sm outline-none focus:border-[#52c41a]" rows={2} placeholder="Temporary fix..." /></div>
            <div><label className="text-xs font-medium text-[#595959]">Status</label><select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleSave} disabled={!formData.title} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">{editingError ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f] flex items-center gap-2"><span className="font-mono text-[#c9a87c]">{selectedError?.error_code}</span> — {selectedError?.title}</DialogTitle></DialogHeader>
          {selectedError && (
            <div className="space-y-3 py-2">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: (STATUS_COLORS[selectedError.status] || STATUS_COLORS['Draft']).bg, color: (STATUS_COLORS[selectedError.status] || STATUS_COLORS['Draft']).text }}>{selectedError.status}</span>
                <span className="rounded-full bg-[#f5f0e8] px-2 py-0.5 text-[10px] text-[#595959]">{selectedError.category}</span>
              </div>
              {selectedError.symptoms && <div className="rounded-lg bg-[#fbf9f4] p-3"><p className="text-[10px] font-semibold text-[#595959] uppercase mb-1">Symptoms</p><p className="text-xs text-[#1f1f1f]">{selectedError.symptoms}</p></div>}
              {selectedError.root_cause && <div className="rounded-lg bg-[#fff2f0] border border-[#ffccc7] p-3"><p className="text-[10px] font-semibold text-[#f5222d] uppercase mb-1">Root Cause</p><p className="text-xs text-[#1f1f1f]">{selectedError.root_cause}</p></div>}
              {selectedError.workaround && <div className="rounded-lg bg-[#f6ffed] border border-[#b7eb8f] p-3"><p className="text-[10px] font-semibold text-[#52c41a] uppercase mb-1">Workaround</p><p className="text-xs text-[#1f1f1f]">{selectedError.workaround}</p></div>}
              <div className="flex items-center gap-3 text-[10px] text-[#8a8a8a]">
                <span className="flex items-center gap-1"><Link2 size={10} /> {selectedError.linked_incidents || 0} linked incidents</span>
                <span className="flex items-center gap-1"><Link2 size={10} /> {selectedError.linked_problems || 0} linked problems</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
