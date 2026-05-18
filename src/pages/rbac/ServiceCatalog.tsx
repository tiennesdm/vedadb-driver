/**
 * Service Catalog — Browse and request IT/HR/Facilities/Finance services
 * with category tabs, service cards, and request forms.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Briefcase,
  Monitor,
  Users,
  Wrench,
  DollarSign,
  HelpCircle,
  Clock,
  ShieldCheck,
  Send,
  CheckCircle,
  Loader2,
  XCircle,
  ChevronRight,
  ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ServiceItem {
  id: number;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  estimatedDays: number;
  approvalRequired: boolean;
  fields: FormField[];
}

interface FormField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number';
  options?: string[];
  required: boolean;
}

interface ServiceRequest {
  id: number;
  serviceName: string;
  category: string;
  status: 'pending' | 'approved' | 'in_progress' | 'completed' | 'rejected';
  submittedAt: string;
  notes: string;
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  { id: 'it', label: 'IT Support', icon: <Monitor className="w-4 h-4" /> },
  { id: 'hr', label: 'HR', icon: <Users className="w-4 h-4" /> },
  { id: 'facilities', label: 'Facilities', icon: <Wrench className="w-4 h-4" /> },
  { id: 'finance', label: 'Finance', icon: <DollarSign className="w-4 h-4" /> },
  { id: 'general', label: 'General', icon: <HelpCircle className="w-4 h-4" /> },
];

const SERVICES: ServiceItem[] = [
  {
    id: 1,
    name: 'New Laptop',
    description: 'Request a new laptop for work purposes. Includes standard business configuration.',
    category: 'it',
    icon: <Monitor className="w-5 h-5" />,
    estimatedDays: 3,
    approvalRequired: true,
    fields: [
      { id: 'justification', label: 'Business Justification', type: 'textarea', required: true },
      { id: 'laptop_type', label: 'Preferred Type', type: 'select', options: ['Windows', 'MacBook', 'Linux'], required: true },
      { id: 'urgency', label: 'Urgency', type: 'select', options: ['Standard', 'Urgent'], required: true },
    ],
  },
  {
    id: 2,
    name: 'VPN Access',
    description: 'Request VPN access for remote work. Subject to security clearance.',
    category: 'it',
    icon: <ShieldCheck className="w-5 h-5" />,
    estimatedDays: 1,
    approvalRequired: false,
    fields: [
      { id: 'reason', label: 'Reason for VPN', type: 'textarea', required: true },
      { id: 'duration', label: 'Duration (months)', type: 'number', required: true },
    ],
  },
  {
    id: 3,
    name: 'Software License',
    description: 'Request a new software license or renewal of an existing license.',
    category: 'it',
    icon: <Briefcase className="w-5 h-5" />,
    estimatedDays: 2,
    approvalRequired: true,
    fields: [
      { id: 'software_name', label: 'Software Name', type: 'text', required: true },
      { id: 'license_type', label: 'License Type', type: 'select', options: ['Individual', 'Team', 'Enterprise'], required: true },
      { id: 'cost_estimate', label: 'Estimated Cost', type: 'number', required: false },
    ],
  },
  {
    id: 4,
    name: 'Onboarding',
    description: 'New employee onboarding request including accounts, equipment, and access.',
    category: 'hr',
    icon: <Users className="w-5 h-5" />,
    estimatedDays: 5,
    approvalRequired: true,
    fields: [
      { id: 'employee_name', label: 'Employee Name', type: 'text', required: true },
      { id: 'role', label: 'Role / Title', type: 'text', required: true },
      { id: 'department', label: 'Department', type: 'select', options: ['IT Support', 'Engineering', 'HR', 'Sales', 'Finance'], required: true },
      { id: 'start_date', label: 'Start Date', type: 'text', required: true },
    ],
  },
  {
    id: 5,
    name: 'Leave Request',
    description: 'Submit a leave or time-off request for manager approval.',
    category: 'hr',
    icon: <Clock className="w-5 h-5" />,
    estimatedDays: 1,
    approvalRequired: true,
    fields: [
      { id: 'leave_type', label: 'Leave Type', type: 'select', options: ['Vacation', 'Sick', 'Personal', 'Parental'], required: true },
      { id: 'from_date', label: 'From', type: 'text', required: true },
      { id: 'to_date', label: 'To', type: 'text', required: true },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false },
    ],
  },
  {
    id: 6,
    name: 'Office Move',
    description: 'Request to move to a different desk, floor, or office location.',
    category: 'facilities',
    icon: <Wrench className="w-5 h-5" />,
    estimatedDays: 4,
    approvalRequired: false,
    fields: [
      { id: 'current_location', label: 'Current Location', type: 'text', required: true },
      { id: 'requested_location', label: 'Requested Location', type: 'text', required: true },
      { id: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  {
    id: 7,
    name: 'Equipment Repair',
    description: 'Report broken or malfunctioning equipment for repair or replacement.',
    category: 'facilities',
    icon: <Wrench className="w-5 h-5" />,
    estimatedDays: 2,
    approvalRequired: false,
    fields: [
      { id: 'equipment_type', label: 'Equipment Type', type: 'select', options: ['Chair', 'Desk', 'Monitor', 'Printer', 'Other'], required: true },
      { id: 'issue', label: 'Issue Description', type: 'textarea', required: true },
    ],
  },
  {
    id: 8,
    name: 'Expense Reimbursement',
    description: 'Submit business expenses for reimbursement with receipt attachment.',
    category: 'finance',
    icon: <DollarSign className="w-5 h-5" />,
    estimatedDays: 5,
    approvalRequired: true,
    fields: [
      { id: 'amount', label: 'Amount', type: 'number', required: true },
      { id: 'category', label: 'Expense Category', type: 'select', options: ['Travel', 'Meals', 'Supplies', 'Training', 'Other'], required: true },
      { id: 'description', label: 'Description', type: 'textarea', required: true },
    ],
  },
  {
    id: 9,
    name: 'General Inquiry',
    description: 'Submit a general question or request not covered by other categories.',
    category: 'general',
    icon: <HelpCircle className="w-5 h-5" />,
    estimatedDays: 2,
    approvalRequired: false,
    fields: [
      { id: 'subject', label: 'Subject', type: 'text', required: true },
      { id: 'details', label: 'Details', type: 'textarea', required: true },
    ],
  },
];

const INITIAL_REQUESTS: ServiceRequest[] = [
  { id: 1, serviceName: 'New Laptop', category: 'it', status: 'in_progress', submittedAt: '2024-12-02T08:00:00Z', notes: 'MacBook Pro requested' },
  { id: 2, serviceName: 'VPN Access', category: 'it', status: 'completed', submittedAt: '2024-11-28T10:00:00Z', notes: 'Remote work setup' },
  { id: 3, serviceName: 'Leave Request', category: 'hr', status: 'approved', submittedAt: '2024-12-01T09:00:00Z', notes: 'Vacation Dec 20-27' },
  { id: 4, serviceName: 'Equipment Repair', category: 'facilities', status: 'pending', submittedAt: '2024-12-03T14:00:00Z', notes: 'Monitor flickering' },
];

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: '#faad14', icon: <Loader2 className="w-3.5 h-3.5" />, label: 'Pending' },
  approved: { color: '#1890ff', icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Approved' },
  in_progress: { color: '#722ed1', icon: <Loader2 className="w-3.5 h-3.5" />, label: 'In Progress' },
  completed: { color: '#52c41a', icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Completed' },
  rejected: { color: '#f5222d', icon: <XCircle className="w-3.5 h-3.5" />, label: 'Rejected' },
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function ServiceCatalog() {
  const [activeCategory, setActiveCategory] = useState('it');
  const [view, setView] = useState<'catalog' | 'requests'>('catalog');
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);
  const [requests, setRequests] = useState<ServiceRequest[]>(INITIAL_REQUESTS);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const filteredServices = SERVICES.filter((s) => s.category === activeCategory);

  const openRequestForm = (service: ServiceItem) => {
    setSelectedService(service);
    setFormValues({});
  };

  const submitRequest = () => {
    if (!selectedService) return;
    const newReq: ServiceRequest = {
      id: Date.now(),
      serviceName: selectedService.name,
      category: selectedService.category,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      notes: formValues.notes || formValues.justification || formValues.reason || '',
    };
    setRequests((prev) => [newReq, ...prev]);
    setSelectedService(null);
    setView('requests');
  };

  return (
    <div className="min-h-screen p-6" style={{ background: '#fbf9f4' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-[#1f1f1f]">
            <Briefcase className="w-6 h-6" style={{ color: '#c9a87c' }} />
            Service Catalog
          </h1>
          <p className="text-sm mt-1" style={{ color: '#595959' }}>
            Browse and request services across departments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={view === 'catalog' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('catalog')}
            className="rounded-lg"
            style={view === 'catalog' ? { background: '#c9a87c', color: '#fff', borderColor: '#c9a87c' } : { borderColor: '#e5e0d5' }}
          >
            <Briefcase className="w-4 h-4 mr-1" /> Catalog
          </Button>
          <Button
            variant={view === 'requests' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('requests')}
            className="rounded-lg"
            style={view === 'requests' ? { background: '#c9a87c', color: '#fff', borderColor: '#c9a87c' } : { borderColor: '#e5e0d5' }}
          >
            <ClipboardList className="w-4 h-4 mr-1" /> My Requests ({requests.length})
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'catalog' ? (
          <motion.div key="catalog" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Category Tabs */}
            <Tabs value={activeCategory} onValueChange={setActiveCategory} className="mb-6">
              <TabsList className="rounded-lg flex-wrap h-auto gap-1 p-1" style={{ background: '#ffffff', border: '1px solid #e5e0d5' }}>
                {CATEGORIES.map((cat) => (
                  <TabsTrigger
                    key={cat.id}
                    value={cat.id}
                    className="rounded-md data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white gap-1"
                  >
                    {cat.icon} {cat.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {/* Service Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <AnimatePresence mode="popLayout">
                {filteredServices.map((service, idx) => (
                  <motion.div
                    key={service.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: idx * 0.06 }}
                  >
                    <Card
                      className="h-full hover:shadow-lg transition-all cursor-pointer group"
                      style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}
                      onClick={() => openRequestForm(service)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center"
                            style={{ background: '#c9a87c15' }}
                          >
                            <span style={{ color: '#c9a87c' }}>{service.icon}</span>
                          </div>
                          {service.approvalRequired && (
                            <Badge style={{ background: '#faad1420', color: '#faad14', border: 'none' }} className="text-[10px]">
                              <ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> Approval
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-semibold text-sm mt-3 text-[#1f1f1f] group-hover:text-[#c9a87c] transition-colors">
                          {service.name}
                        </h3>
                        <p className="text-xs mt-1 leading-relaxed" style={{ color: '#595959' }}>
                          {service.description}
                        </p>
                        <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid #f5f0e8' }}>
                          <span className="flex items-center gap-1 text-[10px]" style={{ color: '#8c8c8c' }}>
                            <Clock className="w-3 h-3" /> ~{service.estimatedDays} day{service.estimatedDays !== 1 ? 's' : ''}
                          </span>
                          <ChevronRight className="w-4 h-4" style={{ color: '#c9a87c' }} />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : (
          <motion.div key="requests" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* My Requests */}
            <Card style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-[#1f1f1f]">
                  <ClipboardList className="w-4 h-4" style={{ color: '#c9a87c' }} />
                  My Service Requests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {requests.map((req) => {
                    const cfg = STATUS_CONFIG[req.status];
                    return (
                      <motion.div
                        key={req.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-4 p-4 rounded-lg"
                        style={{ background: '#fbf9f4', border: '1px solid #e5e0d5' }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-[#1f1f1f]">{req.serviceName}</span>
                            <Badge style={{ background: cfg.color + '20', color: cfg.color, border: 'none' }} className="text-[10px] gap-1">
                              {cfg.icon} {cfg.label}
                            </Badge>
                          </div>
                          <p className="text-xs mt-0.5 truncate" style={{ color: '#595959' }}>{req.notes}</p>
                        </div>
                        <span className="text-[10px] whitespace-nowrap" style={{ color: '#8c8c8c' }}>
                          {new Date(req.submittedAt).toLocaleDateString()}
                        </span>
                      </motion.div>
                    );
                  })}
                  {requests.length === 0 && (
                    <div className="text-center py-8 text-sm" style={{ color: '#595959' }}>
                      No service requests yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Request Form Dialog */}
      <Dialog open={!!selectedService} onOpenChange={() => setSelectedService(null)}>
        <DialogContent className="sm:max-w-lg" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e0d5' }}>
          {selectedService && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-[#1f1f1f]">
                  <span style={{ color: '#c9a87c' }}>{selectedService.icon}</span>
                  Request: {selectedService.name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {selectedService.approvalRequired && (
                  <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: '#fffbe6', border: '1px solid #ffe58f', color: '#ad6800' }}>
                    <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                    This service requires manager approval. Fulfillment estimate: ~{selectedService.estimatedDays} days.
                  </div>
                )}
                {selectedService.fields.map((field) => (
                  <div key={field.id} className="space-y-2">
                    <Label>
                      {field.label}
                      {field.required && <span className="text-[#f5222d] ml-0.5">*</span>}
                    </Label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        value={formValues[field.id] || ''}
                        onChange={(e) => setFormValues({ ...formValues, [field.id]: e.target.value })}
                        placeholder={field.label}
                        rows={3}
                        className="rounded-lg border-[#e5e0d5]"
                      />
                    ) : field.type === 'select' ? (
                      <Select value={formValues[field.id] || ''} onValueChange={(v) => setFormValues({ ...formValues, [field.id]: v })}>
                        <SelectTrigger className="rounded-lg border-[#e5e0d5]">
                          <SelectValue placeholder={`Select ${field.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options?.map((opt) => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={field.type}
                        value={formValues[field.id] || ''}
                        onChange={(e) => setFormValues({ ...formValues, [field.id]: e.target.value })}
                        placeholder={field.label}
                        className="rounded-lg border-[#e5e0d5]"
                      />
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedService(null)} className="rounded-lg border-[#e5e0d5]">Cancel</Button>
                <Button onClick={submitRequest} className="rounded-lg" style={{ background: '#c9a87c', color: '#fff' }}>
                  <Send className="w-4 h-4 mr-1" /> Submit Request
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
