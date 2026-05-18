/**
 * ChatPanel — Side chat panel for internal team communication
 */
import { useState, useRef, useEffect } from 'react';
import useAppStore from '@/lib/vedadb-store';
import { cn } from '@/lib/utils';
import {
  X,
  Send,
  MessageCircle,
  Minimize2,
  Maximize2,
  Users,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ChatMessage {
  id: string;
  userId: number;
  userName: string;
  content: string;
  createdAt: string;
}

export default function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentUser = useAppStore((s) => s.currentUser);
  const users = useAppStore((s) => s.users);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Sample initial messages
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: '1',
          userId: 0,
          userName: 'System',
          content: 'Team chat is active. Messages are visible to all agents and managers.',
          createdAt: new Date(Date.now() - 3600000).toISOString(),
        },
      ]);
    }
  }, []);

  const handleSend = () => {
    if (!message.trim() || !currentUser) return;
    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      userId: currentUser.id,
      userName: currentUser.name,
      content: message.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMsg]);
    setMessage('');
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center',
          'rounded-full bg-[#c9a87c] text-[#1f1f1f] shadow-lg',
          'transition-all hover:scale-105 hover:brightness-95 active:scale-95'
        )}
      >
        <MessageCircle size={24} />
        {messages.length > 1 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#f5222d] text-[10px] font-bold text-white">
            {messages.length - 1}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'fixed right-6 z-40 flex flex-col overflow-hidden rounded-2xl border border-[#e5e0d5] bg-white shadow-xl transition-all',
        isMinimized ? 'bottom-6 h-14 w-72' : 'bottom-6 h-[28rem] w-80'
      )}
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#e5e0d5] bg-[#fbf9f4] px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)]">
            <Users size={16} className="text-[#c9a87c]" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#1f1f1f]">Team Chat</h3>
            <p className="text-[10px] text-[#8a8a8a]">{users.length} members online</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="rounded-md p-1.5 text-[#8a8a8a] transition-colors hover:bg-[#e5e0d5] hover:text-[#1f1f1f]"
          >
            {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-md p-1.5 text-[#8a8a8a] transition-colors hover:bg-[#e5e0d5] hover:text-[#1f1f1f]"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            <div className="space-y-3">
              {messages.map((msg) => {
                const isMe = currentUser?.id === msg.userId;
                const isSystem = msg.userId === 0;
                return (
                  <div
                    key={msg.id}
                    className={cn('flex gap-2', isMe && 'flex-row-reverse')}
                  >
                    {!isSystem && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-[10px] font-bold text-[#c9a87c]">
                        {msg.userName
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .toUpperCase()}
                      </div>
                    )}
                    <div
                      className={cn(
                        'max-w-[75%] rounded-xl px-3 py-2',
                        isSystem
                          ? 'mx-auto w-full bg-[#f5f5f5] text-center'
                          : isMe
                          ? 'bg-[#c9a87c] text-[#1f1f1f]'
                          : 'bg-[#fbf9f4] text-[#1f1f1f]'
                      )}
                    >
                      {!isSystem && (
                        <p className="mb-0.5 text-[10px] font-medium text-[#8a8a8a]">
                          {msg.userName}
                        </p>
                      )}
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                      <span
                        className={cn(
                          'mt-1 block text-[10px]',
                          isSystem ? 'text-[#8a8a8a]' : 'text-[#595959] opacity-70'
                        )}
                      >
                        {formatDistanceToNow(new Date(msg.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-[#e5e0d5] px-4 py-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message..."
                className="flex-1 rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
              />
              <button
                onClick={handleSend}
                disabled={!message.trim()}
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all',
                  message.trim()
                    ? 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95'
                    : 'bg-[#e5e0d5] text-[#8a8a8a]'
                )}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
