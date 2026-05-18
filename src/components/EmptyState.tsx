/**
 * Reusable empty state component with illustration
 */
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  illustration: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      <img
        src={illustration}
        alt={title}
        className="mb-4 h-40 w-auto opacity-70"
      />
      <h3 className="text-base font-medium text-[#1f1f1f]">{title}</h3>
      {description && (
        <p className="mt-1 max-w-xs text-sm text-[#8a8a8a]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
