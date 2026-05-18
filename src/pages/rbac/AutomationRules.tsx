/**
 * Automation Rules — Workflow automation with rule builder,
 * trigger/condition/action system, and rule testing.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Workflow,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Play,
  Zap,
  ArrowRight,
  Save,
  AlertTriangle,
  X,
  CheckCircle,
  Clock,
  TicketCheck,
  Send,
  MessageSquare,
  RefreshCw,
  UserCircle,
  Tag,
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
import { Switch } from '@/components/ui/switch';
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

type TriggerType = 'ticket_create' | 'ticket_update' | 'schedule';
type ConditionField = 'priority' | 'status' | 'category' | 'assignee';
type ConditionOp = 'equals' | 'not_equals' | 'contains' | 'empty';
type ActionType = 'assign_to' | 'change_status' | 'add_comment' | 'send_notification' | 'update_field';

interface RuleCondition {
  id: string;
  field: ConditionField;
  operator: ConditionOp;
  value: string;
}

interface RuleAction {
  id: string;
  type: ActionType;
  target: string;
  value: string;
}

interface AutomationRule {
  id: number;
  name: string;
  description: string;
  trigger: TriggerType;
  conditions: RuleCondition[];
  actions: RuleAction[];
  active: boolean;
  lastRun?: string;
  runCount: number;
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_RULES: AutomationRule[] = [
  {
    id: 1,
    name: 'Auto-assign Critical Tickets',
    description: 'Immediately assign critical priority tickets to the on-call engineer',
    trigger: 'ticket_create',
    conditions: [
      { id: 'c1', field: 'priority', operator: 'equals', value: 'Critical' },
    ],
    actions: [
      { id: 'a1', type: 'assign_to', target: 'assignee', value: 'John Doe' },
      { id: 'a2', type: 'add_comment', target: 'comment', value: 'Auto-assigned to on-call engineer due to critical priority.' },
    ],
    active: true,
    lastRun: '2024-12-04T09:15:00Z',
    runCount: 142,
  },
  {
    id: 2,
    name: 'Escalate Unassigned High Priority',
    description: 'Escalate high priority tickets that have been unassigned for more than 1 hour',
    trigger: 'schedule',
    conditions: [
      { id: 'c1', field: 'priority', operator: 'equals', value: 'High' },
      { id: 'c2', field: 'assignee', operator: 'empty', value: '' },
    ],
    actions: [
      { id: 'a1', type: 'send_notification', target: 'slack', value: 'High priority ticket unassigned for >1h' },
      { id: 'a2', type: 'update_field', target: 'status', value: 'Escalated' },
    ],
    active: true,
    lastRun: '2024-12-04T08:00:00Z',
    runCount: 89,
  },
  {
    id: 3,
    name: 'Close Resolved After 48h',
    description: 'Automatically close tickets that have been in Resolved status for 48 hours',
    trigger: 'schedule',
    conditions: [
      { id: 'c1', field: 'status', operator: 'equals', value: 'Resolved' },
    ],
    actions: [
      { id: 'a1', type: 'change_status', target: 'status', value: 'Closed' },
      { id: 'a2', type: 'add_comment', target: 'comment', value: 'Auto-closed after 48h in Resolved status.' },
    ],
    active: false,
    lastRun: '2024-12-03T06:00:00Z',
    runCount: 215,
  },
  {
    id: 4,
    name: 'Notify on Status Change',
    description: 'Send email notification to requester when ticket status changes',
    trigger: 'ticket_update',
    conditions: [
      { id: 'c1', field: 'status', operator: 'not_equals', value: 'Open' },
    ],
    actions: [
      { id: 'a1', type: 'send_notification', target: 'email', value: 'Your ticket status has been updated' },
    ],
    active: true,
    lastRun: '2024-12-04T10:30:00Z',
    runCount: 412,
  },
  {
    id: 5,
    name: 'Tag Hardware Requests',
    description: 'Automatically categorize hardware-related tickets',
    trigger: 'ticket_create',
    conditions: [
      { id: 'c1', field: 'category', operator: 'equals', value: 'Hardware' },
    ],
    actions: [
      { id: 'a1', type: 'update_field', target: 'tags', value: 'hardware, procurement' },
      { id: 'a2', type: 'assign_to', target: 'assignee', value: 'Facilities Team' },
    ],
    active: true,
    lastRun: '2024-12-04T07:45:00Z',
    runCount: 67,
  },
];

const TRIGGER_LABELS: Record<TriggerType, string> = {
  ticket_create: 'On Ticket Create',
  ticket_update: 'On Ticket Update',
  schedule: 'On Schedule',
};

const TRIGGER_ICONS: Record<TriggerType, React.ReactNode> = {
  ticket_create: <TicketCheck className="w-4 h-4" />,
  ticket_update: <RefreshCw className="w-4 h-4" />,
  schedule: <Clock className="w-4 h-4" />,
};

const ACTION_ICONS: Record<ActionType, React.ReactNode> = {
  assign_to: <UserCircle className="w-3.5 h-3.5" />,
  change_status: <RefreshCw className="w-3.5 h-3.5" />,
  add_comment: <MessageSquare className="w-3.5 h-3.5" />,
  send_notification: <Send className="w-3.5 h-3.5" />,
  update_field: <Tag className="w-3.5 h-3.5" />,
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function AutomationRules() {
  const [rules, setRules] = useState<AutomationRule[]>(INITIAL_RULES);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AutomationRule | null>(null);
  const [testResult, setTestResult] = useState<{ ruleName: string; passed: boolean; message: string } | null>(null);

  const [form, setForm] = useState<Partial<AutomationRule>>({
    name: '',
    description: '',
    trigger: 'ticket_create',
    conditions: [],
    actions: [],
    active: true,
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', trigger: 'ticket_create', conditions: [], actions: [], active: true });
    setEditorOpen(true);
  };

  const openEdit = (r: AutomationRule) => {
    setEditing(r);
    setForm({ ...r });
    setEditorOpen(true);
  };

  const handleSave = () => {
    if (!form.name) return;
    if (editing) {
      setRules((prev) => prev.map((r) => (r.id === editing.id ? { ...r, ...form } as AutomationRule : r)));
    } else {
      const newRule: AutomationRule = {
        ...form as AutomationRule,
        id: Date.now(),
        runCount: 0,
      };
      setRules((prev) => [...prev, newRule]);
    }
    setEditorOpen(false);
  };

  const toggleActive = (id: number) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));
  };

  const handleDelete = () => {
    if (deleteConfirm) {
      setRules((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    }
  };

  const testRule = (rule: AutomationRule) => {
    const passed = rule.conditions.length > 0 && rule.actions.length > 0;
    setTestResult({
      ruleName: rule.name,
      passed,
      message: passed
        ? `Rule "${rule.name}" would execute ${rule.actions.length} action(s) when ${TRIGGER_LABELS[rule.trigger].toLowerCase()}.`
        : `Rule "${rule.name}" has missing conditions or actions and would not execute.`,
    });
  };

  const addCondition = () => {
    setForm({
      ...form,
      conditions: [...(form.conditions || []), { id: Date.now().toString(), field: 'priority', operator: 'equals', value: '' }],
    });
  };

  const updateCondition = (id: string, updates: Partial<RuleCondition>) => {
    setForm({
      ...form,
      conditions: (form.conditions || []).map((c) => (c.id === id ? { ...c, ...updates } : c)),
    });
  };

  const removeCondition = (id: string) => {
    setForm({ ...form, conditions: (form.conditions || []).filter((c) => c.id !== id) });
  };

  const addAction = () => {
    setForm({
      ...form,
      actions: [...(form.actions || []), { id: Date.now().toString(), type: 'assign_to', target: '', value: '' }],
    });
  };

  const updateAction = (id: string, updates: Partial<RuleAction>) => {
    setForm({
      ...form,
      actions: (form.actions || []).map((a) => (a.id === id ? { ...a, ...updates } : a)),
    });
  };

  const removeAction = (id: string) => {
    setForm({ ...form, actions: (form.actions || []).filter((a) => a.id !== id) });
  };

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <Workflow className="w-6 h-6" style={{ color: '#c9a87c' }} />
            Automation Rules
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Build workflows to automate ticket handling
          </p>
        </div>
        <Button onClick={openCreate} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
          <Plus className="w-4 h-4 mr-1" /> New Rule
        </Button>
      </div>

      {/* Rules List */}
      <div className="space-y-3">
        <AnimatePresence>
          {rules.map((rule, idx) => (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card
                className="hover:shadow-md transition-shadow"
                style={{
                  background: '#ffffff',
                  borderRadius: 12,
                  border: rule.active ? '1px solid #e5e0d5' : '1px solid #f0f0f0',
                  opacity: rule.active ? 1 : 0.7,
                }}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Left: Icon + Name */}
                    <div className="flex items-center gap-3 flex-1">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: rule.active ? '#c9a87c15' : '#f5f5f5' }}
                      >
                        <Zap className="w-5 h-5" style={{ color: rule.active ? '#c9a87c' : '#bfbfbf' }} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className={`font-semibold text-sm ${rule.active ? 'text-[#1f1f1f]' : 'text-[#8c8c8c]'}`}>
                            {rule.name}
                          </h3>
                          <Badge
                            className="text-[10px] gap-1"
                            style={{
                              background: rule.active ? '#52c41a20' : '#f5f5f5',
                              color: rule.active ? '#52c41a' : '#8c8c8c',
                              border: 'none',
                            }}
                          >
                            {rule.active ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                            {rule.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <p className="text-xs mt-0.5 truncate" style={{ color: '#595959' }}>
                          {rule.description}
                        </p>
                      </div>
                    </div>

                    {/* Center: Trigger + Stats */}
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <Badge variant="outline" className="text-[10px] gap-1 rounded-md" style={{ borderColor: '#e5e0d5', color: '#595959' }}>
                        {TRIGGER_ICONS[rule.trigger]}
                        {TRIGGER_LABELS[rule.trigger]}
                      </Badge>
                      <div className="text-center">
                        <div className="text-sm font-bold text-[#1f1f1f]">{rule.runCount}</div>
                        <div className="text-[10px]" style={{ color: '#8c8c8c' }}>runs</div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => testRule(rule)}>
                        <Play className="w-4 h-4" style={{ color: '#1890ff' }} />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => openEdit(rule)}>
                        <Pencil className="w-4 h-4" style={{ color: '#595959' }} />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setDeleteConfirm(rule)}>
                        <Trash2 className="w-4 h-4" style={{ color: '#f5222d' }} />
                      </Button>
                      <Switch checked={rule.active} onCheckedChange={() => toggleActive(rule.id)} className="ml-2" />
                    </div>
                  </div>

                  {/* Conditions & Actions preview */}
                  <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #f5f0e8' }}>
                    <span className="text-[10px] font-medium uppercase tracking-wider mr-1" style={{ color: '#8c8c8c' }}>IF</span>
                    {rule.conditions.map((c, i) => (
                      <Badge key={c.id} variant="outline" className="text-[10px] rounded-md" style={{ borderColor: '#e5e0d5' }}>
                        {c.field} {c.operator} <strong>{c.value || '—'}</strong>
                        {i < rule.conditions.length - 1 && <span className="ml-1" style={{ color: '#8c8c8c' }}>AND</span>}
                      </Badge>
                    ))}
                    <ArrowRight className="w-3 h-3 mx-1" style={{ color: '#8c8c8c' }} />
                    <span className="text-[10px] font-medium uppercase tracking-wider mr-1" style={{ color: '#8c8c8c' }}>THEN</span>
                    {rule.actions.map((a) => (
                      <Badge key={a.id} className="text-[10px] gap-1 rounded-md" style={{ background: '#c9a87c15', color: '#c9a87c', border: 'none' }}>
                        {ACTION_ICONS[a.type]} {a.type.replace('_', ' ')}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Rule Builder Modal */}
      <Dialog open={editorOpen} onOpenChange={(v) => !v && setEditorOpen(false)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
              <Workflow className="w-4 h-4" style={{ color: '#c9a87c' }} />
              {editing ? 'Edit Rule' : 'New Automation Rule'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Rule Name</Label>
              <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Auto-assign Critical Tickets" className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description..." className="rounded-lg border-[#e5e0d5]" />
            </div>
            <div className="space-y-2">
              <Label>Trigger</Label>
              <Select value={form.trigger} onValueChange={(v) => setForm({ ...form, trigger: v as TriggerType })}>
                <SelectTrigger className="rounded-lg border-[#e5e0d5]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ticket_create">On Ticket Create</SelectItem>
                  <SelectItem value="ticket_update">On Ticket Update</SelectItem>
                  <SelectItem value="schedule">On Schedule</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Conditions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Conditions</Label>
                <Button onClick={addCondition} variant="outline" size="sm" className="rounded-lg h-7 text-xs border-[#e5e0d5]">
                  <Plus className="w-3 h-3 mr-1" /> Add Condition
                </Button>
              </div>
              <div className="space-y-2">
                {(form.conditions || []).map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <Select value={c.field} onValueChange={(v) => updateCondition(c.id, { field: v as ConditionField })}>
                      <SelectTrigger className="w-[130px] rounded-lg border-[#e5e0d5] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="priority">Priority</SelectItem>
                        <SelectItem value="status">Status</SelectItem>
                        <SelectItem value="category">Category</SelectItem>
                        <SelectItem value="assignee">Assignee</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={c.operator} onValueChange={(v) => updateCondition(c.id, { operator: v as ConditionOp })}>
                      <SelectTrigger className="w-[130px] rounded-lg border-[#e5e0d5] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">equals</SelectItem>
                        <SelectItem value="not_equals">not equals</SelectItem>
                        <SelectItem value="contains">contains</SelectItem>
                        <SelectItem value="empty">is empty</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={c.value} onChange={(e) => updateCondition(c.id, { value: e.target.value })} placeholder="Value" className="flex-1 rounded-lg border-[#e5e0d5] text-xs" />
                    <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => removeCondition(c.id)}>
                      <X className="w-3.5 h-3.5" style={{ color: '#f5222d' }} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Actions</Label>
                <Button onClick={addAction} variant="outline" size="sm" className="rounded-lg h-7 text-xs border-[#e5e0d5]">
                  <Plus className="w-3 h-3 mr-1" /> Add Action
                </Button>
              </div>
              <div className="space-y-2">
                {(form.actions || []).map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <Select value={a.type} onValueChange={(v) => updateAction(a.id, { type: v as ActionType })}>
                      <SelectTrigger className="w-[160px] rounded-lg border-[#e5e0d5] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="assign_to">Assign To</SelectItem>
                        <SelectItem value="change_status">Change Status</SelectItem>
                        <SelectItem value="add_comment">Add Comment</SelectItem>
                        <SelectItem value="send_notification">Send Notification</SelectItem>
                        <SelectItem value="update_field">Update Field</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={a.target} onChange={(e) => updateAction(a.id, { target: e.target.value })} placeholder="Target field" className="w-[130px] rounded-lg border-[#e5e0d5] text-xs" />
                    <Input value={a.value} onChange={(e) => updateAction(a.id, { value: e.target.value })} placeholder="Value" className="flex-1 rounded-lg border-[#e5e0d5] text-xs" />
                    <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => removeAction(a.id)}>
                      <X className="w-3.5 h-3.5" style={{ color: '#f5222d' }} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Label>Active</Label>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} className="rounded-lg border-[#e5e0d5]">Cancel</Button>
            <Button onClick={handleSave} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
              <Save className="w-4 h-4 mr-1" /> Save Rule
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
              Delete Rule
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm" style={{ color: '#595959' }}>
            Delete <strong className="text-[#1f1f1f]">{deleteConfirm?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="rounded-lg border-[#e5e0d5]">Cancel</Button>
            <Button onClick={handleDelete} className="rounded-lg" style={{ background: '#f5222d', color: '#fff' }}>
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Result Toast */}
      <AnimatePresence>
        {testResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 p-4 rounded-xl shadow-lg max-w-sm"
            style={{
              background: testResult.passed ? '#f6ffed' : '#fff1f0',
              border: `1px solid ${testResult.passed ? '#b7eb8f' : '#ffccc7'}`,
            }}
          >
            <div className="flex items-start gap-3">
              {testResult.passed ? (
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#52c41a' }} />
              ) : (
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#f5222d' }} />
              )}
              <div>
                <p className="text-sm font-medium" style={{ color: '#1f1f1f' }}>
                  {testResult.passed ? 'Rule Test Passed' : 'Rule Test Failed'}
                </p>
                <p className="text-xs mt-1" style={{ color: '#595959' }}>{testResult.message}</p>
              </div>
              <button onClick={() => setTestResult(null)} className="ml-2">
                <X className="w-4 h-4" style={{ color: '#8c8c8c' }} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
