/**
 * CABPanel — CAB (Change Advisory Board) approval voting panel
 */
import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Minus, Users, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';

export interface CABMember {
  id: number;
  name: string;
  role: string;
  vote: 'approved' | 'rejected' | 'pending' | 'abstained';
  voted_at?: string;
  comment?: string;
}

const VOTE_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  'approved': { icon: <ThumbsUp size={14} />, label: 'Approved', color: '#52c41a', bg: '#f6ffed' },
  'rejected': { icon: <ThumbsDown size={14} />, label: 'Rejected', color: '#f5222d', bg: '#fff2f0' },
  'pending': { icon: <Minus size={14} />, label: 'Pending', color: '#8a8a8a', bg: '#f5f0e8' },
  'abstained': { icon: <HelpCircle size={14} />, label: 'Abstained', color: '#faad14', bg: '#fffbe6' },
};

export default function CABPanel({
  members,
  onVote,
  readonly = false,
}: {
  members: CABMember[];
  onVote?: (memberId: number, vote: 'approved' | 'rejected' | 'abstained', comment?: string) => void;
  readonly?: boolean;
}) {
  const [comment, setComment] = useState('');

  const approved = members.filter((m) => m.vote === 'approved').length;
  const rejected = members.filter((m) => m.vote === 'rejected').length;
  const totalVoted = members.filter((m) => m.vote !== 'pending').length;

  return (
    <div className="rounded-xl border border-[#e5e0d5] bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-[#c9a87c]" />
          <h3 className="text-sm font-semibold text-[#1f1f1f]">CAB Approval</h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-[#52c41a]">
            <CheckCircle2 size={14} /> {approved}
          </span>
          <span className="flex items-center gap-1 text-[#f5222d]">
            <XCircle size={14} /> {rejected}
          </span>
          <span className="text-[#8a8a8a]">{totalVoted}/{members.length} voted</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-[#f0ece3]">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${members.length > 0 ? (totalVoted / members.length) * 100 : 0}%`,
            backgroundColor: approved > rejected ? '#52c41a' : rejected > approved ? '#f5222d' : '#faad14',
          }}
        />
      </div>

      {/* Member list */}
      <div className="space-y-2">
        {members.map((member) => {
          const vc = VOTE_CONFIG[member.vote];
          return (
            <div key={member.id} className="flex items-center gap-3 rounded-lg border border-[#e5e0d5] px-3 py-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-white text-xs font-bold"
                style={{ backgroundColor: '#c9a87c' }}
              >
                {member.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#1f1f1f] truncate">{member.name}</p>
                <p className="text-[10px] text-[#8a8a8a]">{member.role}</p>
              </div>
              <div
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ color: vc.color, backgroundColor: vc.bg }}
              >
                {vc.icon}
                <span>{vc.label}</span>
              </div>

              {!readonly && member.vote === 'pending' && onVote && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onVote(member.id, 'approved', comment)}
                    className="rounded p-1 hover:bg-[#f6ffed] text-[#52c41a]"
                    title="Approve"
                  >
                    <ThumbsUp size={14} />
                  </button>
                  <button
                    onClick={() => onVote(member.id, 'rejected', comment)}
                    className="rounded p-1 hover:bg-[#fff2f0] text-[#f5222d]"
                    title="Reject"
                  >
                    <ThumbsDown size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readonly && onVote && (
        <div className="mt-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add CAB comment..."
            className="w-full rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-xs text-[#1f1f1f] outline-none transition-colors focus:border-[#c9a87c] focus:ring-1 focus:ring-[rgba(201,168,124,0.15)]"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
