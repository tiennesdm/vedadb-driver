/**
 * RoleBadge — Small colored pill badge showing role name
 */
import { Role, getRoleLabel, getRoleColor } from '@/lib/rbac';
import { cn } from '@/lib/utils';

interface RoleBadgeProps {
  role: Role | string;
  className?: string;
}

export default function RoleBadge({ role, className }: RoleBadgeProps) {
  const roleEnum = Object.values(Role).includes(role as Role)
    ? (role as Role)
    : Role.CUSTOMER;

  const label = getRoleLabel(roleEnum);
  const color = getRoleColor(roleEnum);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        className
      )}
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      {label}
    </span>
  );
}
