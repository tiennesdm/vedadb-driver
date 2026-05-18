/**
 * RichTextEditor — Rich text editor with bold, italic, lists, links, code blocks
 * Uses contentEditable with toolbar buttons
 */
import { useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link,
  Code,
  Heading1,
  Heading2,
  Quote,
  Undo,
  Redo,
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Start typing...',
  className,
  minHeight = '120px',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  const exec = useCallback((command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    updateActiveFormats();
  }, []);

  const updateActiveFormats = () => {
    const formats = new Set<string>();
    if (document.queryCommandState('bold')) formats.add('bold');
    if (document.queryCommandState('italic')) formats.add('italic');
    if (document.queryCommandState('underline')) formats.add('underline');
    if (document.queryCommandState('insertUnorderedList')) formats.add('ul');
    if (document.queryCommandState('insertOrderedList')) formats.add('ol');
    setActiveFormats(formats);
  };

  const handleInput = () => {
    const html = editorRef.current?.innerHTML || '';
    onChange(html);
    updateActiveFormats();
  };

  const insertLink = () => {
    const url = prompt('Enter URL:');
    if (url) exec('createLink', url);
  };

  const toolbarBtn = (
    command: string,
    icon: React.ReactNode,
    label: string,
    isActive?: boolean
  ) => (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        exec(command);
      }}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-[#595959] transition-colors hover:bg-[#f5f0e8] hover:text-[#1f1f1f]',
        isActive && 'bg-[rgba(201,168,124,0.2)] text-[#c9a87c]'
      )}
    >
      {icon}
    </button>
  );

  return (
    <div className={cn('rounded-xl border border-[#e5e0d5] bg-white overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[#e5e0d5] bg-[#fbf9f4] px-2 py-1.5">
        {toolbarBtn('bold', <Bold size={15} />, 'Bold', activeFormats.has('bold'))}
        {toolbarBtn('italic', <Italic size={15} />, 'Italic', activeFormats.has('italic'))}
        <div className="mx-1 h-5 w-px bg-[#e5e0d5]" />
        {toolbarBtn('formatBlock', <Heading1 size={15} />, 'Heading 1')}
        {toolbarBtn('formatBlock', <Heading2 size={15} />, 'Heading 2')}
        <div className="mx-1 h-5 w-px bg-[#e5e0d5]" />
        {toolbarBtn('insertUnorderedList', <List size={15} />, 'Bullet List', activeFormats.has('ul'))}
        {toolbarBtn('insertOrderedList', <ListOrdered size={15} />, 'Numbered List', activeFormats.has('ol'))}
        <div className="mx-1 h-5 w-px bg-[#e5e0d5]" />
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            insertLink();
          }}
          title="Insert Link"
          className="flex h-8 w-8 items-center justify-center rounded-md text-[#595959] transition-colors hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
        >
          <Link size={15} />
        </button>
        {toolbarBtn('formatBlock', <Code size={15} />, 'Code Block')}
        {toolbarBtn('formatBlock', <Quote size={15} />, 'Quote')}
        <div className="mx-1 h-5 w-px bg-[#e5e0d5]" />
        {toolbarBtn('undo', <Undo size={15} />, 'Undo')}
        {toolbarBtn('redo', <Redo size={15} />, 'Redo')}
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onMouseUp={updateActiveFormats}
        onKeyUp={updateActiveFormats}
        data-placeholder={placeholder}
        className="px-4 py-3 text-sm text-[#1f1f1f] outline-none empty:before:text-[#8a8a8a] empty:before:content-[attr(data-placeholder)]"
        style={{ minHeight }}
        dangerouslySetInnerHTML={{ __html: value }}
      />
    </div>
  );
}
