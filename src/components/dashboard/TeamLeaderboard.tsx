/**
 * Team Leaderboard — Top performers by resolved tickets
 */
import { motion } from 'framer-motion';

interface LeaderboardMember {
  rank: number;
  name: string;
  initials: string;
  resolved: number;
  percentage: number;
}

interface TeamLeaderboardProps {
  members: LeaderboardMember[];
}

export default function TeamLeaderboard({ members }: TeamLeaderboardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.6,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="rounded-xl border border-[#e5e0d5] bg-white p-6"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#1f1f1f]">Team Performance</h3>
        <span className="rounded-full bg-[#f5f0e8] px-2.5 py-0.5 text-xs uppercase tracking-[0.05em] text-[#595959]">
          This Month
        </span>
      </div>

      {members.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#595959]">
          No resolved tickets yet
        </p>
      ) : (
        <div className="space-y-4">
          {members.map((member, index) => (
            <motion.div
              key={member.rank}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                delay: 0.7 + index * 0.08,
                ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
              }}
              className="flex items-center gap-3"
            >
              {/* Rank */}
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5f0e8]">
                <span className="text-xs font-bold text-[#595959]">
                  {member.rank}
                </span>
              </div>

              {/* Avatar */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(201,168,124,0.15)] text-xs font-bold text-[#c9a87c]">
                {member.initials}
              </div>

              {/* Name + progress */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium text-[#1f1f1f]">
                    {member.name}
                  </span>
                  <span className="ml-2 text-sm font-bold text-[#1f1f1f]">
                    {member.resolved}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#f5f0e8]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${member.percentage}%` }}
                    transition={{
                      duration: 1,
                      delay: 0.8 + index * 0.1,
                      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
                    }}
                    className="h-full rounded-full bg-[#c9a87c]"
                  />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
