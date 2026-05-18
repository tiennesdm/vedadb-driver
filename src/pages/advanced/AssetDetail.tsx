/**
 * AssetDetail — Full asset details with timeline
 * Route: /assets/:id
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAppStore from '@/lib/vedadb-store';
import AssetTimeline, { AssetLifecycle } from '@/components/advanced/AssetTimeline';
import CIRelationshipGraph from '@/components/advanced/CIRelationshipGraph';
import { usePermission } from '@/hooks/useRBAC';
import {
  ArrowLeft, Laptop, Pencil, Tag, Building2, MapPin, User, Calendar,
  AlertTriangle, CheckCircle2, Wrench, FileText, Link2, Clock,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface AssetDetailData {
  id: number;
  asset_tag: string;
  name: string;
  type: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  status: string;
  location: string;
  assigned_to: string;
  assigned_to_name: string;
  purchase_date: string;
  warranty_expiry: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface TimelineEvent {
  id: number;
  event: string;
  date: string;
  user_name?: string;
  type: 'purchase' | 'deploy' | 'assign' | 'maintain' | 'retire' | 'note';
}

interface LinkedTicket {
  id: number;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  ticket_type: string;
}

const STATUS_COLORS: Record<string, string> = {
  'In Use': '#52c41a', 'Available': '#1890ff', 'In Repair': '#faad14',
  'Retired': '#8a8a8a', 'Lost/Stolen': '#f5222d',
};

const STATUS_STAGE_MAP: Record<string, string> = {
  'Available': 'purchased', 'In Use': 'in_use', 'In Repair': 'maintenance',
  'Retired': 'retired', 'Lost/Stolen': 'retired',
};

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useAppStore((s) => s.query);
  const update = useAppStore((s) => s.update);
  const canEdit = usePermission('ticket:edit:all' as any);

  const [asset, setAsset] = useState<AssetDetailData | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [tickets, setTickets] = useState<LinkedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState<Partial<AssetDetailData>>({});
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceNote, setMaintenanceNote] = useState('');

  const fetchAsset = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const result = await query(`SELECT a.*, u.name as assigned_to_name FROM hardware_assets a LEFT JOIN users u ON a.assigned_to = u.id WHERE a.id = ${id}`);
      const objs = result.toObjects() as unknown as AssetDetailData[];
      if (objs.length > 0) {
        setAsset(objs[0]);
        setEditData(objs[0]);
      }

      // Timeline
      const tlResult = await query(`SELECT * FROM asset_timeline WHERE asset_id = ${id} ORDER BY created_at DESC`);
      setTimeline(tlResult.toObjects() as unknown as TimelineEvent[]);

      // Linked tickets
      const tkResult = await query(`SELECT t.id, t.title, t.status, t.priority, t.created_at, t.ticket_type FROM tickets t JOIN ticket_assets ta ON t.id = ta.ticket_id WHERE ta.asset_id = ${id} ORDER BY t.created_at DESC`);
      setTickets(tkResult.toObjects() as unknown as LinkedTicket[]);
    } catch (e) {
      // tables may not exist
    }
    setLoading(false);
  }, [id, query]);

  useEffect(() => { fetchAsset(); }, [fetchAsset]);

  const handleUpdate = async () => {
    if (!asset || !id) return;
    await update('hardware_assets', {
      ...editData,
      updated_at: new Date().toISOString(),
    } as Record<string, string | number | null>, { id: Number(id) });
    setEditOpen(false);
    fetchAsset();
  };

  const addMaintenanceLog = async () => {
    if (!id || !maintenanceNote.trim()) return;
    try {
      await useAppStore.getState().insert('asset_timeline', {
        asset_id: id,
        event: `Maintenance: ${maintenanceNote}`,
        type: 'maintain',
        created_at: new Date().toISOString(),
        user_id: useAppStore.getState().currentUser?.id?.toString() || '',
      });
    } catch { /* table may not exist */ }
    setMaintenanceNote('');
    setMaintenanceOpen(false);
    fetchAsset();
  };

  const warrantyDaysLeft = asset?.warranty_expiry
    ? Math.max(0, Math.ceil((new Date(asset.warranty_expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const relationships = [
    { id: 1, from_ci: asset?.name || '', from_type: asset?.type || '', to_ci: 'Corporate WiFi', to_type: 'Network Device', relation_type: 'connected_to' },
    { id: 2, from_ci: asset?.name || '', from_type: asset?.type || '', to_ci: 'Docking Station', to_type: 'Peripheral', relation_type: 'installed_on' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#e5e0d5] border-t-[#c9a87c]" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle size={48} className="mb-4 text-[#faad14]" />
        <h2 className="text-lg font-medium text-[#1f1f1f]">Asset not found</h2>
        <button onClick={() => navigate('/assets')} className="mt-4 flex items-center gap-2 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-white hover:bg-[#b8986c]">
          <ArrowLeft size={16} /> Back to Assets
        </button>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 bg-[#fbf9f4]/95 px-4 py-3 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/assets')} className="rounded-lg p-2 text-[#8a8a8a] hover:bg-[#f5f0e8]">
              <ArrowLeft size={18} />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ backgroundColor: STATUS_COLORS[asset.status] || '#8a8a8a' }}>
              <Laptop size={20} />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[#1f1f1f]">{asset.name}</h2>
              <div className="flex items-center gap-2 text-xs text-[#8a8a8a]">
                <Tag size={12} />
                <span className="font-mono">{asset.asset_tag}</span>
                <span>•</span>
                <span>{asset.type}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ backgroundColor: STATUS_COLORS[asset.status] || '#8a8a8a' }}>
              {asset.status}
            </span>
            {canEdit && (
              <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-xs font-medium text-[#595959] hover:bg-[#f5f0e8]">
                <Pencil size={14} /> Edit
              </button>
            )}
          </div>
        </div>

        {/* Lifecycle */}
        <div className="mt-3">
          <AssetLifecycle currentStage={STATUS_STAGE_MAP[asset.status] || 'purchased'} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column — Details */}
        <div className="space-y-4 lg:col-span-2">
          {/* Asset Info */}
          <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#1f1f1f]">Asset Information</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Manufacturer', value: asset.manufacturer, icon: <Building2 size={14} /> },
                { label: 'Model', value: asset.model, icon: <Laptop size={14} /> },
                { label: 'Serial #', value: asset.serial_number, icon: <Tag size={14} /> },
                { label: 'Location', value: asset.location, icon: <MapPin size={14} /> },
                { label: 'Assigned To', value: asset.assigned_to_name || 'Unassigned', icon: <User size={14} /> },
                { label: 'Purchase Date', value: asset.purchase_date ? new Date(asset.purchase_date).toLocaleDateString() : '—', icon: <Calendar size={14} /> },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-[#fbf9f4] p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-[#8a8a8a] uppercase tracking-wider">
                    {item.icon}
                    {item.label}
                  </div>
                  <p className="text-sm font-medium text-[#1f1f1f] truncate">{item.value || '—'}</p>
                </div>
              ))}
            </div>

            {/* Warranty countdown */}
            {warrantyDaysLeft !== null && (
              <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 ${warrantyDaysLeft <= 30 ? 'bg-[#fff2f0] border border-[#ffccc7]' : warrantyDaysLeft <= 90 ? 'bg-[#fffbe6] border border-[#ffe58f]' : 'bg-[#f6ffed] border border-[#b7eb8f]'}`}>
                {warrantyDaysLeft <= 30 ? <AlertTriangle size={16} className="text-[#f5222d]" /> : warrantyDaysLeft <= 90 ? <Clock size={16} className="text-[#faad14]" /> : <CheckCircle2 size={16} className="text-[#52c41a]" />}
                <span className="text-xs font-medium" style={{ color: warrantyDaysLeft <= 30 ? '#f5222d' : warrantyDaysLeft <= 90 ? '#faad14' : '#52c41a' }}>
                  {warrantyDaysLeft === 0 ? 'Warranty expired' : `${warrantyDaysLeft} days remaining on warranty`}
                </span>
              </div>
            )}

            {asset.notes && (
              <div className="mt-3 rounded-lg bg-[#fbf9f4] p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-[#8a8a8a]">
                  <FileText size={12} /> Notes
                </div>
                <p className="text-xs text-[#595959]">{asset.notes}</p>
              </div>
            )}
          </div>

          {/* Linked Tickets */}
          <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 size={16} className="text-[#c9a87c]" />
                <h3 className="text-sm font-semibold text-[#1f1f1f]">Linked Tickets</h3>
                <span className="rounded-full bg-[#f5f0e8] px-2 py-0.5 text-xs text-[#595959]">{tickets.length}</span>
              </div>
            </div>
            {tickets.length === 0 ? (
              <p className="py-4 text-center text-xs text-[#8a8a8a]">No tickets linked to this asset</p>
            ) : (
              <div className="space-y-2">
                {tickets.map((t) => {
                  const stColors: Record<string, string> = { open: '#1890ff', in_progress: '#faad14', resolved: '#52c41a', closed: '#8a8a8a', on_hold: '#722ed1' };
                  return (
                    <div key={t.id} className="flex items-center justify-between rounded-lg border border-[#e5e0d5] px-3 py-2 hover:bg-[#fbf9f4] cursor-pointer transition-colors" onClick={() => navigate(`/tickets/${t.id}`)}>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#1f1f1f] truncate">{t.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="rounded bg-[#f5f0e8] px-1.5 py-0.5 text-[10px] text-[#595959]">#{t.id}</span>
                          <span className="text-[10px] text-[#8a8a8a]">{new Date(t.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: stColors[t.status] || '#8a8a8a' }}>
                        {t.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* CI Relationships */}
          <CIRelationshipGraph relationships={relationships} rootAsset={asset.name} />
        </div>

        {/* Right column — Timeline & Maintenance */}
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-[#c9a87c]" />
                <h3 className="text-sm font-semibold text-[#1f1f1f]">Activity Timeline</h3>
              </div>
              {canEdit && (
                <button onClick={() => setMaintenanceOpen(true)} className="flex items-center gap-1 rounded-md bg-[#c9a87c] px-2 py-1 text-[10px] font-medium text-white hover:bg-[#b8986c]">
                  <Wrench size={12} /> Log
                </button>
              )}
            </div>
            <AssetTimeline events={timeline.length > 0 ? timeline : [
              { id: 1, event: 'Asset created', date: asset.created_at, type: 'purchase' },
              { id: 2, event: `Status set to ${asset.status}`, date: asset.updated_at, type: 'deploy' },
            ]} />
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-white border-[#e5e0d5] max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#1f1f1f]">Edit Asset</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#595959]">Asset Tag</label>
                <input value={editData.asset_tag || ''} onChange={(e) => setEditData({ ...editData, asset_tag: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#595959]">Name</label>
                <input value={editData.name || ''} onChange={(e) => setEditData({ ...editData, name: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959]">Status</label>
              <select value={editData.status || ''} onChange={(e) => setEditData({ ...editData, status: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]">
                {['In Use', 'Available', 'In Repair', 'Retired', 'Lost/Stolen'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959]">Location</label>
              <input value={editData.location || ''} onChange={(e) => setEditData({ ...editData, location: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#595959]">Notes</label>
              <textarea value={editData.notes || ''} onChange={(e) => setEditData({ ...editData, notes: e.target.value })} className="mt-1 w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={handleUpdate} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maintenance Log Dialog */}
      <Dialog open={maintenanceOpen} onOpenChange={setMaintenanceOpen}>
        <DialogContent className="bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-[#1f1f1f]">Add Maintenance Log</DialogTitle>
          </DialogHeader>
          <textarea
            value={maintenanceNote}
            onChange={(e) => setMaintenanceNote(e.target.value)}
            className="w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9a87c]"
            rows={4}
            placeholder="Describe the maintenance activity..."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaintenanceOpen(false)} className="border-[#e5e0d5] text-[#595959]">Cancel</Button>
            <Button onClick={addMaintenanceLog} className="bg-[#c9a87c] text-white hover:bg-[#b8986c]">Add Log</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
