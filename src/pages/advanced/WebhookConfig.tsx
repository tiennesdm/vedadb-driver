/**
 * WebhookConfig - Webhook endpoint management
 * Route: /webhooks
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Webhook,
  Plus,
  Trash2,
  Send,
  Eye,
  EyeOff,
  Copy,
  Check,
  Globe,
  Clock,
  Play,
  Lock,
} from 'lucide-react';
import WebhookDeliveryLog from '@/components/advanced/WebhookDeliveryLog';
import type { DeliveryEntry } from '@/components/advanced/WebhookDeliveryLog';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: 'active' | 'disabled';
  secret: string;
  lastTriggered: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  All available events                                               */
/* ------------------------------------------------------------------ */

const ALL_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.assigned',
  'ticket.resolved',
  'ticket.closed',
  'ticket.reopened',
  'ticket.deleted',
  'ticket.commented',
  'user.created',
  'user.updated',
  'user.deleted',
  'asset.created',
  'asset.updated',
  'asset.deleted',
  'change.created',
  'change.updated',
  'change.approved',
  'problem.created',
  'problem.updated',
  'problem.resolved',
];

const SAMPLE_PAYLOAD = {
  event: 'ticket.created',
  timestamp: '2024-01-15T10:30:00Z',
  data: {
    id: 123,
    title: 'Server not responding',
    description: 'The main application server is not responding to ping requests.',
    status: 'open',
    priority: 'high',
    category: 'Infrastructure',
    ticket_type: 'incident',
    created_by: 42,
    assigned_to: null,
    department_id: 3,
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
  },
};

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const INITIAL_ENDPOINTS: WebhookEndpoint[] = [
  {
    id: 'wh_1',
    name: 'Slack Notifications',
    url: 'https://hooks.slack.com/services/T000/B000/XXXX',
    events: ['ticket.created', 'ticket.assigned', 'ticket.resolved'],
    status: 'active',
    secret: 'whsec_slack_12345',
    lastTriggered: '2024-01-15 14:30:22',
    createdAt: '2024-01-01',
  },
  {
    id: 'wh_2',
    name: 'Analytics Pipeline',
    url: 'https://analytics.company.com/webhook',
    events: ['ticket.created', 'ticket.updated', 'ticket.closed'],
    status: 'active',
    secret: 'whsec_analytics_67890',
    lastTriggered: '2024-01-15 12:15:00',
    createdAt: '2024-01-05',
  },
];

const INITIAL_LOGS: DeliveryEntry[] = [
  {
    id: 'dl_1',
    timestamp: '2024-01-15 14:30:22',
    event: 'ticket.created',
    status: 'success',
    responseCode: 200,
    retryCount: 0,
    duration: 245,
    payload: JSON.stringify(SAMPLE_PAYLOAD),
  },
  {
    id: 'dl_2',
    timestamp: '2024-01-15 13:45:10',
    event: 'ticket.assigned',
    status: 'success',
    responseCode: 200,
    retryCount: 0,
    duration: 189,
    payload: '',
  },
  {
    id: 'dl_3',
    timestamp: '2024-01-15 11:20:00',
    event: 'ticket.updated',
    status: 'failed',
    responseCode: 500,
    retryCount: 3,
    duration: 5432,
    payload: '',
  },
  {
    id: 'dl_4',
    timestamp: '2024-01-15 10:05:33',
    event: 'ticket.resolved',
    status: 'success',
    responseCode: 200,
    retryCount: 1,
    duration: 1203,
    payload: '',
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WebhookConfig() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>(INITIAL_ENDPOINTS);
  const [deliveryLogs, setDeliveryLogs] = useState<DeliveryEntry[]>(INITIAL_LOGS);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<WebhookEndpoint | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const createEndpoint = () => {
    if (!newName.trim() || !newUrl.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    if (selectedEvents.length === 0) {
      toast.error('Select at least one event');
      return;
    }
    const endpoint: WebhookEndpoint = {
      id: `wh_${Date.now()}`,
      name: newName,
      url: newUrl,
      events: [...selectedEvents],
      status: 'active',
      secret: newSecret || `whsec_${Math.random().toString(36).slice(2)}`,
      lastTriggered: 'Never',
      createdAt: new Date().toISOString().split('T')[0],
    };
    setEndpoints([...endpoints, endpoint]);
    setNewName('');
    setNewUrl('');
    setNewSecret('');
    setSelectedEvents([]);
    setShowCreateDialog(false);
    toast.success('Webhook endpoint created');
  };

  const deleteEndpoint = (id: string) => {
    setEndpoints(endpoints.filter((e) => e.id !== id));
    toast.success('Endpoint deleted');
  };

  const toggleEndpoint = (id: string) => {
    setEndpoints(
      endpoints.map((e) =>
        e.id === id ? { ...e, status: e.status === 'active' ? 'disabled' : 'active' as const } : e
      )
    );
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const testWebhook = (endpoint: WebhookEndpoint) => {
    setSelectedEndpoint(endpoint);
    setShowTestDialog(true);
  };

  const sendTestPayload = () => {
    if (!selectedEndpoint) return;
    const newLog: DeliveryEntry = {
      id: `dl_${Date.now()}`,
      timestamp: new Date().toLocaleString(),
      event: 'ticket.created',
      status: 'success',
      responseCode: 200,
      retryCount: 0,
      duration: Math.floor(Math.random() * 500) + 100,
      payload: JSON.stringify(SAMPLE_PAYLOAD),
    };
    setDeliveryLogs([newLog, ...deliveryLogs]);
    setEndpoints(
      endpoints.map((e) =>
        e.id === selectedEndpoint.id
          ? { ...e, lastTriggered: newLog.timestamp }
          : e
      )
    );
    setShowTestDialog(false);
    toast.success('Test payload sent successfully');
  };

  const copySecret = (id: string, secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleSecret = (id: string) => {
    setShowSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f5f2eb] flex items-center justify-center">
            <Webhook className="w-5 h-5 text-[#c9a87c]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#262626]">Webhook Configuration</h1>
            <p className="text-xs text-[#8a8a8a]">Manage webhook endpoints and event subscriptions</p>
          </div>
        </div>
        <Button
          size="sm"
          className="h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
          onClick={() => setShowCreateDialog(true)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          New Webhook
        </Button>
      </div>

      <Tabs defaultValue="endpoints">
        <TabsList className="bg-[#f5f2eb]">
          <TabsTrigger value="endpoints" className="text-xs">
            <Globe className="w-3.5 h-3.5 mr-1" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">
            <Clock className="w-3.5 h-3.5 mr-1" />
            Delivery Logs
          </TabsTrigger>
        </TabsList>

        {/* Endpoints Tab */}
        <TabsContent value="endpoints" className="mt-4">
          <div className="space-y-3">
            {endpoints.map((endpoint) => (
              <Card key={endpoint.id} className="border border-[#e5e0d5] bg-white">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#262626]">
                          {endpoint.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-4 ${
                            endpoint.status === 'active'
                              ? 'border-emerald-200 text-emerald-600'
                              : 'border-gray-200 text-gray-500'
                          }`}
                        >
                          {endpoint.status === 'active' ? 'Active' : 'Disabled'}
                        </Badge>
                      </div>
                      <code className="text-xs text-[#595959] font-mono block mt-1">
                        {endpoint.url}
                      </code>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {endpoint.events.map((ev) => (
                          <Badge
                            key={ev}
                            variant="outline"
                            className="text-[10px] h-4 border-[#e5e0d5] text-[#8a8a8a]"
                          >
                            {ev}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-[10px] text-[#8a8a8a]">
                        <Clock className="w-3 h-3" />
                        Last triggered: {endpoint.lastTriggered}
                      </div>
                      {/* Secret display */}
                      <div className="flex items-center gap-2 mt-2">
                        <Lock className="w-3 h-3 text-[#8a8a8a]" />
                        <code className="text-[10px] font-mono text-[#595959] bg-[#f5f2eb] px-1.5 py-0.5 rounded">
                          {showSecrets[endpoint.id] ? endpoint.secret : '\u2022'.repeat(20)}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => toggleSecret(endpoint.id)}
                        >
                          {showSecrets[endpoint.id] ? (
                            <EyeOff className="w-3 h-3 text-[#8a8a8a]" />
                          ) : (
                            <Eye className="w-3 h-3 text-[#8a8a8a]" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => copySecret(endpoint.id, endpoint.secret)}
                        >
                          {copiedId === endpoint.id ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3 text-[#8a8a8a]" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      <Switch
                        checked={endpoint.status === 'active'}
                        onCheckedChange={() => toggleEndpoint(endpoint.id)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => testWebhook(endpoint)}
                      >
                        <Play className="w-3.5 h-3.5 text-[#c9a87c]" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => deleteEndpoint(endpoint.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="mt-4">
          <Card className="border border-[#e5e0d5] bg-white">
            <CardHeader className="p-4 pb-2">
              <h3 className="text-sm font-semibold text-[#262626]">Delivery Log</h3>
            </CardHeader>
            <CardContent className="p-0">
              <WebhookDeliveryLog entries={deliveryLogs} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              New Webhook Endpoint
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Slack Notifications"
                className="h-8 text-xs border-[#e5e0d5] mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">URL</Label>
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://hooks.example.com/webhook"
                className="h-8 text-xs border-[#e5e0d5] mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Secret (optional)</Label>
              <Input
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder="whsec_..."
                className="h-8 text-xs border-[#e5e0d5] mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] text-[#8a8a8a] uppercase">Events</Label>
              <div className="mt-1 border border-[#e5e0d5] rounded-md p-3 max-h-[200px] overflow-auto">
                <div className="grid grid-cols-2 gap-2">
                  {ALL_EVENTS.map((ev) => (
                    <label
                      key={ev}
                      className="flex items-center gap-2 cursor-pointer text-xs text-[#595959] hover:text-[#262626]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(ev)}
                        onChange={() => toggleEvent(ev)}
                        className="rounded border-[#e5e0d5] accent-[#c9a87c]"
                      />
                      {ev}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              className="w-full h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
              onClick={createEndpoint}
            >
              <Webhook className="w-3.5 h-3.5 mr-1" />
              Create Webhook
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent className="max-w-md bg-white border-[#e5e0d5]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#262626]">
              Test Webhook
            </DialogTitle>
          </DialogHeader>
          {selectedEndpoint && (
            <div className="space-y-3 mt-2">
              <div className="text-xs text-[#595959]">
                Sending test payload to <strong>{selectedEndpoint.name}</strong>
              </div>
              <pre className="bg-[#f8f8f8] p-3 rounded-md text-[11px] font-mono text-[#595959] overflow-auto max-h-[200px]">
                {JSON.stringify(SAMPLE_PAYLOAD, null, 2)}
              </pre>
              <Button
                size="sm"
                className="w-full h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
                onClick={sendTestPayload}
              >
                <Send className="w-3.5 h-3.5 mr-1" />
                Send Test Payload
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
