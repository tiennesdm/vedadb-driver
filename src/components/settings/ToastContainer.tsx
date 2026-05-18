import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: number) => void;
}

const toastStyles: Record<Toast['type'], string> = {
  success: 'border-l-4 border-l-[#52c41a] bg-[#f6ffed] text-[#1f1f1f]',
  error: 'border-l-4 border-l-[#f5222d] bg-[#fff1f0] text-[#1f1f1f]',
  info: 'border-l-4 border-l-[#1890ff] bg-[#e6f0ff] text-[#1f1f1f]',
};

const iconMap: Record<Toast['type'], string> = {
  success: 'text-[#52c41a]',
  error: 'text-[#f5222d]',
  info: 'text-[#1890ff]',
};

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'flex items-center gap-3 rounded-md px-4 py-3 shadow-lg min-w-[280px] max-w-[400px] transition-all duration-400',
            toastStyles[toast.type]
          )}
          style={{
            animation: 'slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <span className={cn('text-lg', iconMap[toast.type])}>
            {toast.type === 'success' && '\u2713'}
            {toast.type === 'error' && '\u2717'}
            {toast.type === 'info' && '\u2139'}
          </span>
          <span className="text-sm flex-1">{toast.message}</span>
          <button
            onClick={() => onRemove(toast.id)}
            className="text-[#8a8a8a] hover:text-[#1f1f1f] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
