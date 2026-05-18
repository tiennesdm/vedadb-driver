/**
 * Canned Responses — Manage reusable response templates with
 * search, categories, variable placeholders, and clipboard copy.
 */
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquareText,
  Plus,
  Pencil,
  Trash2,
  Search,
  Copy,
  Check,
  Tag,
  Save,
  AlertTriangle,
  Hash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CannedResponse {
  id: number;
  title: string;
  content: string;
  category: string;
  usageCount: number;
  createdBy: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_RESPONSES: CannedResponse[] = [
  {
    id: 1,
    title: 'Password Reset Instructions',
    content: 'Hi {{user.name}},\n\nWe have received your password reset request for ticket #{{ticket.id}}.\n\nPlease follow these steps:\n1. Visit the self-service portal\n2. Click "Forgot Password"\n3. Enter your email address\n4. Follow the link in your inbox\n\nIf you need further assistance, please reply to this ticket.\n\nBest regards,\nSupport Team',
    category: 'Access',
    usageCount: 342,
    createdBy: 'Sarah Chen',
    updatedAt: '2024-12-01T10:00:00Z',
  },
  {
    id: 2,
    title: 'VPN Troubleshooting',
    content: 'Hello {{user.name}},\n\nThank you for reporting the VPN issue (ticket #{{ticket.id}}). Let\'s try these steps:\n\n1. Disconnect and reconnect to VPN\n2. Clear your DNS cache: ipconfig /flushdns\n3. Try an alternate server location\n4. Restart your network adapter\n\nPlease let us know which step resolved the issue, or if you need further help.\n\nRegards,\nIT Support',
    category: 'Network',
    usageCount: 198,
    createdBy: 'Mike Ross',
    updatedAt: '2024-11-28T14:00:00Z',
  },
  {
    id: 3,
    title: 'Hardware Request Acknowledgment',
    content: 'Hi {{user.name}},\n\nWe have received your hardware request for ticket #{{ticket.id}}. Our procurement team will review and process your request within 2-3 business days.\n\nYou will receive an update once the equipment is ordered and an estimated delivery date.\n\nThanks,\nFacilities Team',
    category: 'Hardware',
    usageCount: 156,
    createdBy: 'John Doe',
    updatedAt: '2024-11-25T09:00:00Z',
  },
  {
    id: 4,
    title: 'Software License Approved',
    content: 'Hello {{user.name}},\n\nYour software license request for ticket #{{ticket.id}} has been approved.\n\nYou can now download and install the software from the internal app store. Your license key has been attached to this ticket.\n\nIf you encounter any issues during installation, please let us know.\n\nBest,\nEngineering Team',
    category: 'Software',
    usageCount: 89,
    createdBy: 'David Kim',
    updatedAt: '2024-12-02T11:00:00Z',
  },
  {
    id: 5,
    title: 'Ticket Escalation Notice',
    content: 'Hi {{user.name}},\n\nYour ticket #{{ticket.id}} has been escalated to our senior support team due to its complexity/priority level.\n\nA specialist will be assigned within the next 30 minutes and will reach out with an action plan.\n\nWe appreciate your patience.\n\nRegards,\nSupport Management',
    category: 'General',
    usageCount: 67,
    createdBy: 'Emily Wang',
    updatedAt: '2024-11-30T16:00:00Z',
  },
  {
    id: 6,
    title: 'Remote Desktop Setup',
    content: 'Hello {{user.name}},\n\nFor ticket #{{ticket.id}}, here are the steps to set up remote desktop access:\n\n1. Enable Remote Desktop in System Settings\n2. Note down your computer name\n3. Provide your IP address to IT\n4. We will configure firewall rules\n5. Test connection from remote location\n\nLet us know once you\'ve completed steps 1-3.\n\nThanks,\nIT Support',
    category: 'Access',
    usageCount: 45,
    createdBy: 'Sarah Chen',
    updatedAt: '2024-12-03T08:00:00Z',
  },
];

const CATEGORIES = ['All', 'Access', 'Hardware', 'Network', 'Software', 'General'];

const CATEGORY_COLORS: Record<string, string> = {
  Access: '#1890ff',
  Hardware: '#c9a87c',
  Network: '#722ed1',
  Software: '#52c41a',
  General: '#8c8c8c',
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function CannedResponses() {
  const [responses, setResponses] = useState<CannedResponse[]>(INITIAL_RESPONSES);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CannedResponse | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CannedResponse | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const [form, setForm] = useState<Partial<CannedResponse>>({
    title: '',
    content: '',
    category: 'General',
  });

  const filtered = useMemo(() => {
    return responses.filter((r) => {
      const matchesCategory = activeCategory === 'All' || r.category === activeCategory;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.content.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [responses, activeCategory, searchQuery]);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', content: '', category: 'General' });
    setModalOpen(true);
  };

  const openEdit = (r: CannedResponse) => {
    setEditing(r);
    setForm({ ...r });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.title || !form.content) return;
    if (editing) {
      setResponses((prev) =>
        prev.map((r) => (r.id === editing.id ? { ...r, ...form, updatedAt: new Date().toISOString() } as CannedResponse : r))
      );
    } else {
      const newResp: CannedResponse = {
        ...form as CannedResponse,
        id: Date.now(),
        usageCount: 0,
        createdBy: 'Current User',
        updatedAt: new Date().toISOString(),
      };
      setResponses((prev) => [newResp, ...prev]);
    }
    setModalOpen(false);
  };

  const handleDelete = () => {
    if (deleteConfirm) {
      setResponses((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    }
  };

  const copyToClipboard = useCallback(async (content: string, id: number) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Highlight variables in content preview
  const renderPreview = (content: string) => {
    const parts = content.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, i) => {
      if (part.match(/\{\{[^}]+\}\}/)) {
        return (
          <span key={i} className="px-1 py-0.5 rounded text-xs font-mono" style={{ background: '#c9a87c20', color: '#c9a87c' }}>
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <MessageSquareText className="w-6 h-6" style={{ color: '#c9a87c' }} />
            Canned Responses
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Reusable response templates for common scenarios
          </p>
        </div>
        <Button onClick={openCreate} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
          <Plus className="w-4 h-4 mr-1" /> New Response
        </Button>
      </div>

      {/* Search + Category Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#595959' }} />
          <Input
            placeholder="Search responses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 rounded-lg border-[#e5e0d5]"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory(cat)}
              className="rounded-lg text-xs"
              style={
                activeCategory === cat
                  ? { background: '#c9a87c', color: '#fff', borderColor: '#c9a87c' }
                  : { borderColor: '#e5e0d5', color: '#595959' }
              }
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Responses Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnimatePresence>
          {filtered.map((resp, idx) => {
            const catColor = CATEGORY_COLORS[resp.category] || '#8c8c8c';
            return (
              <motion.div
                key={resp.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className="h-full hover:shadow-md transition-shadow" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap flex-1">
                        <h3 className="font-semibold text-sm text-[#1f1f1f]">{resp.title}</h3>
                        <Badge style={{ background: catColor + '20', color: catColor, border: 'none' }} className="text-[10px]">
                          <Tag className="w-2.5 h-2.5 mr-0.5" />
                          {resp.category}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7"
                          onClick={() => copyToClipboard(resp.content, resp.id)}
                        >
                          {copiedId === resp.id ? (
                            <Check className="w-3.5 h-3.5" style={{ color: '#52c41a' }} />
                          ) : (
                            <Copy className="w-3.5 h-3.5" style={{ color: '#595959' }} />
                          )}
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => openEdit(resp)}>
                          <Pencil className="w-3.5 h-3.5" style={{ color: '#595959' }} />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => setDeleteConfirm(resp)}>
                          <Trash2 className="w-3.5 h-3.5" style={{ color: '#f5222d' }} />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 p-3 rounded-lg text-xs leading-relaxed whitespace-pre-wrap" style={{ background: '#fbf9f4', color: '#595959' }}>
                      {renderPreview(resp.content.substring(0, 200))}
                      {resp.content.length > 200 && '...'}
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid #f5f0e8' }}>
                      <div className="flex items-center gap-3 text-[10px]" style={{ color: '#8c8c8c' }}>
                        <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {resp.usageCount} uses</span>
                        <span>By {resp.createdBy}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-sm" style={{ color: '#595959' }}>
          <MessageSquareText className="w-10 h-10 mx-auto mb-3" style={{ color: '#e5e0d5' }} />
          No canned responses match your search.
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={(v) => !v && setModalOpen(false)}>
        <DialogContent className="sm:max-w-xl" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
              <MessageSquareText className="w-4 h-4" style={{ color: '#c9a87c' }} />
              {editing ? 'Edit Response' : 'New Canned Response'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Response title" className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="rounded-lg border-[#e5e0d5]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea value={form.content || ''} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Use {{user.name}}, {{ticket.id}} for variables..." rows={8} className="rounded-lg border-[#e5e0d5] font-mono text-xs leading-relaxed" />
              <p className="text-[10px]" style={{ color: '#8c8c8c' }}>
                Available variables: {'{{user.name}}'}, {'{{ticket.id}}'}, {'{{ticket.title}}'}, {'{{agent.name}}'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} className="rounded-lg border-[#e5e0d5]">Cancel</Button>
            <Button onClick={handleSave} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
              <Save className="w-4 h-4 mr-1" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
              <AlertTriangle className="w-5 h-5 text-[#f5222d]" />
              Delete Response
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm" style={{ color: '#595959' }}>
            Delete <strong className="text-[#1f1f1f]">{deleteConfirm?.title}</strong>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="rounded-lg border-[#e5e0d5]">Cancel</Button>
            <Button onClick={handleDelete} className="rounded-lg" style={{ background: '#f5222d', color: '#fff' }}>
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
