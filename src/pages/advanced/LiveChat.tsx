/**
 * LiveChat — Live chat widget admin panel
 * Chat queue management, agent chat interface, canned responses
 * Route: /live-chat
 */
import { useState, useRef, useEffect } from 'react';
import {
  MessageSquare, Search, Send, User, Clock, CheckCircle,
  ArrowRightLeft, ChevronDown, Star,
  Headset, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatConversation {
  id: string;
  customerName: string;
  customerEmail: string;
  status: 'waiting' | 'active' | 'resolved';
  messages: ChatMessage[];
  lastActivity: string;
  assignedAgent?: string;
  waitTime: number; // seconds
  rating?: number;
}

interface ChatMessage {
  id: string;
  sender: 'customer' | 'agent' | 'system';
  text: string;
  timestamp: string;
  agentName?: string;
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const MOCK_CONVERSATIONS: ChatConversation[] = [
  {
    id: 'conv-1',
    customerName: 'Alice Johnson',
    customerEmail: 'alice@company.com',
    status: 'waiting',
    waitTime: 45,
    messages: [
      { id: 'm1', sender: 'customer', text: 'Hi, I need help with my account', timestamp: '2:30 PM' },
      { id: 'm2', sender: 'customer', text: 'I cannot access the VPN', timestamp: '2:31 PM' },
    ],
    lastActivity: '2:31 PM',
  },
  {
    id: 'conv-2',
    customerName: 'Bob Smith',
    customerEmail: 'bob@company.com',
    status: 'active',
    assignedAgent: 'Sarah Agent',
    waitTime: 0,
    messages: [
      { id: 'm1', sender: 'customer', text: 'Hello, I have a printer issue', timestamp: '2:15 PM' },
      { id: 'm2', sender: 'agent', text: 'I can help with that! What seems to be the problem?', timestamp: '2:16 PM', agentName: 'Sarah Agent' },
      { id: 'm3', sender: 'customer', text: 'It keeps showing error code 0x800', timestamp: '2:17 PM' },
    ],
    lastActivity: '2:17 PM',
  },
  {
    id: 'conv-3',
    customerName: 'Carol White',
    customerEmail: 'carol@company.com',
    status: 'active',
    assignedAgent: 'Mike Support',
    waitTime: 0,
    messages: [
      { id: 'm1', sender: 'customer', text: 'Need help resetting password', timestamp: '1:45 PM' },
      { id: 'm2', sender: 'agent', text: 'Sure, I can guide you through the process.', timestamp: '1:46 PM', agentName: 'Mike Support' },
    ],
    lastActivity: '1:50 PM',
  },
  {
    id: 'conv-4',
    customerName: 'David Lee',
    customerEmail: 'david@company.com',
    status: 'resolved',
    assignedAgent: 'Sarah Agent',
    waitTime: 0,
    rating: 5,
    messages: [
      { id: 'm1', sender: 'customer', text: 'Thanks for the help!', timestamp: '11:30 AM' },
      { id: 'm2', sender: 'agent', text: 'You are welcome! Have a great day.', timestamp: '11:31 AM', agentName: 'Sarah Agent' },
    ],
    lastActivity: '11:31 AM',
  },
  {
    id: 'conv-5',
    customerName: 'Emma Brown',
    customerEmail: 'emma@company.com',
    status: 'resolved',
    assignedAgent: 'Mike Support',
    waitTime: 0,
    rating: 4,
    messages: [
      { id: 'm1', sender: 'customer', text: 'Issue resolved, thank you', timestamp: '10:15 AM' },
    ],
    lastActivity: '10:15 AM',
  },
];

const CANNED_RESPONSES = [
  { id: 'c1', label: 'Greeting', text: 'Hello! Thank you for contacting support. How can I help you today?' },
  { id: 'c2', label: 'Hold', text: 'Please hold for a moment while I look into this for you.' },
  { id: 'c3', label: 'Password Reset', text: 'I can help you reset your password. Please visit the password reset page at /reset-password' },
  { id: 'c4', label: 'VPN Help', text: 'For VPN issues, please try: 1) Restart the VPN client 2) Check your internet connection 3) Verify your credentials' },
  { id: 'c5', label: 'Escalate', text: 'I am going to transfer you to a specialist who can better assist with this issue.' },
  { id: 'c6', label: 'Closing', text: 'Is there anything else I can help you with today?' },
  { id: 'c7', label: 'Goodbye', text: 'Thank you for contacting support. Have a great day!' },
];

const AGENTS = ['Sarah Agent', 'Mike Support', 'Lisa Help', 'Tom Desk'];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

type AgentStatus = 'online' | 'away' | 'busy';

const STATUS_CONFIG: Record<AgentStatus, { color: string; label: string }> = {
  online: { color: '#52c41a', label: 'Online' },
  away: { color: '#faad14', label: 'Away' },
  busy: { color: '#f5222d', label: 'Busy' },
};

export default function LiveChat() {
  const [conversations, setConversations] = useState<ChatConversation[]>(MOCK_CONVERSATIONS);
  const [activeConvId, setActiveConvId] = useState<string | null>('conv-2');
  const [input, setInput] = useState('');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('online');
  const [queueFilter, setQueueFilter] = useState<'all' | 'waiting' | 'active' | 'resolved'>('all');
  const [showCanned, setShowCanned] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typingConvs, setTypingConvs] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  const filteredConvs = conversations.filter((c) => {
    const matchFilter = queueFilter === 'all' || c.status === queueFilter;
    const matchSearch = !searchQuery || c.customerName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchFilter && matchSearch;
  });

  const waitingCount = conversations.filter((c) => c.status === 'waiting').length;
  const activeCount = conversations.filter((c) => c.status === 'active').length;
  const resolvedCount = conversations.filter((c) => c.status === 'resolved').length;

  useEffect(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [activeConv?.messages]);

  const sendMessage = (text: string) => {
    if (!text.trim() || !activeConvId) return;
    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'agent',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      agentName: 'You',
    };
    setConversations((prev) => prev.map((c) =>
      c.id === activeConvId ? { ...c, messages: [...c.messages, newMsg], lastActivity: newMsg.timestamp } : c
    ));
    setInput('');

    // Simulate customer typing and response
    setTypingConvs((prev) => new Set(prev).add(activeConvId));
    setTimeout(() => {
      setTypingConvs((prev) => {
        const next = new Set(prev);
        next.delete(activeConvId);
        return next;
      });
      const customerReplies = [
        'Thank you for the information!',
        'That worked, appreciate it.',
        'I see, let me try that.',
        'Could you explain that a bit more?',
        'Okay, I will check and get back to you.',
      ];
      const reply: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'customer',
        text: customerReplies[Math.floor(Math.random() * customerReplies.length)],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setConversations((prev) => prev.map((c) =>
        c.id === activeConvId ? { ...c, messages: [...c.messages, reply], lastActivity: reply.timestamp } : c
      ));
    }, 2000);
  };

  const transferConversation = (convId: string, newAgent: string) => {
    setConversations((prev) => prev.map((c) =>
      c.id === convId ? { ...c, assignedAgent: newAgent, messages: [...c.messages, { id: Date.now().toString(), sender: 'system', text: `Chat transferred to ${newAgent}`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }] } : c
    ));
  };

  const resolveConversation = (convId: string) => {
    setConversations((prev) => prev.map((c) =>
      c.id === convId ? { ...c, status: 'resolved', messages: [...c.messages, { id: Date.now().toString(), sender: 'system', text: 'Conversation resolved', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }] } : c
    ));
  };

  const takeConversation = (convId: string) => {
    setConversations((prev) => prev.map((c) =>
      c.id === convId ? { ...c, status: 'active', assignedAgent: 'You', waitTime: 0, messages: [...c.messages, { id: Date.now().toString(), sender: 'system', text: 'You joined the conversation', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }] } : c
    ));
    setActiveConvId(convId);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-medium text-[#1f1f1f]">Live Chat</h2>
          <p className="mt-0.5 text-sm text-[#595959]">Manage real-time customer conversations</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Agent Status */}
          <div className="relative">
            <button className="flex items-center gap-2 rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_CONFIG[agentStatus].color }} />
              {STATUS_CONFIG[agentStatus].label}
              <ChevronDown size={14} className="text-[#8a8a8a]" />
            </button>
            <div className="absolute right-0 top-full z-20 mt-1 hidden w-36 overflow-hidden rounded-lg border border-[#e5e0d5] bg-white shadow-lg group-focus-within:block hover:block">
              {(Object.keys(STATUS_CONFIG) as AgentStatus[]).map((s) => (
                <button key={s} onClick={() => setAgentStatus(s)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#fbf9f4]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_CONFIG[s].color }} />
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex h-9 items-center gap-1.5 rounded-lg border border-[#e5e0d5] bg-white px-3 text-sm">
            <Headset size={16} className="text-[#c9a87c]" />
            <span className="font-medium text-[#1f1f1f]">{activeCount}</span>
            <span className="text-[#8a8a8a]">active</span>
          </div>
        </div>
      </div>

      {/* Queue Stats */}
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => setQueueFilter('waiting')} className={`rounded-xl border p-3 text-left transition-colors ${queueFilter === 'waiting' ? 'border-amber-300 bg-amber-50' : 'border-[#e5e0d5] bg-white hover:bg-[#fbf9f4]'}`}>
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-amber-500" />
            <span className="text-xs text-[#595959]">Waiting</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-[#1f1f1f]">{waitingCount}</p>
        </button>
        <button onClick={() => setQueueFilter('active')} className={`rounded-xl border p-3 text-left transition-colors ${queueFilter === 'active' ? 'border-blue-300 bg-blue-50' : 'border-[#e5e0d5] bg-white hover:bg-[#fbf9f4]'}`}>
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-blue-500" />
            <span className="text-xs text-[#595959]">Active</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-[#1f1f1f]">{activeCount}</p>
        </button>
        <button onClick={() => setQueueFilter('resolved')} className={`rounded-xl border p-3 text-left transition-colors ${queueFilter === 'resolved' ? 'border-green-300 bg-green-50' : 'border-[#e5e0d5] bg-white hover:bg-[#fbf9f4]'}`}>
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-green-500" />
            <span className="text-xs text-[#595959]">Resolved</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-[#1f1f1f]">{resolvedCount}</p>
        </button>
      </div>

      {/* Chat Interface */}
      <div className="flex h-[600px] gap-4">
        {/* Conversation List */}
        <div className="flex w-80 flex-col rounded-xl border border-[#e5e0d5] bg-white">
          <div className="border-b border-[#e5e0d5] p-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] py-1.5 pl-8 pr-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConvs.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`flex w-full items-start gap-3 border-b border-[#e5e0d5]/50 px-3 py-3 text-left transition-colors hover:bg-[#fbf9f4] ${
                  activeConvId === conv.id ? 'bg-[#c9a87c]/10 border-l-2 border-l-[#c9a87c]' : ''
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#c9a87c]/20 text-sm font-medium text-[#1f1f1f]">
                  {conv.customerName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-medium text-[#1f1f1f]">{conv.customerName}</p>
                    <span className="shrink-0 text-[10px] text-[#8a8a8a]">{conv.lastActivity}</span>
                  </div>
                  <p className="truncate text-xs text-[#595959]">{conv.messages[conv.messages.length - 1]?.text || 'No messages'}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: conv.status === 'waiting' ? '#faad1415' : conv.status === 'active' ? '#1890ff15' : '#52c41a15',
                        color: conv.status === 'waiting' ? '#faad14' : conv.status === 'active' ? '#1890ff' : '#52c41a',
                      }}
                    >
                      {conv.status}
                    </span>
                    {conv.waitTime > 0 && (
                      <span className="text-[10px] text-amber-600">{Math.floor(conv.waitTime / 60)}m wait</span>
                    )}
                    {conv.rating && (
                      <span className="flex items-center gap-0.5 text-[10px] text-[#c9a87c]">
                        <Star size={10} fill="#c9a87c" /> {conv.rating}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex flex-1 flex-col rounded-xl border border-[#e5e0d5] bg-white">
          {activeConv ? (
            <>
              {/* Chat Header */}
              <div className="flex items-center justify-between border-b border-[#e5e0d5] px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#c9a87c]/20 text-sm font-medium text-[#1f1f1f]">
                    {activeConv.customerName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#1f1f1f]">{activeConv.customerName}</p>
                    <p className="text-xs text-[#8a8a8a]">{activeConv.customerEmail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Transfer */}
                  <div className="group relative">
                    <button className="rounded-lg border border-[#e5e0d5] p-2 text-[#8a8a8a] transition-colors hover:bg-[#fbf9f4]">
                      <ArrowRightLeft size={14} />
                    </button>
                    <div className="absolute right-0 top-full z-20 mt-1 hidden w-40 overflow-hidden rounded-lg border border-[#e5e0d5] bg-white shadow-lg group-hover:block group-focus-within:block">
                      <p className="border-b border-[#e5e0d5] px-3 py-1.5 text-xs font-medium text-[#1f1f1f]">Transfer to</p>
                      {AGENTS.filter((a) => a !== activeConv.assignedAgent).map((agent) => (
                        <button key={agent} onClick={() => transferConversation(activeConv.id, agent)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#fbf9f4]">
                          <User size={12} />
                          {agent}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => resolveConversation(activeConv.id)}
                    className="rounded-lg border border-[#e5e0d5] p-2 text-green-600 transition-colors hover:bg-green-50"
                    title="Resolve"
                  >
                    <CheckCircle size={14} />
                  </button>
                  {activeConv.status === 'waiting' && (
                    <button
                      onClick={() => takeConversation(activeConv.id)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#1f1f1f] transition-opacity hover:opacity-90"
                      style={{ backgroundColor: '#c9a87c' }}
                    >
                      Take
                    </button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 space-y-3 overflow-y-auto bg-[#fbf9f4] p-4">
                {activeConv.messages.map((msg) => (
                  <div key={msg.id} className={`flex gap-2 ${msg.sender === 'agent' ? 'flex-row-reverse' : ''}`}>
                    {msg.sender !== 'system' && (
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        msg.sender === 'customer' ? 'bg-[#c9a87c]/20' : 'bg-[#1890ff]/20'
                      }`}>
                        {msg.sender === 'customer' ? <User size={14} className="text-[#c9a87c]" /> : <Headset size={14} className="text-[#1890ff]" />}
                      </div>
                    )}
                    <div className={`max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      msg.sender === 'system' ? 'mx-auto bg-[#e5e0d5] text-[#595959] text-xs' :
                      msg.sender === 'agent' ? 'rounded-tr-sm bg-[#c9a87c] text-[#1f1f1f]' : 'rounded-tl-sm bg-white text-[#1f1f1f] shadow-sm'
                    }`}>
                      {msg.sender === 'agent' && msg.agentName && <p className="mb-0.5 text-[10px] opacity-70">{msg.agentName}</p>}
                      {msg.text}
                      <span className={`mt-1 block text-[10px] ${msg.sender === 'agent' ? 'text-[#1f1f1f]/60' : 'text-[#8a8a8a]'}`}>{msg.timestamp}</span>
                    </div>
                  </div>
                ))}
                {typingConvs.has(activeConv.id) && (
                  <div className="flex gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#c9a87c]/20">
                      <User size={14} className="text-[#c9a87c]" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
                      <div className="flex gap-1">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#c9a87c]" style={{ animationDelay: '0ms' }} />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#c9a87c]" style={{ animationDelay: '150ms' }} />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#c9a87c]" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Canned Responses Bar */}
              <AnimatePresence>
                {showCanned && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden border-t border-[#e5e0d5] bg-[#fbf9f4]">
                    <div className="flex gap-2 overflow-x-auto p-2">
                      {CANNED_RESPONSES.map((cr) => (
                        <button
                          key={cr.id}
                          onClick={() => sendMessage(cr.text)}
                          className="shrink-0 rounded-lg border border-[#e5e0d5] bg-white px-3 py-1.5 text-xs text-[#1f1f1f] transition-colors hover:bg-[#c9a87c]/10"
                        >
                          <Zap size={10} className="mb-0.5 mr-1 inline text-[#c9a87c]" />
                          {cr.label}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input */}
              <div className="flex items-center gap-2 border-t border-[#e5e0d5] bg-white px-3 py-3">
                <button
                  onClick={() => setShowCanned(!showCanned)}
                  className={`rounded-lg border p-2 transition-colors ${showCanned ? 'border-[#c9a87c] bg-[#c9a87c]/10' : 'border-[#e5e0d5] hover:bg-[#fbf9f4]'}`}
                >
                  <Zap size={16} className="text-[#c9a87c]" />
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
                  placeholder="Type a message..."
                  className="flex-1 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="flex h-9 w-9 items-center justify-center rounded-lg transition-opacity hover:opacity-90 disabled:opacity-30"
                  style={{ backgroundColor: '#c9a87c' }}
                >
                  <Send size={16} className="text-[#1f1f1f]" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-[#8a8a8a]">Select a conversation to start chatting</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
