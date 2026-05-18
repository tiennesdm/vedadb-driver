/**
 * ApprovalChains - Multi-step approval workflow builder
 * Route: /approval-chains
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  ShieldCheck,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Trash2,
  Save,
  UserCheck,
  ListChecks,
} from 'lucide-react';
import ApprovalStepCard, { type ApprovalStepData } from '@/components/advanced/ApprovalStepCard';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ApprovalChain {
  id: string;
  name: string;
  description: string;
  type: 'sequential' | 'parallel' | 'anyone';
  steps: ApprovalStepData[];
  enabled: boolean;
}

interface ApprovalRequest {
  id: string;
  chainName: string;
  requester: string;
  subject: string;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  history: { step: number; action: string; by: string; at: string; note?: string }[];
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_CHAINS: ApprovalChain[] = [
  {
    id: 'chain_1',
    name: 'Budget Approval',
    description: 'Multi-level approval for budget requests',
    type: 'sequential',
    enabled: true,
    steps: [
      { id: 's1', order: 1, approverType: 'role', approverValue: 'manager', approverLabel: 'Department Manager', timeout: 24, escalationUser: 'admin', escalationLabel: 'Admin' },
      { id: 's2', order: 2, approverType: 'role', approverValue: 'finance', approverLabel: 'Finance Head', timeout: 48, escalationUser: '', escalationLabel: '' },
    ],
  },
];

const INITIAL_REQUESTS: ApprovalRequest[] = [
  {
    id: 'req_1',
    chainName: 'Budget Approval',
    requester: 'John Smith',
    subject: 'Q3 Marketing Budget - $50K',
    status: 'pending',
    currentStep: 1,
    totalSteps: 2,
    createdAt: '2024-01-15T09:00:00',
    history: [
      { step: 0, action: 'Submitted', by: 'John Smith', at: '2024-01-15T09:00:00', note: 'Initial request' },
    ],
  },
  {
    id: 'req_2',
    chainName: 'Budget Approval',
    requester: 'Sarah Lee',
    subject: 'IT Infrastructure Upgrade - $120K',
    status: 'approved',
    currentStep: 2,
    totalSteps: 2,
    createdAt: '2024-01-14T10:00:00',
    history: [
      { step: 0, action: 'Submitted', by: 'Sarah Lee', at: '2024-01-14T10:00:00' },
      { step: 1, action: 'Approved', by: 'Manager', at: '2024-01-14T14:00:00', note: 'Within budget' },
      { step: 2, action: 'Approved', by: 'Finance Head', at: '2024-01-15T09:00:00' },
    ],
  },
  {
    id: 'req_3',
    chainName: 'Budget Approval',
    requester: 'Mike Chen',
    subject: 'Training Program - $15K',
    status: 'rejected',
    currentStep: 1,
    totalSteps: 2,
    createdAt: '2024-01-13T11:00:00',
    history: [
      { step: 0, action: 'Submitted', by: 'Mike Chen', at: '2024-01-13T11:00:00' },
      { step: 1, action: 'Rejected', by: 'Manager', at: '2024-01-13T16:00:00', note: 'Exceeded quarterly limit' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ApprovalChains() {
  const [chains, setChains] = useState<ApprovalChain[]>(INITIAL_CHAINS);
  const [requests, setRequests] = useState<ApprovalRequest[]>(INITIAL_REQUESTS);
  const [activeTab, setActiveTab] = useState('chains');
  const [selectedChain, setSelectedChain] = useState<ApprovalChain | null>(null);
  const [editingStep, setEditingStep] = useState<ApprovalStepData | null>(null);
  const [showStepDialog, setShowStepDialog] = useState(false);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [actionNote, setActionNote] = useState('');

  // New chain form
  const [newChainName, setNewChainName] = useState('');
  const [newChainDesc, setNewChainDesc] = useState('');
  const [newChainType, setNewChainType] = useState<'sequential' | 'parallel' | 'anyone'>('sequential');

  const createChain = () => {
    if (!newChainName.trim()) {
      toast.error('Enter chain name');
      return;
    }
    const chain: ApprovalChain = {
      id: `chain_${Date.now()}`,
      name: newChainName,
      description: newChainDesc,
      type: newChainType,
      steps: [],
      enabled: true,
    };
    setChains([...chains, chain]);
    setSelectedChain(chain);
    setNewChainName('');
    setNewChainDesc('');
    toast.success('Approval chain created');
  };

  const addStep = () => {
    if (!selectedChain) return;
    const step: ApprovalStepData = {
      id: `step_${Date.now()}`,
      order: selectedChain.steps.length + 1,
      approverType: 'role',
      approverValue: '',
      approverLabel: '',
      timeout: 24,
      escalationUser: '',
      escalationLabel: '',
    };
    const updated = { ...selectedChain, steps: [...selectedChain.steps, step] };
    setSelectedChain(updated);
    setChains(chains.map((c) => (c.id === updated.id ? updated : c)));
    setEditingStep(step);
    setShowStepDialog(true);
  };

  const saveStep = () => {
    if (!selectedChain || !editingStep) return;
    const updated = {
      ...selectedChain,
      steps: selectedChain.steps.map((s) => (s.id === editingStep.id ? editingStep : s)),
    };
    setSelectedChain(updated);
    setChains(chains.map((c) => (c.id === updated.id ? updated : c)));
    setShowStepDialog(false);
    setEditingStep(null);
    toast.success('Step saved');
  };

  const deleteStep = (stepId: string) => {
    if (!selectedChain) return;
    const updatedSteps = selectedChain.steps
      .filter((s) => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx + 1 }));
    const updated = { ...selectedChain, steps: updatedSteps };
    setSelectedChain(updated);
    setChains(chains.map((c) => (c.id === updated.id ? updated : c)));
  };

  const deleteChain = (id: string) => {
    setChains(chains.filter((c) => c.id !== id));
    if (selectedChain?.id === id) setSelectedChain(null);
    toast.success('Chain deleted');
  };

  const toggleChain = (id: string) => {
    setChains(
      chains.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const handleRequestAction = (reqId: string, action: 'approved' | 'rejected' | 'changes_requested') => {
    setRequests(
      requests.map((r) =>
        r.id === reqId
          ? {
              ...r,
              status: action,
              history: [
                ...r.history,
                {
                  step: r.currentStep,
                  action: action === 'approved' ? 'Approved' : action === 'rejected' ? 'Rejected' : 'Changes Requested',
                  by: 'Current User',
                  at: new Date().toISOString(),
                  note: actionNote,
                },
              ],
            }
          : r
      )
    );
    setActionNote('');
    setShowRequestDialog(false);
    toast.success(`Request ${action.replace('_', ' ')}`);
  };

  const statusConfig: Record<string, { color: string; icon: React.ElementType }> = {
    pending: { color: 'text-amber-600 bg-amber-50 border-amber-200', icon: Clock },
    approved: { color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: CheckCircle },
    rejected: { color: 'text-red-600 bg-red-50 border-red-200', icon: XCircle },
    changes_requested: { color: 'text-blue-600 bg-blue-50 border-blue-200', icon: AlertTriangle },
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f5f2eb] flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-[#c9a87c]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#262626]">Approval Chains</h1>
            <p className="text-xs text-[#8a8a8a]">Multi-step approval workflows</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-[#f5f2eb]">
          <TabsTrigger value="chains" className="text-xs">
            <ListChecks className="w-3.5 h-3.5 mr-1" />
            Chains
          </TabsTrigger>
          <TabsTrigger value="requests" className="text-xs">
            <UserCheck className="w-3.5 h-3.5 mr-1" />
            Requests
          </TabsTrigger>
        </TabsList>

        {/* Chains Tab */}
        <TabsContent value="chains" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Chain list */}
            <div className="lg:col-span-1 space-y-3">
              <Card className="border border-[#e5e0d5] bg-white">
                <CardHeader className="p-3 pb-0">
                  <h3 className="text-sm font-semibold text-[#262626]">Create Chain</h3>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  <Input
                    value={newChainName}
                    onChange={(e) => setNewChainName(e.target.value)}
                    placeholder="Chain name..."
                    className="h-8 text-xs border-[#e5e0d5]"
                  />
                  <Input
                    value={newChainDesc}
                    onChange={(e) => setNewChainDesc(e.target.value)}
                    placeholder="Description..."
                    className="h-8 text-xs border-[#e5e0d5]"
                  />
                  <Select
                    value={newChainType}
                    onValueChange={(v: 'sequential' | 'parallel' | 'anyone') => setNewChainType(v)}
                  >
                    <SelectTrigger className="h-8 text-xs border-[#e5e0d5]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sequential">Sequential</SelectItem>
                      <SelectItem value="parallel">Parallel</SelectItem>
                      <SelectItem value="anyone">Any-one</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8 w-full text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
                    onClick={createChain}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Create Chain
                  </Button>
                </CardContent>
              </Card>

              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {chains.map((chain) => (
                    <Card
                      key={chain.id}
                      className={`border cursor-pointer transition-colors ${
                        selectedChain?.id === chain.id
                          ? 'border-[#c9a87c] bg-[#fbf9f4]'
                          : 'border-[#e5e0d5] bg-white hover:bg-[#fbf9f4]'
                      }`}
                      onClick={() => setSelectedChain(chain)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[#262626] truncate">
                              {chain.name}
                            </div>
                            <div className="text-[10px] text-[#8a8a8a]">
                              {chain.steps.length} steps - {chain.type}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Switch
                              checked={chain.enabled}
                              onCheckedChange={() => toggleChain(chain.id)}
                              className="scale-75"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteChain(chain.id);
                              }}
                            >
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Chain builder */}
            <div className="lg:col-span-2">
              {selectedChain ? (
                <Card className="border border-[#e5e0d5] bg-white">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-bold text-[#262626]">
                          {selectedChain.name}
                        </h3>
                        <Badge
                          variant="outline"
                          className="text-[10px] mt-1 capitalize border-[#c9a87c] text-[#c9a87c]"
                        >
                          {selectedChain.type}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
                        onClick={addStep}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Add Step
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    {selectedChain.steps.length === 0 ? (
                      <div className="text-center py-12 text-sm text-[#8a8a8a]">
                        No steps yet. Click &quot;Add Step&quot; to start building.
                      </div>
                    ) : (
                      <div className="space-y-0 max-w-md">
                        {selectedChain.steps.map((step, idx) => (
                          <ApprovalStepCard
                            key={step.id}
                            step={step}
                            chainType={selectedChain.type}
                            isLast={idx === selectedChain.steps.length - 1}
                            onEdit={(s) => {
                              setEditingStep({ ...s });
                              setShowStepDialog(true);
                            }}
                            onDelete={deleteStep}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-[#8a8a8a]">
                  Select or create an approval chain to start building
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Requests Tab */}
        <TabsContent value="requests" className="mt-4">
          <Card className="border border-[#e5e0d5] bg-white">
            <CardHeader className="p-4 pb-2">
              <h3 className="text-sm font-semibold text-[#262626]">Approval Requests</h3>
            </CardHeader>
            <CardContent className="p-4">
              <div className="space-y-3">
                {requests.map((req) => {
                  const config = statusConfig[req.status];
                  const StatusIcon = config.icon;
                  return (
                    <Card
                      key={req.id}
                      className="border border-[#e5e0d5] hover:border-[#c9a87c] transition-colors cursor-pointer"
                      onClick={() => {
                        setSelectedRequest(req);
                        setShowRequestDialog(true);
                      }}
                    >
                      <CardContent className="p-3 flex items-center gap-4">
                        <div className="w-9 h-9 rounded-full bg-[#f5f2eb] flex items-center justify-center flex-shrink-0">
                          <StatusIcon className="w-4 h-4 text-[#c9a87c]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#262626] truncate">
                            {req.subject}
                          </div>
                          <div className="text-[10px] text-[#8a8a8a]">
                            {req.requester} - {req.chainName} - Step {req.currentStep}/{req.totalSteps}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-5 ${config.color}`}
                        >
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {req.status.replace('_', ' ')}
                        </Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Step Edit Dialog */}
      <Dialog open={showStepDialog} onOpenChange={setShowStepDialog}>
        <DialogContent className="max-w-md bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              Edit Approval Step
            </DialogTitle>
          </DialogHeader>
          {editingStep && (
            <div className="space-y-3 mt-2">
              <div>
                <Label className="text-[10px] text-[#8a8a8a] uppercase">Approver Type</Label>
                <Select
                  value={editingStep.approverType}
                  onValueChange={(v: 'user' | 'role' | 'group') =>
                    setEditingStep({ ...editingStep, approverType: v })
                  }
                >
                  <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="role">Role</SelectItem>
                    <SelectItem value="group">Group</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] text-[#8a8a8a] uppercase">Approver</Label>
                <Input
                  value={editingStep.approverValue}
                  onChange={(e) =>
                    setEditingStep({ ...editingStep, approverValue: e.target.value })
                  }
                  placeholder="e.g. manager, jane@company.com"
                  className="h-8 text-xs border-[#e5e0d5] mt-1"
                />
              </div>
              <div>
                <Label className="text-[10px] text-[#8a8a8a] uppercase">Display Label</Label>
                <Input
                  value={editingStep.approverLabel}
                  onChange={(e) =>
                    setEditingStep({ ...editingStep, approverLabel: e.target.value })
                  }
                  placeholder="Department Manager"
                  className="h-8 text-xs border-[#e5e0d5] mt-1"
                />
              </div>
              <div>
                <Label className="text-[10px] text-[#8a8a8a] uppercase">Timeout (hours)</Label>
                <Input
                  type="number"
                  value={editingStep.timeout}
                  onChange={(e) =>
                    setEditingStep({ ...editingStep, timeout: parseInt(e.target.value) || 24 })
                  }
                  className="h-8 text-xs border-[#e5e0d5] mt-1"
                />
              </div>
              <div>
                <Label className="text-[10px] text-[#8a8a8a] uppercase">Escalation To</Label>
                <Input
                  value={editingStep.escalationUser}
                  onChange={(e) =>
                    setEditingStep({ ...editingStep, escalationUser: e.target.value })
                  }
                  placeholder="User/Role for escalation"
                  className="h-8 text-xs border-[#e5e0d5] mt-1"
                />
              </div>
              <Button
                size="sm"
                className="w-full h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
                onClick={saveStep}
              >
                <Save className="w-3.5 h-3.5 mr-1" />
                Save Step
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Request Action Dialog */}
      <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
        <DialogContent className="max-w-lg bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              Approval Request
            </DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#f5f2eb] flex items-center justify-center">
                  <UserCheck className="w-5 h-5 text-[#c9a87c]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[#262626]">
                    {selectedRequest.subject}
                  </div>
                  <div className="text-xs text-[#8a8a8a]">
                    Requested by {selectedRequest.requester}
                  </div>
                </div>
              </div>

              {/* History */}
              <div>
                <h4 className="text-xs font-semibold text-[#262626] mb-2">Approval History</h4>
                <div className="space-y-2">
                  {selectedRequest.history.map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className="w-5 h-5 rounded-full bg-[#f5f2eb] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[9px] text-[#c9a87c]">{h.step}</span>
                      </div>
                      <div className="flex-1">
                        <div className="text-[#262626]">
                          <span className="font-medium">{h.action}</span> by {h.by}
                        </div>
                        {h.note && <div className="text-[#8a8a8a] mt-0.5">{h.note}</div>}
                        <div className="text-[10px] text-[#c5c0b5]">
                          {new Date(h.at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedRequest.status === 'pending' && (
                <>
                  <div>
                    <Label className="text-[10px] text-[#8a8a8a] uppercase">Note</Label>
                    <Textarea
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                      placeholder="Add a note..."
                      className="text-xs border-[#e5e0d5] mt-1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => handleRequestAction(selectedRequest.id, 'approved')}
                    >
                      <CheckCircle className="w-3.5 h-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={() => handleRequestAction(selectedRequest.id, 'changes_requested')}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                      Request Changes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-8 text-xs border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => handleRequestAction(selectedRequest.id, 'rejected')}
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                      Reject
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
