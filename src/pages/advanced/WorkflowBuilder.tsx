/**
 * WorkflowBuilder - Visual workflow builder page
 * Route: /workflow-builder
 */
import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { toast } from 'sonner';
import {
  Workflow,
  Zap,
  GitFork,
  Pause,
  Mail,
  Pencil,
  UserPlus,
  MessageSquare,
  Webhook,
  ShieldCheck,
  Plus,
  Save,
  ChevronRight,
  Trash2,
  Sparkles,
  Clock,
  RotateCcw,
} from 'lucide-react';
import FlowCanvas, { type CanvasNode, type NodeConnection } from '@/components/advanced/FlowCanvas';

/* ------------------------------------------------------------------ */
/*  Node palette                                                       */
/* ------------------------------------------------------------------ */

const NODE_TEMPLATES = {
  trigger: [
    { label: 'On Create', icon: Zap, description: 'When ticket is created' },
    { label: 'On Update', icon: Pencil, description: 'When ticket is updated' },
    { label: 'On Schedule', icon: Clock, description: 'Run on schedule' },
  ],
  condition: [
    { label: 'IF/ELSE', icon: GitFork, description: 'Branch based on condition' },
  ],
  action: [
    { label: 'Send Email', icon: Mail, description: 'Send notification email' },
    { label: 'Update Field', icon: Pencil, description: 'Update ticket field' },
    { label: 'Assign', icon: UserPlus, description: 'Assign to user/role' },
    { label: 'Add Comment', icon: MessageSquare, description: 'Add a comment' },
    { label: 'Webhook', icon: Webhook, description: 'Call external webhook' },
  ],
  approval: [
    { label: 'Approval', icon: ShieldCheck, description: 'Request approval' },
  ],
  delay: [
    { label: 'Delay', icon: Pause, description: 'Wait for duration' },
  ],
};

/* ------------------------------------------------------------------ */
/*  Pre-built templates                                                */
/* ------------------------------------------------------------------ */

const WORKFLOW_TEMPLATES = [
  {
    name: 'Auto-assign by category',
    description: 'Automatically assign tickets based on their category',
    nodes: [
      { id: 't1', type: 'trigger' as const, subtype: 'On Create', label: 'Ticket Created', x: 50, y: 50, config: {} },
      { id: 'c1', type: 'condition' as const, subtype: 'IF/ELSE', label: 'Category = IT?', x: 300, y: 50, config: { field: 'category', operator: 'eq', value: 'IT' } },
      { id: 'a1', type: 'action' as const, subtype: 'Assign', label: 'Assign to IT Team', x: 550, y: 20, config: { assignee: 'it_team' } },
      { id: 'a2', type: 'action' as const, subtype: 'Assign', label: 'Assign to General', x: 550, y: 80, config: { assignee: 'general' } },
    ],
    connections: [
      { from: 't1', to: 'c1' },
      { from: 'c1', to: 'a1', label: 'Yes' },
      { from: 'c1', to: 'a2', label: 'No' },
    ],
  },
  {
    name: 'Escalate old tickets',
    description: 'Escalate tickets that have been open for too long',
    nodes: [
      { id: 't1', type: 'trigger' as const, subtype: 'On Schedule', label: 'Daily Check', x: 50, y: 50, config: { schedule: '0 9 * * *' } },
      { id: 'c1', type: 'condition' as const, subtype: 'IF/ELSE', label: 'Age > 48h?', x: 300, y: 50, config: { field: 'age_hours', operator: 'gt', value: '48' } },
      { id: 'a1', type: 'action' as const, subtype: 'Update Field', label: 'Set Priority High', x: 550, y: 30, config: { field: 'priority', value: 'high' } },
      { id: 'a2', type: 'action' as const, subtype: 'Send Email', label: 'Notify Manager', x: 550, y: 90, config: { to: 'manager@company.com' } },
    ],
    connections: [
      { from: 't1', to: 'c1' },
      { from: 'c1', to: 'a1', label: 'Yes' },
      { from: 'c1', to: 'a2', label: 'Yes' },
    ],
  },
  {
    name: 'Notify on high priority',
    description: 'Send notifications when high priority tickets are created',
    nodes: [
      { id: 't1', type: 'trigger' as const, subtype: 'On Create', label: 'Ticket Created', x: 50, y: 50, config: {} },
      { id: 'c1', type: 'condition' as const, subtype: 'IF/ELSE', label: 'Priority = High?', x: 300, y: 50, config: { field: 'priority', operator: 'eq', value: 'high' } },
      { id: 'a1', type: 'action' as const, subtype: 'Send Email', label: 'Alert Team', x: 550, y: 30, config: { to: 'team@company.com' } },
      { id: 'a2', type: 'action' as const, subtype: 'Webhook', label: 'Post to Slack', x: 550, y: 90, config: { url: 'https://hooks.slack.com/...' } },
    ],
    connections: [
      { from: 't1', to: 'c1' },
      { from: 'c1', to: 'a1', label: 'Yes' },
      { from: 'c1', to: 'a2', label: 'Yes' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Saved workflows store                                              */
/* ------------------------------------------------------------------ */

interface SavedWorkflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  nodes: CanvasNode[];
  connections: NodeConnection[];
  createdAt: string;
}

function getSavedWorkflows(): SavedWorkflow[] {
  try {
    const raw = localStorage.getItem('veda_workflows');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWorkflows(workflows: SavedWorkflow[]) {
  localStorage.setItem('veda_workflows', JSON.stringify(workflows));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WorkflowBuilder() {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [connections, setConnections] = useState<NodeConnection[]>([]);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>(getSavedWorkflows);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testResult, setTestResult] = useState<string[]>([]);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');

  const addNode = useCallback(
    (type: CanvasNode['type'], subtype: string, label: string) => {
      const newNode: CanvasNode = {
        id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type,
        subtype,
        label,
        x: 50 + Math.random() * 100,
        y: 50 + Math.random() * 100,
        config: {},
      };
      setNodes((prev) => [...prev, newNode]);
      toast.success(`${label} node added`);
    },
    []
  );

  const loadTemplate = (template: typeof WORKFLOW_TEMPLATES[0]) => {
    setNodes(template.nodes.map((n) => ({ ...n })));
    setConnections(template.connections.map((c) => ({ ...c })));
    setWorkflowName(template.name);
    setWorkflowDescription(template.description);
    setShowTemplateDialog(false);
    toast.success(`Template "${template.name}" loaded`);
  };

  const handleSaveWorkflow = () => {
    if (!workflowName.trim()) {
      toast.error('Please enter a workflow name');
      return;
    }
    if (nodes.length === 0) {
      toast.error('Add at least one node');
      return;
    }
    const workflows = getSavedWorkflows();
    const existingIdx = workflows.findIndex((w) => w.name === workflowName);
    const newWorkflow: SavedWorkflow = {
      id: existingIdx >= 0 ? workflows[existingIdx].id : `wf_${Date.now()}`,
      name: workflowName,
      description: workflowDescription,
      enabled: existingIdx >= 0 ? workflows[existingIdx].enabled : true,
      nodes: [...nodes],
      connections: [...connections],
      createdAt: existingIdx >= 0 ? workflows[existingIdx].createdAt : new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      workflows[existingIdx] = newWorkflow;
    } else {
      workflows.push(newWorkflow);
    }
    saveWorkflows(workflows);
    setSavedWorkflows(workflows);
    toast.success('Workflow saved');
  };

  const handleLoadWorkflow = (wf: SavedWorkflow) => {
    setNodes(wf.nodes.map((n) => ({ ...n })));
    setConnections(wf.connections.map((c) => ({ ...c })));
    setWorkflowName(wf.name);
    setWorkflowDescription(wf.description);
    setShowLoadDialog(false);
    toast.success(`Workflow "${wf.name}" loaded`);
  };

  const handleDeleteWorkflow = (id: string) => {
    const workflows = getSavedWorkflows().filter((w) => w.id !== id);
    saveWorkflows(workflows);
    setSavedWorkflows(workflows);
    toast.success('Workflow deleted');
  };

  const toggleWorkflow = (id: string) => {
    const workflows = getSavedWorkflows();
    const wf = workflows.find((w) => w.id === id);
    if (wf) {
      wf.enabled = !wf.enabled;
      saveWorkflows(workflows);
      setSavedWorkflows([...workflows]);
      toast.success(`Workflow ${wf.enabled ? 'enabled' : 'disabled'}`);
    }
  };

  const handleTestRun = () => {
    if (nodes.length === 0) {
      toast.error('No nodes to test');
      return;
    }
    const results: string[] = [];
    results.push('Starting workflow simulation...');
    results.push('');

    const triggerNodes = nodes.filter((n) => n.type === 'trigger');
    if (triggerNodes.length === 0) {
      results.push('No trigger node found. Workflow needs a starting point.');
    } else {
      const visited = new Set<string>();
      const queue = [...triggerNodes];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current.id)) continue;
        visited.add(current.id);

        const nodeLabel = `[${current.type.toUpperCase()}] ${current.label}`;
        const cfg = current.config || {};
        if (current.type === 'trigger') {
          results.push(`${nodeLabel} -> Triggered workflow start`);
        } else if (current.type === 'condition') {
          results.push(`${nodeLabel} -> Evaluating: ${cfg.field || 'field'} ${cfg.operator || '=='} ${cfg.value || '?'}`);
        } else if (current.type === 'action') {
          if (current.subtype === 'Send Email') {
            results.push(`${nodeLabel} -> Email sent to: ${cfg.to || 'default'}`);
          } else if (current.subtype === 'Update Field') {
            results.push(`${nodeLabel} -> Updated ${cfg.field || 'field'} = ${cfg.value || 'value'}`);
          } else if (current.subtype === 'Assign') {
            results.push(`${nodeLabel} -> Assigned to: ${cfg.assignee || 'agent'}`);
          } else if (current.subtype === 'Add Comment') {
            results.push(`${nodeLabel} -> Comment added: "${cfg.comment || 'Automated comment'}"`);
          } else if (current.subtype === 'Webhook') {
            results.push(`${nodeLabel} -> Webhook called: ${cfg.url || 'endpoint'}`);
          } else {
            results.push(`${nodeLabel} -> Action executed`);
          }
        } else if (current.type === 'approval') {
          results.push(`${nodeLabel} -> Approval requested`);
        } else if (current.type === 'delay') {
          results.push(`${nodeLabel} -> Waiting ${cfg.duration || '1h'}`);
        }

        const outgoing = connections
          .filter((c) => c.from === current.id)
          .map((c) => nodes.find((n) => n.id === c.to))
          .filter(Boolean);
        queue.push(...(outgoing as CanvasNode[]));
      }
      results.push('');
      results.push('Workflow simulation completed successfully');
    }
    setTestResult(results);
    setShowTestDialog(true);
  };

  const updateSelectedNode = (updates: Partial<CanvasNode>) => {
    if (!selectedNode) return;
    const updated = { ...selectedNode, ...updates };
    setSelectedNode(updated);
    setNodes(nodes.map((n) => (n.id === updated.id ? updated : n)));
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#e5e0d5]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f5f2eb] flex items-center justify-center">
            <Workflow className="w-5 h-5 text-[#c9a87c]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#262626]">Workflow Builder</h1>
            <p className="text-xs text-[#8a8a8a]">Build and automate ticket workflows</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTemplateDialog(true)}
            className="h-8 text-xs border-[#e5e0d5] text-[#595959] hover:bg-[#f5f2eb]"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1 text-[#c9a87c]" />
            Templates
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLoadDialog(true)}
            className="h-8 text-xs border-[#e5e0d5] text-[#595959] hover:bg-[#f5f2eb]"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Load
          </Button>
          <Button
            size="sm"
            onClick={handleSaveWorkflow}
            className="h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            Save Workflow
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Node palette */}
        <div className="w-60 bg-white border-r border-[#e5e0d5] flex flex-col">
          <div className="p-3 border-b border-[#e5e0d5]">
            <Input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="Workflow name..."
              className="h-8 text-xs border-[#e5e0d5] mb-2"
            />
            <Input
              value={workflowDescription}
              onChange={(e) => setWorkflowDescription(e.target.value)}
              placeholder="Description..."
              className="h-8 text-xs border-[#e5e0d5]"
            />
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-4">
              {(Object.entries(NODE_TEMPLATES) as [string, typeof NODE_TEMPLATES.trigger][]).map(
                ([category, items]) => (
                  <div key={category}>
                    <h3 className="text-[10px] font-semibold text-[#8a8a8a] uppercase tracking-wider mb-2">
                      {category}
                    </h3>
                    <div className="space-y-1">
                      {items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.label}
                            className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-[#f5f2eb] transition-colors text-left"
                            onClick={() =>
                              addNode(category as CanvasNode['type'], item.label, item.label)
                            }
                          >
                            <Icon className="w-3.5 h-3.5 text-[#c9a87c] flex-shrink-0" />
                            <div>
                              <div className="text-xs font-medium text-[#262626]">
                                {item.label}
                              </div>
                              <div className="text-[10px] text-[#8a8a8a]">
                                {item.description}
                              </div>
                            </div>
                            <Plus className="w-3 h-3 text-[#c5c0b5] ml-auto" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Canvas */}
        <div className="flex-1 flex flex-col">
          <FlowCanvas
            nodes={nodes}
            connections={connections}
            onNodesChange={setNodes}
            onConnectionsChange={setConnections}
            onSelectNode={setSelectedNode}
            selectedNodeId={selectedNode?.id || null}
            onTestRun={handleTestRun}
            onSave={handleSaveWorkflow}
          />
        </div>

        {/* Properties panel */}
        {selectedNode && (
          <div className="w-64 bg-white border-l border-[#e5e0d5] p-4 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#262626]">Properties</h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setSelectedNode(null)}
              >
                <Trash2 className="w-3 h-3 text-[#8a8a8a]" />
              </Button>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-[10px] text-[#8a8a8a] uppercase">Label</Label>
                <Input
                  value={selectedNode.label}
                  onChange={(e) => updateSelectedNode({ label: e.target.value })}
                  className="h-8 text-xs border-[#e5e0d5] mt-1"
                />
              </div>

              {selectedNode.type === 'trigger' && selectedNode.subtype === 'On Schedule' && (
                <div>
                  <Label className="text-[10px] text-[#8a8a8a] uppercase">Cron Expression</Label>
                  <Input
                    value={selectedNode.config?.schedule || ''}
                    onChange={(e) =>
                      updateSelectedNode({
                        config: { ...selectedNode.config, schedule: e.target.value },
                      })
                    }
                    placeholder="0 9 * * *"
                    className="h-8 text-xs border-[#e5e0d5] mt-1"
                  />
                </div>
              )}

              {selectedNode.type === 'condition' && (
                <>
                  <div>
                    <Label className="text-[10px] text-[#8a8a8a] uppercase">Field</Label>
                    <Select
                      value={selectedNode.config?.field || 'priority'}
                      onValueChange={(v) =>
                        updateSelectedNode({
                          config: { ...selectedNode.config, field: v },
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="priority">Priority</SelectItem>
                        <SelectItem value="status">Status</SelectItem>
                        <SelectItem value="category">Category</SelectItem>
                        <SelectItem value="assigned_to">Assigned To</SelectItem>
                        <SelectItem value="department_id">Department</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-[#8a8a8a] uppercase">Operator</Label>
                    <Select
                      value={selectedNode.config?.operator || 'eq'}
                      onValueChange={(v) =>
                        updateSelectedNode({
                          config: { ...selectedNode.config, operator: v },
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eq">Equals</SelectItem>
                        <SelectItem value="neq">Not Equals</SelectItem>
                        <SelectItem value="gt">Greater Than</SelectItem>
                        <SelectItem value="lt">Less Than</SelectItem>
                        <SelectItem value="contains">Contains</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-[#8a8a8a] uppercase">Value</Label>
                    <Input
                      value={selectedNode.config?.value || ''}
                      onChange={(e) =>
                        updateSelectedNode({
                          config: { ...selectedNode.config, value: e.target.value },
                        })
                      }
                      className="h-8 text-xs border-[#e5e0d5] mt-1"
                    />
                  </div>
                </>
              )}

              {selectedNode.type === 'action' && selectedNode.subtype === 'Send Email' && (
                <div>
                  <Label className="text-[10px] text-[#8a8a8a] uppercase">To</Label>
                  <Input
                    value={selectedNode.config?.to || ''}
                    onChange={(e) =>
                      updateSelectedNode({
                        config: { ...selectedNode.config, to: e.target.value },
                      })
                    }
                    placeholder="email@company.com"
                    className="h-8 text-xs border-[#e5e0d5] mt-1"
                  />
                </div>
              )}

              {selectedNode.type === 'action' && selectedNode.subtype === 'Update Field' && (
                <>
                  <div>
                    <Label className="text-[10px] text-[#8a8a8a] uppercase">Field</Label>
                    <Select
                      value={selectedNode.config?.field || 'priority'}
                      onValueChange={(v) =>
                        updateSelectedNode({
                          config: { ...selectedNode.config, field: v },
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="priority">Priority</SelectItem>
                        <SelectItem value="status">Status</SelectItem>
                        <SelectItem value="category">Category</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-[#8a8a8a] uppercase">Value</Label>
                    <Input
                      value={selectedNode.config?.value || ''}
                      onChange={(e) =>
                        updateSelectedNode({
                          config: { ...selectedNode.config, value: e.target.value },
                        })
                      }
                      className="h-8 text-xs border-[#e5e0d5] mt-1"
                    />
                  </div>
                </>
              )}

              {selectedNode.type === 'action' && selectedNode.subtype === 'Assign' && (
                <div>
                  <Label className="text-[10px] text-[#8a8a8a] uppercase">Assignee</Label>
                  <Input
                    value={selectedNode.config?.assignee || ''}
                    onChange={(e) =>
                      updateSelectedNode({
                        config: { ...selectedNode.config, assignee: e.target.value },
                      })
                    }
                    placeholder="User or Role"
                    className="h-8 text-xs border-[#e5e0d5] mt-1"
                  />
                </div>
              )}

              {selectedNode.type === 'delay' && (
                <div>
                  <Label className="text-[10px] text-[#8a8a8a] uppercase">Duration</Label>
                  <Select
                    value={selectedNode.config?.duration || '1h'}
                    onValueChange={(v) =>
                      updateSelectedNode({
                        config: { ...selectedNode.config, duration: v },
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs border-[#e5e0d5] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5m">5 minutes</SelectItem>
                      <SelectItem value="15m">15 minutes</SelectItem>
                      <SelectItem value="1h">1 hour</SelectItem>
                      <SelectItem value="4h">4 hours</SelectItem>
                      <SelectItem value="24h">24 hours</SelectItem>
                      <SelectItem value="48h">48 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Template Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="max-w-lg bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              Workflow Templates
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {WORKFLOW_TEMPLATES.map((template) => (
              <Card
                key={template.name}
                className="border border-[#e5e0d5] cursor-pointer hover:border-[#c9a87c] transition-colors"
                onClick={() => loadTemplate(template)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#f5f2eb] flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-[#c9a87c]" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-[#262626]">
                      {template.name}
                    </div>
                    <div className="text-xs text-[#8a8a8a]">{template.description}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#c5c0b5]" />
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Load Dialog */}
      <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
        <DialogContent className="max-w-lg bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              Saved Workflows
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-2 max-h-[400px] overflow-auto">
            {savedWorkflows.length === 0 && (
              <p className="text-sm text-[#8a8a8a] text-center py-8">
                No saved workflows yet
              </p>
            )}
            {savedWorkflows.map((wf) => (
              <Card key={wf.id} className="border border-[#e5e0d5]">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#262626] truncate">
                        {wf.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-4 ${
                          wf.enabled
                            ? 'border-emerald-200 text-emerald-600'
                            : 'border-gray-200 text-gray-500'
                        }`}
                      >
                        {wf.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                    </div>
                    <div className="text-xs text-[#8a8a8a]">
                      {wf.nodes.length} nodes - {wf.connections.length} connections
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => toggleWorkflow(wf.id)}
                    >
                      {wf.enabled ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-emerald-400" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleLoadWorkflow(wf)}
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#8a8a8a]" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleDeleteWorkflow(wf.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent className="max-w-lg bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              Workflow Simulation
            </DialogTitle>
          </DialogHeader>
          <div className="bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-md font-mono text-xs max-h-[400px] overflow-auto mt-2">
            {testResult.map((line, i) => (
              <div key={i} className={line.startsWith('[') ? 'text-[#c9a87c]' : ''}>
                {line || ' '}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
