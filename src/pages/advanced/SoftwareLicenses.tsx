/**
 * SoftwareLicenses — Software license management
 * Route: /software-licenses
 */
import { useState, useCallback } from 'react';
import useAppStore from '@/lib/vedadb-store';
import LicenseComplianceMeter from '@/components/advanced/LicenseComplianceMeter';
import { usePermission } from '@/hooks/useRBAC';
import {
  Search, Plus, X, Upload, AlertTriangle, ChevronLeft, ChevronRight,
  FileText, Trash2, Pencil,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const LICENSE_TYPES = ['Perpetual', 'Subscription', 'Concurrent', 'Enterprise'];

interface SoftwareLicense {
  id: number;
  name: string;
  publisher: string;
  version: string;
  license_type: string;
  seats: number;
  used: number;
  expiry_date: string;
  purchase_date: string;
  cost: string;
  status: string;
  notes: string;
  created_at: string;
}

export default function SoftwareLicenses() {
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const canEdit = usePermission('ticket:edit:all' as any);

  const [licenses, setLicenses] = useState<SoftwareLicense[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 12;

  const [formOpen, setFormOpen] = useState(false);
  const [editingLicense, setEditingLicense] = useState<SoftwareLicense | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const [formData, setFormData] = useState({
    name: '', publisher: '', version: '', license_type: 'Subscription',
    seats: '1', used: '0', expiry_date: '', purchase_date: '',
    cost: '', notes: '', status: 'Active',
  });

  const fetchLicenses = useCallback(async () => {
    setLoading(true);
    try {
      let where = '1=1';
      if (searchInput) where += ` AND (name LIKE '%${searchInput}%' OR publisher LIKE '%${searchInput}%')`;
      const offset = (page - 1) * PAGE_SIZE;
      const result = await query(`SELECT * FROM software_licenses WHERE ${where} ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      setLicenses(result.toObjects() as unknown as SoftwareLicense[]);
      const cr = await query(`SELECT COUNT(*) as c FROM software_licenses WHERE ${where}`);
      setTotalCount(parseInt(cr.toObjects()[0]?.c || '0', 10));
    } catch {
      setLicenses([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [query, searchInput, page]);

  // Fetch on mount
  useState(() => { fetchLicenses(); });
  // Use effect-like fetch
  const [initialized, setInitialized] = useState(false);
  if (!initialized) {
    setInitialized(true);
    fetchLicenses();
  }

  const openCreate = () => {
    setEditingLicense(null);
    setFormData({ name: '', publisher: '', version: '', license_type: 'Subscription', seats: '1', used: '0', expiry_date: '', purchase_date: '', cost: '', notes: '', status: 'Active' });
    setFormOpen(true);
  };

  const openEdit = (lic: SoftwareLicense) => {
    setEditingLicense(lic);
    setFormData({
      name: lic.name, publisher: lic.publisher, version: lic.version,
      license_type: lic.license_type, seats: String(lic.seats), used: String(lic.used),
      expiry_date: lic.expiry_date ? lic.expiry_date.split('T')[0] : '',
      purchase_date: lic.purchase_date ? lic.purchase_date.split('T')[0] : '',
      cost: lic.cost, notes: lic.notes, status: lic.status,
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, string | null> = {
      ...formData,
      seats: String(parseInt(formData.seats) || 0),
      used: String(parseInt(formData.used) || 0),
      updated_at: new Date().toISOString(),
    };
    if (editingLicense) {
      await update('software_licenses', data, { id: editingLicense.id });
    } else {
      data.created_at = new Date().toISOString();
      await insert('software_licenses', data);
    }
    setFormOpen(false);
    fetchLicenses();
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    await deleteFrom('software_licenses', { id: deletingId });
    setDeleteOpen(false);
    setDeletingId(null);
    fetchLicenses();
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    const lines = importText.trim().split('\n');
    const headers = lines[0].split(',').map((h) => h.trim());
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map((v) => v.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, j) => { row[h] = vals[j] || ''; });
      row.created_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      try { await insert('software_licenses', row); } catch { /* skip */ }
    }
    setImportOpen(false);
    setImportText('');
    fetchLicenses();
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const startItem = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);

  // Summary stats
  const totalSeats = licenses.reduce((sum, l) => sum + (Number(l.seats) || 0), 0);
  const totalUsed = licenses.reduce((sum, l) => sum + (Number(l.used) || 0), 0);
  const expiringSoon = licenses.filter((l) => {
    if (!l.expiry_date) return false;
    const d = new Date(l.expiry_date);
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return d <= thirtyDays && d >= now;
  });
  const overused = licenses.filter((l) => Number(l.used) > Number(l.seats));

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#c9a87c]">
              <FileText size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[#1f1f1f]">Software Licenses</h2>
              <p className="text-xs text-[#8a8a8a]">License Management & Compliance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
              <input value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setPage(1); }} placeholder="Search licenses..." className="h-9 w-full rounded-lg border border-[#e5e0d5] bg-white py-1 pl-9 pr-8 text-sm outline-none focus:border-[#c9a87c]" />
              {searchInput && <button onClick={() => { setSearchInput(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8a8a]"><X size={14} /></button>}
            </div>
            <button onClick={() => setImportOpen(true)} className="rounded-lg border border-[#e5e0d5] bg-white p-2 text-[#8a8a8a] hover:text-[#595959]"><Upload size={16} /></button>
            {canEdit && (
              <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-3 py-2 text-sm font-medium text-white hover:bg-[#b8986c]">
                <Plus size={16} /> <span className="hidden sm:inline">Add License</span>
              </button>
            )}
          </div>
        </div>

        {overused.length > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#fff2f0] border border-[#ffccc7] px-3 py-2">
            <AlertTriangle size={14} className="text-[#f5222d]" />
            <span className="text-xs text-[#595959]">{overused.length} license(s) are overused</span>
          </div>
        )}
      </div>

      {/* Compliance meters */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#e5e0d5] bg-white p-3 flex items-center gap-3">
          <LicenseComplianceMeter used={totalUsed} total={totalSeats} licenseName="Overall" />
        </div>
        {licenses.slice(0, 3).map((lic) => (
          <div key={lic.id} className="rounded-xl border border-[#e5e0d5] bg-white p-3 flex items-center gap-3">
            <LicenseComplianceMeter used={Number(lic.used)} total={Number(lic.seats)} licenseName={lic.name} />
          </div>
        ))}
      </div>

      {/* Expiry alerts */}
      {expiringSoon.length > 0 && (
        <div className="mb-4 rounded-xl border border-[#ffe58f] bg-[#fffbe6] p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-[#faad14]" />
            <h3 className="text-xs font-semibold text-[#1f1f1f]">Expiring Soon (30 days)</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {expiringSoon.map((lic) => (
              <span key={lic.id} className="rounded-full bg-white px-2.5 py-1 text-[10px] font-medium text-[#595959] border border-[#ffe58f]">
                {lic.name} — {new Date(lic.expiry_date).toLocaleDateString()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#e5e0d5] border-t-[#c9a87c]" />
        </div>
      ) : licenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText size={48} className="mb-4 text-[#e5e0d5]" />
          <h3 className="text-lg font-medium text-[#1f1f1f]">No licenses found</h3>
          <p className="text-sm text-[#8a8a8a]">Add your first software license</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e0d5] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e0d5] bg-[#f5f0e8]">
                {['Name', 'Publisher', 'Version', 'Type', 'Seats', 'Used', 'Expiry', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0ece3]">
              {licenses.map((lic) => {
                const isOverused = Number(lic.used) > Number(lic.seats);
                return (
                  <tr key={lic.id} className="hover:bg-[#fbf9f4] transition-colors">
                    <td className="px-4 py-3 text-xs font-medium text-[#1f1f1f]">{lic.name}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{lic.publisher}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{lic.version}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{lic.license_type}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{lic.seats}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${isOverused ? 'text-[#f5222d]' : 'text-[#1f1f1f]'}`}>{lic.used}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{lic.expiry_date ? new Date(lic.expiry_date).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${lic.status === 'Active' ? 'bg-[#f6ffed] text-[#52c41a]' : lic.status === 'Expired' ? 'bg-[#fff2f0] text-[#f5222d]' : 'bg-[#f5f0e8] text-[#595959]'}`}>
                        {lic.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <>
                            <button onClick={() => openEdit(lic)} className="rounded p-1 text-[#8a8a8a] hover:bg-[#f5f0e8]"><Pencil size={14} /></button>
                            <button onClick={() => { setDeletingId(lic.id); setDeleteOpen(true); }} className="rounded p-1 text-[#8a8a8a] hover:bg-[#fff2f0] hover:text-[#f5222d]"><Trash2 size={14} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[#e5e0d5] bg-white px-4 py-3">
          <div className="text-xs text-[#8a8a8a]">Showing {startItem}–{endItem} of {totalCount}</div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg border border-[#e5e0d5] p-1.5 text-[#8a8a8a] disabled:opacity-40 hover:bg-[#f5f0e8]"><ChevronLeft size={14} /></button>
            <span className="text-xs text-[#595959] px-2">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="rounded-lg border border-[#e5e0d5] p-1.5 text-[#8a8a8a] disabled:opacity-40 hover:bg-[#f5f0e8]"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">{editingLicense ? 'Edit License' : 'Add License'}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Name *</label><input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="Microsoft 365" /></div>
              <div><label className="text-xs font-medium text-[#595959]">Publisher</label><input value={formData.publisher} onChange={(e) => setFormData({ ...formData, publisher: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="Microsoft" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Version</label><input value={formData.version} onChange={(e) => setFormData({ ...formData, version: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="2023" /></div>
              <div><label className="text-xs font-medium text-[#595959]">License Type</label><select value={formData.license_type} onChange={(e) => setFormData({ ...formData, license_type: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">{LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Seats</label><input type="number" value={formData.seats} onChange={(e) => setFormData({ ...formData, seats: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" /></div>
              <div><label className="text-xs font-medium text-[#595959]">Used</label><input type="number" value={formData.used} onChange={(e) => setFormData({ ...formData, used: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" /></div>
              <div><label className="text-xs font-medium text-[#595959]">Cost</label><input value={formData.cost} onChange={(e) => setFormData({ ...formData, cost: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="$0.00" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-[#595959]">Purchase Date</label><input type="date" value={formData.purchase_date} onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" /></div>
              <div><label className="text-xs font-medium text-[#595959]">Expiry Date</label><input type="date" value={formData.expiry_date} onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" /></div>
            </div>
            <div><label className="text-xs font-medium text-[#595959]">Notes</label><textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleSave} disabled={!formData.name} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">{editingLicense ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-white border-[#e5e0d5]">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">Delete License</DialogTitle></DialogHeader>
          <p className="text-sm text-[#595959]">Are you sure? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleDelete} className="bg-red-600 text-white hover:bg-red-700">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg">
          <DialogHeader><DialogTitle className="text-[#1f1f1f]">Import Licenses from CSV</DialogTitle></DialogHeader>
          <p className="text-xs text-[#8a8a8a] mb-2">Headers: name,publisher,version,license_type,seats,used,expiry_date,purchase_date,cost,status</p>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} className="w-full rounded-lg border border-[#e5e0d5] px-3 py-2 text-xs font-mono outline-none focus:border-[#c9a87c]" rows={10} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleImport} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]"><Upload size={14} className="mr-1" /> Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
