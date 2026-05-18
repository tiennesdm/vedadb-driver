/**
 * AssetInventory — Hardware asset inventory table
 * Route: /assets
 */
import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useAppStore from '@/lib/vedadb-store';
import { usePermission } from '@/hooks/useRBAC';
import AssetCard, { type AssetCardData } from '@/components/advanced/AssetCard';
import { cn } from '@/lib/utils';
import {
  Search, Plus, LayoutList, LayoutGrid, ChevronLeft, ChevronRight,
  MoreHorizontal, Pencil, Trash2, X, Filter, Upload, QrCode,
  Laptop, AlertTriangle,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const ASSET_TYPES = ['Laptop', 'Desktop', 'Server', 'Printer', 'Network Device', 'Mobile Device', 'Monitor', 'Peripheral'];
const STATUS_OPTIONS = ['In Use', 'Available', 'In Repair', 'Retired', 'Lost/Stolen'];
const LOCATIONS = ['IT Office', 'Server Room', 'Floor 1', 'Floor 2', 'Floor 3', 'Warehouse', 'Remote'];

const PAGE_SIZE = 12;

export default function AssetInventory() {
  const navigate = useNavigate();
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const canEdit = usePermission('ticket:edit:all' as any);

  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetCardData | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<AssetCardData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrAsset, setQrAsset] = useState<AssetCardData | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    asset_tag: '', name: '', type: 'Laptop', manufacturer: '', model: '',
    serial_number: '', status: 'Available', location: '', assigned_to: '',
    purchase_date: '', warranty_expiry: '', notes: '',
  });

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      let where = '1=1';
      if (searchInput) where += ` AND (name LIKE '%${searchInput}%' OR asset_tag LIKE '%${searchInput}%' OR serial_number LIKE '%${searchInput}%')`;
      if (typeFilter) where += ` AND type = '${typeFilter}'`;
      if (statusFilter) where += ` AND status = '${statusFilter}'`;
      if (locationFilter) where += ` AND location = '${locationFilter}'`;

      const offset = (page - 1) * PAGE_SIZE;
      const result = await query(`SELECT a.*, u.name as assigned_to_name FROM hardware_assets a LEFT JOIN users u ON a.assigned_to = u.id WHERE ${where} ORDER BY a.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      const objs = result.toObjects() as unknown as AssetCardData[];
      setAssets(objs);

      const countResult = await query(`SELECT COUNT(*) as c FROM hardware_assets WHERE ${where}`);
      const countRow = countResult.toObjects()[0];
      setTotalCount(parseInt(countRow?.c || '0', 10));
    } catch (e) {
      // table may not exist yet
      setAssets([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [query, searchInput, typeFilter, statusFilter, locationFilter, page]);

  // Auto-fetch on mount / filter change
  useMemo(() => { fetchAssets(); }, [fetchAssets]);

  const openCreate = () => {
    setEditingAsset(null);
    setFormData({
      asset_tag: '', name: '', type: 'Laptop', manufacturer: '', model: '',
      serial_number: '', status: 'Available', location: '', assigned_to: '',
      purchase_date: '', warranty_expiry: '', notes: '',
    });
    setFormOpen(true);
  };

  const openEdit = (asset: AssetCardData) => {
    setEditingAsset(asset);
    setFormData({
      asset_tag: asset.asset_tag,
      name: asset.name,
      type: asset.type,
      manufacturer: asset.manufacturer,
      model: asset.model,
      serial_number: (asset as any).serial_number || '',
      status: asset.status,
      location: asset.location,
      assigned_to: (asset as any).assigned_to || '',
      purchase_date: (asset as any).purchase_date ? (asset as any).purchase_date.split('T')[0] : '',
      warranty_expiry: (asset as any).warranty_expiry ? (asset as any).warranty_expiry.split('T')[0] : '',
      notes: (asset as any).notes || '',
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, string | null> = {
      ...formData,
      assigned_to: formData.assigned_to ? String(formData.assigned_to) : null,
      updated_at: new Date().toISOString(),
    };

    if (editingAsset) {
      await update('hardware_assets', data, { id: editingAsset.id });
    } else {
      data.created_at = new Date().toISOString();
      await insert('hardware_assets', data);
    }
    setFormOpen(false);
    fetchAssets();
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    await deleteFrom('hardware_assets', { id: deletingId });
    setDeletingId(null);
    setDeleteOpen(false);
    fetchAssets();
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
      try { await insert('hardware_assets', row); } catch { /* skip */ }
    }
    setImportOpen(false);
    setImportText('');
    fetchAssets();
  };

  const clearFilters = () => {
    setSearchInput('');
    setTypeFilter('');
    setStatusFilter('');
    setLocationFilter('');
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const startItem = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);
  const activeFilterCount = [typeFilter, statusFilter, locationFilter].filter(Boolean).length;

  const warrantySoon = useMemo(() => {
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return assets.filter((a) => {
      if (!a.warranty_expiry) return false;
      const d = new Date(a.warranty_expiry);
      return d <= thirtyDays && d >= now;
    });
  }, [assets]);

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#c9a87c]">
              <Laptop size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[#1f1f1f]">Asset Inventory</h2>
              <p className="text-xs text-[#8a8a8a]">CMDB Hardware Management</p>
            </div>
            <span className="rounded-full bg-[#f5f0e8] px-2.5 py-0.5 text-xs font-medium text-[#595959]">
              {totalCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
                placeholder="Search assets..."
                className="h-9 w-full rounded-lg border border-[#e5e0d5] bg-white py-1 pl-9 pr-8 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c] focus:ring-2 focus:ring-[rgba(201,168,124,0.15)]"
              />
              {searchInput && (
                <button onClick={() => { setSearchInput(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8a8a] hover:text-[#1f1f1f]">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="hidden rounded-lg border border-[#e5e0d5] bg-white sm:flex">
              <button onClick={() => setViewMode('table')} className={cn('rounded-l-lg p-2 transition-colors', viewMode === 'table' ? 'bg-[#f5f0e8] text-[#1f1f1f]' : 'text-[#8a8a8a] hover:text-[#595959]')}>
                <LayoutList size={16} />
              </button>
              <button onClick={() => setViewMode('card')} className={cn('rounded-r-lg p-2 transition-colors', viewMode === 'card' ? 'bg-[#f5f0e8] text-[#1f1f1f]' : 'text-[#8a8a8a] hover:text-[#595959]')}>
                <LayoutGrid size={16} />
              </button>
            </div>
            <button onClick={() => setShowFilters(!showFilters)} className={cn('relative rounded-lg border p-2 transition-colors', showFilters ? 'border-[#c9a87c] bg-[#f5f0e8] text-[#1f1f1f]' : 'border-[#e5e0d5] bg-white text-[#8a8a8a] hover:text-[#595959]')}>
              <Filter size={16} />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#c9a87c] text-[9px] font-bold text-white">{activeFilterCount}</span>
              )}
            </button>
            <button onClick={() => setImportOpen(true)} className="rounded-lg border border-[#e5e0d5] bg-white p-2 text-[#8a8a8a] hover:text-[#595959] transition-colors" title="Import CSV">
              <Upload size={16} />
            </button>
            {canEdit && (
              <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#b8986c]">
                <Plus size={16} /> <span className="hidden sm:inline">Add Asset</span>
              </button>
            )}
          </div>
        </div>

        {warrantySoon.length > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#fffbe6] border border-[#ffe58f] px-3 py-2">
            <AlertTriangle size={14} className="text-[#faad14] shrink-0" />
            <span className="text-xs text-[#595959]">{warrantySoon.length} asset(s) have warranty expiring within 30 days</span>
          </div>
        )}

        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-[#e5e0d5] bg-white p-3">
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="rounded-md border border-[#e5e0d5] bg-white px-2 py-1.5 text-xs text-[#1f1f1f] outline-none focus:border-[#c9a87c]">
              <option value="">All Types</option>
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-md border border-[#e5e0d5] bg-white px-2 py-1.5 text-xs text-[#1f1f1f] outline-none focus:border-[#c9a87c]">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }} className="rounded-md border border-[#e5e0d5] bg-white px-2 py-1.5 text-xs text-[#1f1f1f] outline-none focus:border-[#c9a87c]">
              <option value="">All Locations</option>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="flex items-center gap-1 rounded-md bg-[#f5f0e8] px-2 py-1.5 text-xs font-medium text-[#595959] hover:bg-[#e5e0d5] transition-colors">
                <X size={12} /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#e5e0d5] border-t-[#c9a87c]" />
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Laptop size={48} className="mb-4 text-[#e5e0d5]" />
          <h3 className="mb-1 text-lg font-medium text-[#1f1f1f]">No assets found</h3>
          <p className="mb-4 text-sm text-[#8a8a8a]">Add your first hardware asset or adjust filters</p>
          {canEdit && (
            <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-white hover:bg-[#b8986c]">
              <Plus size={16} /> Add Asset
            </button>
          )}
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onClick={() => navigate(`/assets/${asset.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e0d5] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e0d5] bg-[#f5f0e8]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">Asset Tag</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">Manufacturer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">Model</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#595959] uppercase tracking-wider">Assigned</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[#595959] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0ece3]">
              {assets.map((asset) => {
                const statusColor: Record<string, string> = { 'In Use': '#52c41a', 'Available': '#1890ff', 'In Repair': '#faad14', 'Retired': '#8a8a8a', 'Lost/Stolen': '#f5222d' };
                return (
                  <tr key={asset.id} className="hover:bg-[#fbf9f4] transition-colors cursor-pointer" onClick={() => navigate(`/assets/${asset.id}`)}>
                    <td className="px-4 py-3 font-mono text-xs text-[#1f1f1f]">{asset.asset_tag}</td>
                    <td className="px-4 py-3 text-xs font-medium text-[#1f1f1f]">{asset.name}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{asset.type}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{asset.manufacturer}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{asset.model}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: statusColor[asset.status] || '#8a8a8a' }}>
                        {asset.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{asset.location}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{asset.assigned_to_name || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button onClick={(e) => e.stopPropagation()} className="rounded p-1 text-[#8a8a8a] hover:bg-[#f5f0e8] hover:text-[#1f1f1f]">
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white border-[#e5e0d5]">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/assets/${asset.id}`); }} className="text-xs cursor-pointer">
                            <QrCode size={14} className="mr-2" /> View Details
                          </DropdownMenuItem>
                          {canEdit && (
                            <>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(asset); }} className="text-xs cursor-pointer">
                                <Pencil size={14} className="mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setQrAsset(asset); setQrOpen(true); }} className="text-xs cursor-pointer">
                                <QrCode size={14} className="mr-2" /> QR Code
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setDeletingId(asset.id); setDeleteOpen(true); }} className="text-xs cursor-pointer text-red-600">
                                <Trash2 size={14} className="mr-2" /> Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg border border-[#e5e0d5] p-1.5 text-[#8a8a8a] disabled:opacity-40 hover:bg-[#f5f0e8]">
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pg: number;
              if (totalPages <= 5) pg = i + 1;
              else if (page <= 3) pg = i + 1;
              else if (page >= totalPages - 2) pg = totalPages - 4 + i;
              else pg = page - 2 + i;
              return (
                <button key={pg} onClick={() => setPage(pg)} className={cn('h-7 w-7 rounded-lg text-xs font-medium transition-colors', page === pg ? 'bg-[#c9a87c] text-white' : 'text-[#595959] hover:bg-[#f5f0e8]')}>
                  {pg}
                </button>
              );
            })}
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="rounded-lg border border-[#e5e0d5] p-1.5 text-[#8a8a8a] disabled:opacity-40 hover:bg-[#f5f0e8]">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Asset Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#1f1f1f]">{editingAsset ? 'Edit Asset' : 'Add Asset'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#595959]">Asset Tag *</label>
                <input value={formData.asset_tag} onChange={(e) => setFormData({ ...formData, asset_tag: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="AST-0001" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#595959]">Name *</label>
                <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="MacBook Pro 16" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#595959]">Type</label>
                <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">
                  {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#595959]">Status</label>
                <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#595959]">Manufacturer</label>
                <input value={formData.manufacturer} onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="Apple" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#595959]">Model</label>
                <input value={formData.model} onChange={(e) => setFormData({ ...formData, model: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="MBP2023" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#595959]">Serial #</label>
                <input value={formData.serial_number} onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" placeholder="C02XXX" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#595959]">Location</label>
                <select value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">
                  <option value="">Select...</option>
                  {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#595959]">Purchase Date</label>
                <input type="date" value={formData.purchase_date} onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#595959]">Warranty Expiry</label>
                <input type="date" value={formData.warranty_expiry} onChange={(e) => setFormData({ ...formData, warranty_expiry: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959]">Notes</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={2} placeholder="Additional notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleSave} disabled={!formData.asset_tag || !formData.name} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">
              {editingAsset ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-[#1f1f1f]">Delete Asset</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#595959]">Are you sure you want to delete this asset? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleDelete} className="bg-red-600 text-white hover:bg-red-700">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import CSV Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#1f1f1f]">Import Assets from CSV</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-xs text-[#8a8a8a] mb-2">Paste CSV with headers: asset_tag,name,type,manufacturer,model,serial_number,status,location</p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-xs font-mono outline-none focus:border-[#c9a87c]"
              rows={10}
              placeholder="asset_tag,name,type,manufacturer,model,serial_number,status,location\nAST-001,MacBook Pro,Laptop,Apple,MBP2023,ABC123,In Use,IT Office"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleImport} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">
              <Upload size={14} className="mr-1" /> Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-[#1f1f1f]">Asset QR Code</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center py-4">
            <div className="h-40 w-40 rounded-lg border-2 border-dashed border-[#e5e0d5] flex items-center justify-center bg-[#fbf9f4]">
              <QrCode size={64} className="text-[#c9a87c]" />
            </div>
            <p className="mt-3 text-sm font-mono text-[#1f1f1f]">{qrAsset?.asset_tag}</p>
            <p className="text-xs text-[#8a8a8a]">{qrAsset?.name}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
