/**
 * CustomerPortal — Customer-facing self-service portal
 * My Tickets, Submit Request, Track Request, Knowledge Base, Satisfaction Survey, Profile
 * Route: /customer-portal
 */
import { useState } from 'react';
import {
  Ticket, Search, FileText, BookOpen, Star, User, Bell,
  Send, Clock, CheckCircle, AlertCircle, X,
  Lock, Mail, Phone, Megaphone
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useAppStore from '@/lib/vedadb-store';
import type { Ticket as TicketType } from '@/lib/vedadb-store';
import type { KBArticle } from '@/lib/vedadb-store';

/* ------------------------------------------------------------------ */
/*  Mock data helpers                                                  */
/* ------------------------------------------------------------------ */

const SERVICE_CATALOG = [
  { id: 'password', name: 'Password Reset', category: 'Account Access', icon: Lock, description: 'Reset your account password' },
  { id: 'vpn', name: 'VPN Access', category: 'Network', icon: AlertCircle, description: 'Request VPN access or troubleshoot' },
  { id: 'software', name: 'Software Installation', category: 'IT Services', icon: FileText, description: 'Request software installation' },
  { id: 'hardware', name: 'Hardware Issue', category: 'IT Services', icon: AlertCircle, description: 'Report hardware problems' },
  { id: 'email', name: 'Email Setup', category: 'Communication', icon: Mail, description: 'Configure email accounts' },
  { id: 'access', name: 'Access Request', category: 'Security', icon: Lock, description: 'Request system access' },
];

const MOCK_ARTICLES: KBArticle[] = [
  { id: 1, title: 'How to Reset Your Password', content: 'Go to Settings > Security > Change Password...', category: 'Account', tags: 'password,security', views: 342, author_id: 1, author_name: 'IT Support', created_at: '2024-01-15', updated_at: '2024-06-01' },
  { id: 2, title: 'VPN Connection Troubleshooting', content: 'If you cannot connect to VPN, try these steps...', category: 'Network', tags: 'vpn,network', views: 218, author_id: 1, author_name: 'Network Team', created_at: '2024-02-10', updated_at: '2024-05-20' },
  { id: 3, title: 'Setting Up Email on Mobile', content: 'To configure email on your mobile device...', category: 'Email', tags: 'email,mobile', views: 156, author_id: 2, author_name: 'Help Desk', created_at: '2024-03-05', updated_at: '2024-04-15' },
  { id: 4, title: 'Printer Not Responding', content: 'Check the following if your printer is not responding...', category: 'Hardware', tags: 'printer,hardware', views: 89, author_id: 1, author_name: 'IT Support', created_at: '2024-01-20', updated_at: '2024-06-10' },
  { id: 5, title: 'Two-Factor Authentication Guide', content: 'Enable 2FA to secure your account...', category: 'Security', tags: '2fa,security', views: 201, author_id: 3, author_name: 'Security Team', created_at: '2024-04-01', updated_at: '2024-06-05' },
];

const ANNOUNCEMENTS = [
  { id: 1, title: 'Scheduled Maintenance: June 20, 2024', type: 'warning', date: '2024-06-18' },
  { id: 2, title: 'New Self-Service Portal Now Available', type: 'info', date: '2024-06-15' },
  { id: 3, title: 'Password Policy Update Effective July 1', type: 'info', date: '2024-06-10' },
];

/* ------------------------------------------------------------------ */
/*  Satisfaction Survey Component                                      */
/* ------------------------------------------------------------------ */

function SatisfactionSurvey({ ticketId, onSubmit }: { ticketId: number; onSubmit: (rating: number, comment: string) => void }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-[#e5e0d5] bg-white p-5">
      <h4 className="mb-3 text-sm font-medium text-[#1f1f1f]">Rate your experience with Ticket #{ticketId}</h4>
      <div className="mb-3 flex gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(0)}
            onClick={() => setRating(star)}
            className="transition-transform hover:scale-110"
          >
            <Star
              size={28}
              className="transition-colors"
              fill={(hoverRating || rating) >= star ? '#c9a87c' : 'none'}
              stroke={(hoverRating || rating) >= star ? '#c9a87c' : '#e5e0d5'}
            />
          </button>
        ))}
        <span className="ml-2 self-center text-sm text-[#8a8a8a]">
          {rating === 1 && 'Poor'} {rating === 2 && 'Fair'} {rating === 3 && 'Good'} {rating === 4 && 'Very Good'} {rating === 5 && 'Excellent'}
        </span>
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Tell us about your experience (optional)"
        rows={3}
        className="mb-3 w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
      />
      <button
        onClick={() => { if (rating > 0) onSubmit(rating, comment); }}
        disabled={rating === 0}
        className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ backgroundColor: '#c9a87c', color: '#1f1f1f' }}
      >
        Submit Feedback
      </button>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'tickets', label: 'My Tickets', icon: Ticket },
  { id: 'submit', label: 'Submit Request', icon: Send },
  { id: 'kb', label: 'Knowledge Base', icon: BookOpen },
  { id: 'profile', label: 'Profile', icon: User },
];

export default function CustomerPortal() {
  const [activeTab, setActiveTab] = useState('tickets');
  const [surveyTicket, setSurveyTicket] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [kbSearch, setKbSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [submitForm, setSubmitForm] = useState({ title: '', description: '', service: '' });
  const [submitted, setSubmitted] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: 'John Doe', email: 'john.doe@company.com', phone: '+1-555-0123', currentPassword: '', newPassword: '' });
  const [profileSaved, setProfileSaved] = useState(false);

  const currentUser = useAppStore((s) => s.currentUser);
  const tickets = useAppStore((s) => s.tickets);
  const createTicket = useAppStore((s) => s.createTicket);

  const myTickets = tickets.filter((t) => t.created_by === currentUser?.id);
  const filteredKb = MOCK_ARTICLES.filter((a) => {
    const matchSearch = !kbSearch || a.title.toLowerCase().includes(kbSearch.toLowerCase()) || a.content.toLowerCase().includes(kbSearch.toLowerCase());
    const matchCat = selectedCategory === 'all' || a.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const handleSubmitRequest = async () => {
    if (!submitForm.title || !submitForm.description) return;
    await createTicket({
      title: submitForm.title,
      description: submitForm.description,
      category: submitForm.service || 'General',
      priority: 'medium',
      status: 'open',
      ticket_type: 'service_request',
    });
    setSubmitted(true);
    setTimeout(() => { setSubmitted(false); setSubmitForm({ title: '', description: '', service: '' }); }, 3000);
  };

  const handleSurveySubmit = (rating: number, comment: string) => {
    console.log('Survey submitted:', { ticketId: surveyTicket, rating, comment });
    setSurveyTicket(null);
  };

  const handleProfileSave = () => {
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 3000);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Announcements Banner */}
      <div className="space-y-2">
        {ANNOUNCEMENTS.map((ann) => (
          <motion.div
            key={ann.id}
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm ${
              ann.type === 'warning' ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'
            }`}
          >
            <Megaphone size={16} />
            <span className="font-medium">{ann.title}</span>
            <span className="ml-auto text-xs opacity-70">{ann.date}</span>
          </motion.div>
        ))}
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-medium text-[#1f1f1f] md:text-2xl">Customer Portal</h2>
          <p className="mt-0.5 text-sm text-[#595959]">Welcome, {currentUser?.name || 'Customer'}. Manage your requests and find answers.</p>
        </div>
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-[#8a8a8a]" />
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white">2</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-[#e5e0d5] bg-white p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-[#c9a87c]/15 text-[#1f1f1f]' : 'text-[#595959] hover:bg-[#fbf9f4]'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {/* --- My Tickets --- */}
        {activeTab === 'tickets' && (
          <motion.div key="tickets" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search your tickets..."
                  className="w-full rounded-lg border border-[#e5e0d5] bg-white py-2 pl-9 pr-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                />
              </div>
            </div>

            <div className="space-y-3">
              {myTickets.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#e5e0d5] py-12 text-center">
                  <Ticket size={32} className="mx-auto mb-3 text-[#8a8a8a]" />
                  <p className="text-sm text-[#8a8a8a]">No tickets yet. Submit your first request!</p>
                </div>
              )}
              {myTickets.filter((t) => !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase())).map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} onSurvey={() => setSurveyTicket(ticket.id)} />
              ))}
            </div>

            {surveyTicket && (
              <SatisfactionSurvey ticketId={surveyTicket} onSubmit={handleSurveySubmit} />
            )}
          </motion.div>
        )}

        {/* --- Submit Request --- */}
        {activeTab === 'submit' && (
          <motion.div key="submit" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {submitted ? (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-xl border border-green-200 bg-green-50 py-12 text-center">
                <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
                <h3 className="text-lg font-medium text-green-800">Request Submitted!</h3>
                <p className="mt-1 text-sm text-green-600">Your ticket has been created. You will receive updates via email.</p>
              </motion.div>
            ) : (
              <div className="space-y-5">
                {/* Service Catalog */}
                <div>
                  <h3 className="mb-3 text-sm font-medium text-[#1f1f1f]">Select a Service</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {SERVICE_CATALOG.map((svc) => {
                      const Icon = svc.icon;
                      return (
                        <button
                          key={svc.id}
                          onClick={() => setSubmitForm((p) => ({ ...p, service: svc.name }))}
                          className={`rounded-xl border p-4 text-left transition-all ${
                            submitForm.service === svc.name
                              ? 'border-[#c9a87c] bg-[#c9a87c]/10 shadow-sm'
                              : 'border-[#e5e0d5] bg-white hover:bg-[#fbf9f4]'
                          }`}
                        >
                          <Icon size={20} className="mb-2" style={{ color: '#c9a87c' }} />
                          <p className="text-sm font-medium text-[#1f1f1f]">{svc.name}</p>
                          <p className="mt-0.5 text-xs text-[#8a8a8a]">{svc.description}</p>
                          <span className="mt-2 inline-block rounded-full bg-[#fbf9f4] px-2 py-0.5 text-[10px] text-[#595959]">{svc.category}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Form */}
                <div className="rounded-xl border border-[#e5e0d5] bg-white p-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#1f1f1f]">Title</label>
                    <input
                      value={submitForm.title}
                      onChange={(e) => setSubmitForm((p) => ({ ...p, title: e.target.value }))}
                      placeholder="Brief description of your request"
                      className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#1f1f1f]">Description</label>
                    <textarea
                      value={submitForm.description}
                      onChange={(e) => setSubmitForm((p) => ({ ...p, description: e.target.value }))}
                      rows={5}
                      placeholder="Provide as much detail as possible..."
                      className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                    />
                  </div>
                  <button
                    onClick={handleSubmitRequest}
                    disabled={!submitForm.title || !submitForm.description}
                    className="rounded-lg px-6 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{ backgroundColor: '#c9a87c', color: '#1f1f1f' }}
                  >
                    Submit Request
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* --- Knowledge Base --- */}
        {activeTab === 'kb' && (
          <motion.div key="kb" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="mb-4 flex gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                <input
                  value={kbSearch}
                  onChange={(e) => setKbSearch(e.target.value)}
                  placeholder="Search knowledge base articles..."
                  className="w-full rounded-lg border border-[#e5e0d5] bg-white py-2 pl-9 pr-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                />
              </div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
              >
                <option value="all">All Categories</option>
                <option value="Account">Account</option>
                <option value="Network">Network</option>
                <option value="Email">Email</option>
                <option value="Hardware">Hardware</option>
                <option value="Security">Security</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredKb.map((article) => (
                <motion.div
                  key={article.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="group cursor-pointer rounded-xl border border-[#e5e0d5] bg-white p-4 transition-all hover:border-[#c9a87c] hover:shadow-sm"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <BookOpen size={14} style={{ color: '#c9a87c' }} />
                    <span className="text-xs text-[#8a8a8a]">{article.category}</span>
                    <span className="ml-auto text-xs text-[#8a8a8a]">{article.views} views</span>
                  </div>
                  <h4 className="mb-1 text-sm font-medium text-[#1f1f1f] group-hover:text-[#c9a87c] transition-colors">{article.title}</h4>
                  <p className="line-clamp-2 text-xs text-[#595959]">{article.content}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    {article.tags.split(',').map((tag) => (
                      <span key={tag} className="rounded-full bg-[#fbf9f4] px-2 py-0.5 text-[10px] text-[#595959]">{tag.trim()}</span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* --- Profile --- */}
        {activeTab === 'profile' && (
          <motion.div key="profile" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="mx-auto max-w-lg rounded-xl border border-[#e5e0d5] bg-white p-6">
              <div className="mb-6 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white" style={{ backgroundColor: '#c9a87c' }}>
                  {(profileForm.name || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-medium text-[#1f1f1f]">{profileForm.name}</h3>
                  <p className="text-sm text-[#8a8a8a]">{profileForm.email}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[#1f1f1f]"><User size={14} /> Full Name</label>
                  <input value={profileForm.name} onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]" />
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[#1f1f1f]"><Mail size={14} /> Email</label>
                  <input value={profileForm.email} onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))} className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]" />
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[#1f1f1f]"><Phone size={14} /> Phone</label>
                  <input value={profileForm.phone} onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]" />
                </div>
                <div className="border-t border-[#e5e0d5] pt-4">
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[#1f1f1f]"><Lock size={14} /> Current Password</label>
                  <input type="password" value={profileForm.currentPassword} onChange={(e) => setProfileForm((p) => ({ ...p, currentPassword: e.target.value }))} className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]" />
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[#1f1f1f]"><Lock size={14} /> New Password</label>
                  <input type="password" value={profileForm.newPassword} onChange={(e) => setProfileForm((p) => ({ ...p, newPassword: e.target.value }))} className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]" />
                </div>

                <button
                  onClick={handleProfileSave}
                  className="w-full rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#c9a87c', color: '#1f1f1f' }}
                >
                  Save Changes
                </button>

                {profileSaved && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-xs text-green-600">Profile updated successfully!</motion.p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ticket Card                                                        */
/* ------------------------------------------------------------------ */

function TicketCard({ ticket, onSurvey }: { ticket: TicketType; onSurvey: () => void }) {
  const statusColors: Record<string, string> = {
    open: '#faad14',
    in_progress: '#1890ff',
    resolved: '#52c41a',
    closed: '#8a8a8a',
    on_hold: '#722ed1',
    rejected: '#f5222d',
  };

  const statusIcons: Record<string, typeof Clock> = {
    open: AlertCircle,
    in_progress: Clock,
    resolved: CheckCircle,
    closed: CheckCircle,
    on_hold: Clock,
    rejected: X,
  };

  const Icon = statusIcons[ticket.status] || Clock;
  const isResolved = ticket.status === 'resolved' || ticket.status === 'closed';

  return (
    <motion.div
      layout
      className="rounded-xl border border-[#e5e0d5] bg-white p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#8a8a8a]">#{ticket.id}</span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${statusColors[ticket.status]}15`, color: statusColors[ticket.status] }}
            >
              <Icon size={10} />
              {ticket.status.replace('_', ' ')}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: ticket.priority === 'high' ? '#f5222d15' : ticket.priority === 'medium' ? '#faad1415' : '#52c41a15',
                color: ticket.priority === 'high' ? '#f5222d' : ticket.priority === 'medium' ? '#faad14' : '#52c41a',
              }}
            >
              {ticket.priority}
            </span>
          </div>
          <h4 className="mt-1.5 text-sm font-medium text-[#1f1f1f]">{ticket.title}</h4>
          <p className="mt-0.5 line-clamp-1 text-xs text-[#595959]">{ticket.description}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-[#8a8a8a]">
            <span className="flex items-center gap-1"><Clock size={12} /> {ticket.created_at}</span>
            <span>Category: {ticket.category}</span>
            {ticket.assigned_to && <span>Agent: {ticket.assignee_name || 'Assigned'}</span>}
          </div>
        </div>
        {isResolved && (
          <button
            onClick={onSurvey}
            className="shrink-0 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-1.5 text-xs font-medium text-[#1f1f1f] transition-colors hover:bg-[#c9a87c]/10"
          >
            <Star size={12} className="mr-1 inline" style={{ color: '#c9a87c' }} />
            Rate
          </button>
        )}
      </div>
    </motion.div>
  );
}
