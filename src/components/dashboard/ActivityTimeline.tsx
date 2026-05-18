/**
 * Activity Timeline — Recent activities with colored dots and timestamps
 */
import { motion } from 'framer-motion';

interface Activity {
  id: number;
  text: string;
  timestamp: string;
  dotColor: string;
}

interface ActivityTimelineProps {
  activities: Activity[];
}

export default function ActivityTimeline({ activities }: ActivityTimelineProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.5,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="rounded-xl border border-[#e5e0d5] bg-white p-6"
    >
      <h3 className="mb-4 text-lg font-medium text-[#1f1f1f]">Recent Activity</h3>

      {activities.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#595959]">No recent activity</p>
      ) : (
        <div className="relative">
          {activities.map((activity, index) => (
            <motion.div
              key={activity.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.5,
                delay: 0.6 + index * 0.08,
                ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
              }}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {/* Timeline line */}
              {index < activities.length - 1 && (
                <div
                  className="absolute left-[15px] top-[24px] w-[2px] bg-[#e5e0d5]"
                  style={{ height: 'calc(100% - 8px)' }}
                />
              )}
              {/* Dot */}
              <div className="relative z-10 flex shrink-0">
                <div
                  className="mt-1.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: activity.dotColor }}
                />
              </div>
              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[#1f1f1f]">{activity.text}</p>
                <p className="mt-0.5 text-xs text-[#8a8a8a]">{activity.timestamp}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
