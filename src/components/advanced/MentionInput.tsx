/**
 * MentionInput — Text input with @mention support
 * Shows a dropdown user list when typing @
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import useAppStore from '@/lib/vedadb-store';
import { cn } from '@/lib/utils';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  onSubmit?: () => void;
  disabled?: boolean;
}

export default function MentionInput({
  value,
  onChange,
  placeholder = 'Type @ to mention...',
  rows = 3,
  className,
  onSubmit,
  disabled = false,
}: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const users = useAppStore((s) => s.users);

  const filteredUsers = users
    .filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 5);

  const lastAtIndex = value.lastIndexOf('@', cursorPos - 1);

  useEffect(() => {
    if (lastAtIndex !== -1 && cursorPos > lastAtIndex) {
      const afterAt = value.slice(lastAtIndex + 1, cursorPos);
      if (!afterAt.includes(' ') && afterAt.length >= 0) {
        setMentionQuery(afterAt);
        setShowMentions(true);
        setMentionIndex(0);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  }, [value, cursorPos, lastAtIndex]);

  const handleSelectUser = useCallback(
    (userName: string) => {
      if (lastAtIndex === -1) return;
      const before = value.slice(0, lastAtIndex);
      const after = value.slice(cursorPos);
      const newValue = `${before}@${userName} ${after}`;
      onChange(newValue);
      setShowMentions(false);
      setMentionQuery('');
      textareaRef.current?.focus();
    },
    [value, cursorPos, lastAtIndex, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredUsers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredUsers.length) % filteredUsers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectUser(filteredUsers[mentionIndex].name);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentions(false);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={cn('relative', className)}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCursorPos(e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onClick={(e) => setCursorPos(e.currentTarget.selectionStart)}
        onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className="w-full resize-none rounded-xl border border-[#e5e0d5] bg-[#fbf9f4] px-4 py-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c] focus:ring-2 focus:ring-[rgba(201,168,124,0.15)]"
      />

      {/* Mention dropdown */}
      {showMentions && filteredUsers.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-[#e5e0d5] bg-white py-1 shadow-lg">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-[#8a8a8a]">
            Mention user
          </div>
          {filteredUsers.map((user, idx) => (
            <button
              key={user.id}
              onClick={() => handleSelectUser(user.name)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                idx === mentionIndex
                  ? 'bg-[rgba(201,168,124,0.1)] text-[#1f1f1f]'
                  : 'text-[#595959] hover:bg-[#fbf9f4]'
              )}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-[10px] font-bold text-[#c9a87c]">
                {user.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()}
              </div>
              <span className="truncate">{user.name}</span>
              <span className="ml-auto text-xs text-[#8a8a8a]">{user.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
