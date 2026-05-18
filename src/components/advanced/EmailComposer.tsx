/**
 * EmailComposer — Email composition with template variables
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Send,
  Paperclip,
  Variable,
  Eye,
  Mail,
} from 'lucide-react';

const TEMPLATE_VARIABLES = [
  { key: '{{ticket.id}}', label: 'Ticket ID' },
  { key: '{{ticket.title}}', label: 'Ticket Title' },
  { key: '{{agent.name}}', label: 'Agent Name' },
  { key: '{{user.name}}', label: 'User Name' },
  { key: '{{ticket.status}}', label: 'Ticket Status' },
  { key: '{{ticket.priority}}', label: 'Ticket Priority' },
  { key: '{{ticket.url}}', label: 'Ticket URL' },
  { key: '{{app.name}}', label: 'App Name' },
];

interface EmailComposerProps {
  initialSubject?: string;
  initialBody?: string;
  onSend?: (data: { subject: string; body: string }) => void;
  className?: string;
}

export default function EmailComposer({
  initialSubject = '',
  initialBody = '',
  onSend,
  className,
}: EmailComposerProps) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [showVars, setShowVars] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [to, setTo] = useState('');

  const insertVariable = (variable: string) => {
    setBody((prev) => prev + variable);
  };

  const previewSubject = subject
    .replace(/\{\{ticket\.id\}\}/g, 'TKT-1234')
    .replace(/\{\{ticket\.title\}\}/g, 'Server Down in Production')
    .replace(/\{\{agent\.name\}\}/g, 'Jane Smith')
    .replace(/\{\{user\.name\}\}/g, 'John Doe')
    .replace(/\{\{ticket\.status\}\}/g, 'Open')
    .replace(/\{\{ticket\.priority\}\}/g, 'High')
    .replace(/\{\{app\.name\}\}/g, 'VedaDesk');

  const previewBody = body
    .replace(/\{\{ticket\.id\}\}/g, 'TKT-1234')
    .replace(/\{\{ticket\.title\}\}/g, 'Server Down in Production')
    .replace(/\{\{agent\.name\}\}/g, 'Jane Smith')
    .replace(/\{\{user\.name\}\}/g, 'John Doe')
    .replace(/\{\{ticket\.status\}\}/g, 'Open')
    .replace(/\{\{ticket\.priority\}\}/g, 'High')
    .replace(/\{\{app\.name\}\}/g, 'VedaDesk');

  const handleSend = () => {
    if (onSend) {
      onSend({ subject, body });
    }
  };

  return (
    <div className={cn('rounded-xl border border-[#e5e0d5] bg-white overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e5e0d5] bg-[#fbf9f4] px-4 py-3">
        <div className="flex items-center gap-2">
          <Mail size={18} className="text-[#c9a87c]" />
          <h3 className="text-sm font-medium text-[#1f1f1f]">Compose Email</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowVars(!showVars)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              showVars
                ? 'bg-[rgba(201,168,124,0.2)] text-[#c9a87c]'
                : 'text-[#595959] hover:bg-[#f5f0e8]'
            )}
          >
            <Variable size={12} />
            Variables
          </button>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              showPreview
                ? 'bg-[rgba(201,168,124,0.2)] text-[#c9a87c]'
                : 'text-[#595959] hover:bg-[#f5f0e8]'
            )}
          >
            <Eye size={12} />
            Preview
          </button>
        </div>
      </div>

      {/* Variables panel */}
      {showVars && (
        <div className="border-b border-[#e5e0d5] bg-[#fbf9f4] px-4 py-2">
          <p className="mb-1.5 text-[10px] uppercase tracking-[0.1em] text-[#8a8a8a]">
            Click to insert
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                onClick={() => insertVariable(v.key)}
                className="rounded-md bg-white border border-[#e5e0d5] px-2 py-1 text-xs text-[#595959] transition-colors hover:border-[#c9a87c] hover:text-[#c9a87c]"
                title={v.label}
              >
                {v.key}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Form */}
      <div className="space-y-3 p-4">
        {/* To */}
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
            To
          </label>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@company.com"
            className="h-10 w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
          />
        </div>

        {/* Subject */}
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject..."
            className="h-10 w-full rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c]"
          />
        </div>

        {/* Body */}
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.1em] text-[#595959]">
            Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your email..."
            rows={8}
            className="w-full resize-none rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-4 py-3 text-sm text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c] focus:ring-2 focus:ring-[rgba(201,168,124,0.15)]"
          />
        </div>
      </div>

      {/* Preview */}
      {showPreview && (
        <div className="border-t border-[#e5e0d5] bg-[#fbf9f4] px-4 py-3">
          <p className="mb-2 text-[10px] uppercase tracking-[0.1em] text-[#8a8a8a]">
            Preview with sample data
          </p>
          <div className="rounded-lg border border-[#e5e0d5] bg-white p-4">
            <p className="mb-1 text-xs font-medium text-[#8a8a8a]">Subject:</p>
            <p className="mb-3 text-sm text-[#1f1f1f]">{previewSubject || '(empty)'}</p>
            <p className="mb-1 text-xs font-medium text-[#8a8a8a]">Body:</p>
            <div
              className="prose prose-sm max-w-none text-sm text-[#1f1f1f]"
              dangerouslySetInnerHTML={{
                __html: previewBody.replace(/\n/g, '<br/>') || '<span class="text-[#8a8a8a]">(empty)</span>',
              }}
            />
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-[#e5e0d5] px-4 py-3">
        <button className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[#595959] transition-colors hover:bg-[#f5f0e8]">
          <Paperclip size={14} />
          Attach
        </button>
        <button
          onClick={handleSend}
          disabled={!subject.trim() || !body.trim()}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
            subject.trim() && body.trim()
              ? 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95'
              : 'bg-[#e5e0d5] text-[#8a8a8a]'
          )}
        >
          <Send size={14} />
          Send
        </button>
      </div>
    </div>
  );
}
