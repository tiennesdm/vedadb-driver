import { useState, useEffect, useCallback } from 'react';
import { Download, AlertTriangle, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

interface SystemSettings {
  portalName: string;
  companyName: string;
  theme: 'light' | 'dark' | 'system';
  dateFormat: string;
  itemsPerPage: number;
  sessionTimeout: number;
  timezone: string;
  defaultPriority: string;
  autoAssign: boolean;
  slaWarning: number;
  slaBreach: number;
}

const DEFAULT_SETTINGS: SystemSettings = {
  portalName: 'VedaDesk',
  companyName: '',
  theme: 'light',
  dateFormat: 'MMM d, yyyy',
  itemsPerPage: 10,
  sessionTimeout: 60,
  timezone: 'UTC',
  defaultPriority: 'medium',
  autoAssign: false,
  slaWarning: 24,
  slaBreach: 48,
};

export default function SystemTab({ showToast }: Props) {
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('vedadesk_system_settings');
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch { /* ignore */ }
    }
  }, []);

  const persist = useCallback((newSettings: SystemSettings) => {
    setSettings(newSettings);
    localStorage.setItem('vedadesk_system_settings', JSON.stringify(newSettings));
  }, []);

  const updateField = <K extends keyof SystemSettings>(
    key: K,
    value: SystemSettings[K]
  ) => {
    const updated = { ...settings, [key]: value };
    persist(updated);
    showToast('Setting saved', 'success');
  };

  const exportData = () => {
    try {
      const data: Record<string, string | null> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('vedadesk_')) {
          data[key] = localStorage.getItem(key);
        }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vedadesk-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data exported successfully', 'success');
    } catch {
      showToast('Failed to export data', 'error');
    }
  };

  const clearCache = () => {
    try {
      // Clear everything except core auth
      const keysToPreserve = ['vedadesk_user', 'vedadesk_seeded'];
      const preserved: Record<string, string | null> = {};
      keysToPreserve.forEach((key) => {
        preserved[key] = localStorage.getItem(key);
      });
      // Remove all vedadesk_ keys
      const allKeys = Object.keys(localStorage).filter((k) => k.startsWith('vedadesk_'));
      allKeys.forEach((key) => localStorage.removeItem(key));
      // Restore preserved keys
      Object.entries(preserved).forEach(([key, value]) => {
        if (value !== null) localStorage.setItem(key, value);
      });
      // Reset to defaults
      setSettings(DEFAULT_SETTINGS);
      showToast('Application cache cleared', 'success');
    } catch {
      showToast('Failed to clear cache', 'error');
    }
  };

  const resetAllData = useCallback(() => {
    try {
      // Remove vedadesk_db and vedadesk_seeded to force re-seed
      localStorage.removeItem('vedadesk_db');
      localStorage.removeItem('vedadesk_seeded');
      // Clear all other vedadesk_ keys except user
      const allKeys = Object.keys(localStorage).filter(
        (k) => k.startsWith('vedadesk_') && k !== 'vedadesk_user'
      );
      allKeys.forEach((key) => localStorage.removeItem(key));
      showToast('All data will be reset. Reloading...', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch {
      showToast('Failed to reset data', 'error');
    }
  }, [showToast]);

  return (
    <div>
      <h2 className="text-2xl font-medium text-[#1f1f1f] tracking-tight">System Settings</h2>
      <p className="mt-1 text-sm text-[#595959]">Configure portal-wide settings.</p>

      {/* Portal Information */}
      <div className="mt-8 rounded-xl border border-[#e5e0d5] bg-white p-6">
        <h3 className="text-base font-medium text-[#1f1f1f]">Portal Information</h3>
        <div className="mt-5 max-w-lg space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              Portal Name
            </Label>
            <Input
              value={settings.portalName}
              onChange={(e) => updateField('portalName', e.target.value)}
              placeholder="VedaDesk"
              className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              Company Name
            </Label>
            <Input
              value={settings.companyName}
              onChange={(e) => updateField('companyName', e.target.value)}
              placeholder="Your company"
              className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              Timezone
            </Label>
            <Select
              value={settings.timezone}
              onValueChange={(v) => updateField('timezone', v)}
            >
              <SelectTrigger className="h-10 w-full border-[#e5e0d5] focus:ring-[rgba(201,168,124,0.15)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                <SelectItem value="Europe/London">London (GMT)</SelectItem>
                <SelectItem value="Europe/Berlin">Central European (CET)</SelectItem>
                <SelectItem value="Asia/Tokyo">Japan (JST)</SelectItem>
                <SelectItem value="Asia/Shanghai">China (CST)</SelectItem>
                <SelectItem value="Asia/Kolkata">India (IST)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              Theme Preference
            </Label>
            <Select
              value={settings.theme}
              onValueChange={(v: 'light' | 'dark' | 'system') => updateField('theme', v)}
            >
              <SelectTrigger className="h-10 w-full border-[#e5e0d5] focus:ring-[rgba(201,168,124,0.15)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              Date Format
            </Label>
            <Select
              value={settings.dateFormat}
              onValueChange={(v) => updateField('dateFormat', v)}
            >
              <SelectTrigger className="h-10 w-full border-[#e5e0d5] focus:ring-[rgba(201,168,124,0.15)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MMM d, yyyy">Dec 4, 2024</SelectItem>
                <SelectItem value="dd/MM/yyyy">04/12/2024</SelectItem>
                <SelectItem value="yyyy-MM-dd">2024-12-04</SelectItem>
                <SelectItem value="MM/dd/yyyy">12/04/2024</SelectItem>
                <SelectItem value="d MMM yyyy">4 Dec 2024</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              Items Per Page
            </Label>
            <Select
              value={String(settings.itemsPerPage)}
              onValueChange={(v) => updateField('itemsPerPage', Number(v))}
            >
              <SelectTrigger className="h-10 w-full border-[#e5e0d5] focus:ring-[rgba(201,168,124,0.15)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              Session Timeout (minutes)
            </Label>
            <Input
              type="number"
              min={5}
              max={240}
              value={settings.sessionTimeout}
              onChange={(e) => updateField('sessionTimeout', Math.max(5, Math.min(240, Number(e.target.value))))}
              placeholder="60"
              className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
          </div>
        </div>
      </div>

      {/* Ticket Settings */}
      <div className="mt-8 rounded-xl border border-[#e5e0d5] bg-white p-6">
        <h3 className="text-base font-medium text-[#1f1f1f]">Ticket Settings</h3>
        <div className="mt-5 max-w-lg space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              Default Priority
            </Label>
            <Select
              value={settings.defaultPriority}
              onValueChange={(v) => updateField('defaultPriority', v)}
            >
              <SelectTrigger className="h-10 w-full border-[#e5e0d5] focus:ring-[rgba(201,168,124,0.15)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold text-[#1f1f1f]">Auto-Assign</p>
              <p className="text-xs text-[#8a8a8a] mt-0.5">
                Automatically assign new tickets to least busy agent
              </p>
            </div>
            <Switch
              checked={settings.autoAssign}
              onCheckedChange={(v) => updateField('autoAssign', v)}
              className="shrink-0 data-[state=checked]:bg-[#c9a87c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              SLA Warning Threshold (hours)
            </Label>
            <Input
              type="number"
              min={1}
              max={168}
              value={settings.slaWarning}
              onChange={(e) => updateField('slaWarning', Math.max(1, Math.min(168, Number(e.target.value))))}
              className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
              SLA Breach Threshold (hours)
            </Label>
            <Input
              type="number"
              min={1}
              max={720}
              value={settings.slaBreach}
              onChange={(e) => updateField('slaBreach', Math.max(1, Math.min(720, Number(e.target.value))))}
              className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="mt-8 rounded-xl border border-[#e5e0d5] bg-white p-6">
        <h3 className="text-base font-medium text-[#1f1f1f]">Data Management</h3>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={exportData}
            className="flex items-center justify-center gap-2 rounded-lg border border-[#e5e0d5] bg-[#f5f0e8] px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition-all hover:bg-[#ede7db] active:scale-[0.98]"
          >
            <Download size={16} />
            Export All Data
          </button>

          <button
            onClick={clearCache}
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-[#595959] transition-all hover:bg-[rgba(0,0,0,0.04)] active:scale-[0.98]"
          >
            <Trash2 size={16} />
            Clear Application Cache
          </button>
        </div>

        <Separator className="my-6 bg-[#e5e0d5]" />

        {/* Danger Zone */}
        <div className="rounded-lg border border-[#f5222d]/20 bg-[#fff1f0] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 text-[#f5222d] shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-[#1f1f1f]">Reset All Data</h4>
              <p className="text-xs text-[#595959] mt-1">
                This will clear all data from localStorage and re-seed the database with demo data.
                Your user session will be preserved. This action cannot be undone.
              </p>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="mt-3 flex items-center gap-2 rounded-lg border border-[#f5222d] bg-white px-4 py-2 text-sm font-medium text-[#f5222d] transition-all hover:bg-[#ffccc7] active:scale-[0.98]"
              >
                <AlertTriangle size={14} />
                Reset to Demo Data
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="mt-8 rounded-xl border border-[#e5e0d5] bg-white p-6">
        <h3 className="text-base font-medium text-[#1f1f1f]">About</h3>
        <div className="mt-4 space-y-2">
          <p className="text-sm text-[#595959]">
            <span className="font-medium">Version:</span> VedaDesk v1.0.0
          </p>
          <p className="text-sm text-[#595959]">
            <span className="font-medium">Powered by:</span>{' '}
            <span className="text-[#c9a87c] font-medium">VedaDB</span>
          </p>
          <p className="text-xs text-[#8a8a8a] mt-1">
            Build: {new Date().toISOString().split('T')[0]}
          </p>
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowResetConfirm(false)} />
          <div className="relative z-50 w-full max-w-[420px] rounded-2xl border border-[#e5e0d5] bg-white p-6 shadow-xl mx-4">
            <div className="flex items-center gap-3">
              <AlertTriangle size={22} className="text-[#f5222d]" />
              <h3 className="text-lg font-semibold text-[#1f1f1f]">Reset All Data?</h3>
            </div>
            <p className="mt-3 text-sm text-[#595959]">
              This will permanently delete all tickets, comments, and knowledge articles, then
              re-seed the database with fresh demo data. Your account will remain intact.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="rounded-lg border border-[#e5e0d5] px-4 py-2 text-sm font-medium text-[#595959] transition-all hover:bg-[#f5f0e8]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowResetConfirm(false);
                  resetAllData();
                }}
                className="rounded-lg bg-[#f5222d] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#d91f29] active:scale-[0.98]"
              >
                Yes, Reset Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
