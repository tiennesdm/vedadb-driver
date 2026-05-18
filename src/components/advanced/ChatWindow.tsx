/**
 * ChatWindow — Chat conversation window
 * Shows conversation between customer and agent/bot
 */
import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Minimize } from 'lucide-react';
import { motion } from 'framer-motion';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot' | 'agent';
  text: string;
  timestamp: string;
}

const MOCK_MESSAGES: ChatMessage[] = [
  { id: '1', sender: 'bot', text: 'Hello! How can I help you today?', timestamp: '10:30 AM' },
  { id: '2', sender: 'user', text: 'I need help resetting my password', timestamp: '10:31 AM' },
  { id: '3', sender: 'bot', text: 'I can help with that! Please visit the password reset page or I can connect you with an agent.', timestamp: '10:31 AM' },
];

const BOT_RESPONSES = [
  'I understand. Let me find the best resource for you.',
  'Could you provide more details about your issue?',
  'I have found a relevant knowledge base article that may help.',
  'I will connect you with a support agent who can assist further.',
  'Thank you for your patience. Is there anything else I can help with?',
];

export default function ChatWindow({ onClose }: { onClose?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(MOCK_MESSAGES);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => scrollToBottom(), [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: input,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    setTimeout(() => {
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: BOT_RESPONSES[Math.floor(Math.random() * BOT_RESPONSES.length)],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, botMsg]);
      setIsTyping(false);
    }, 1200);
  };

  return (
    <div className="flex h-[480px] w-[360px] flex-col overflow-hidden rounded-2xl border border-[#e5e0d5] bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e5e0d5] bg-[#c9a87c] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <Bot size={18} className="text-[#1f1f1f]" />
          </div>
          <div>
            <p className="text-sm font-medium text-[#1f1f1f]">Support Assistant</p>
            <p className="text-xs text-[#1f1f1f]/70">Online</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 hover:bg-white/20">
            <Minimize size={16} className="text-[#1f1f1f]" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto bg-[#fbf9f4] p-4">
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              msg.sender === 'user' ? 'bg-[#1890ff]' : msg.sender === 'bot' ? 'bg-[#c9a87c]' : 'bg-[#52c41a]'
            }`}>
              {msg.sender === 'user' ? <User size={14} className="text-white" /> : <Bot size={14} className="text-[#1f1f1f]" />}
            </div>
            <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
              msg.sender === 'user' ? 'rounded-tr-sm bg-[#c9a87c] text-[#1f1f1f]' : 'rounded-tl-sm bg-white text-[#1f1f1f] shadow-sm'
            }`}>
              {msg.text}
              <span className={`mt-1 block text-[10px] ${msg.sender === 'user' ? 'text-[#1f1f1f]/60' : 'text-[#8a8a8a]'}`}>
                {msg.timestamp}
              </span>
            </div>
          </motion.div>
        ))}
        {isTyping && (
          <div className="flex gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#c9a87c]">
              <Bot size={14} className="text-[#1f1f1f]" />
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

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-[#e5e0d5] bg-white px-3 py-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          className="flex-1 rounded-full border border-[#e5e0d5] bg-[#fbf9f4] px-4 py-2 text-sm text-[#1f1f1f] outline-none placeholder:text-[#8a8a8a] focus:border-[#c9a87c]"
        />
        <button
          onClick={handleSend}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
          style={{ backgroundColor: '#c9a87c' }}
        >
          <Send size={16} className="text-[#1f1f1f]" />
        </button>
      </div>
    </div>
  );
}
