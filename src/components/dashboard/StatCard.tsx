/**
 * Stat Card — Animated count-up stat with icon, trend badge
 */
import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useInView, useMotionValue, useTransform, animate } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  value: number;
  label: string;
  trend: string;
  trendType: 'up' | 'down' | 'neutral';
  linkTo: string;
  delay?: number;
}

function useCountUp(target: number, isInView: boolean) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const controls = animate(count, target, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    });
    const unsubscribe = rounded.on('change', (v) => setDisplay(v));
    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [isInView, target, count, rounded]);

  return display;
}

export default function StatCard({
  icon: Icon,
  iconColor,
  iconBg,
  value,
  label,
  trend,
  trendType,
  linkTo,
  delay = 0,
}: StatCardProps) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const displayValue = useCountUp(value, isInView);

  const TrendIcon = trendType === 'up' ? ArrowUp : trendType === 'down' ? ArrowDown : Minus;
  const trendColor =
    trendType === 'up'
      ? '#52c41a'
      : trendType === 'down'
        ? '#f5222d'
        : '#595959';

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.6,
        delay,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
      onClick={() => navigate(linkTo)}
      className="cursor-pointer rounded-xl border border-[#e5e0d5] bg-white p-6 transition-colors duration-200 hover:border-[rgba(201,168,124,0.3)]"
    >
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: iconBg }}
        >
          <Icon size={20} style={{ color: iconColor }} />
        </div>
        <div className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: trendColor, backgroundColor: `${trendColor}15` }}>
          <TrendIcon size={12} />
          <span>{trend}</span>
        </div>
      </div>
      <div className="mt-4">
        <p className="text-3xl font-bold tracking-tight text-[#1f1f1f] lg:text-4xl">
          {displayValue.toLocaleString()}
        </p>
        <p className="mt-1 text-xs font-normal uppercase tracking-[0.1em] text-[#595959]">
          {label}
        </p>
      </div>
    </motion.div>
  );
}
