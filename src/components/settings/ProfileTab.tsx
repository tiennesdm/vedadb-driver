import { useState, useEffect, useRef } from 'react';
import { Camera } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import useAppStore from '@/lib/vedadb-store';

interface Props {
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function ProfileTab({ showToast }: Props) {
  const currentUser = useAppStore((s) => s.currentUser);
  const update = useAppStore((s) => s.update);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name || '');
      setEmail(currentUser.email || '');
      setRole(currentUser.role || 'agent');
      // Try to get extended profile from localStorage
      const saved = localStorage.getItem('vedadesk_profile');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setDepartment(parsed.department || '');
          if (parsed.avatarUrl) setAvatarUrl(parsed.avatarUrl);
        } catch { /* ignore */ }
      }
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      const changed =
        name !== (currentUser.name || '') ||
        email !== (currentUser.email || '');
      setIsDirty(changed);
    }
  }, [name, email, currentUser]);

  const handleSave = async () => {
    if (!currentUser) return;
    try {
      await update('users', { name, email }, { id: currentUser.id });
      // Update local user state
      const updatedUser = { ...currentUser, name, email };
      useAppStore.setState({ currentUser: updatedUser });
      localStorage.setItem('vedadesk_user', JSON.stringify(updatedUser));
      localStorage.setItem('vedadesk_profile', JSON.stringify({ department, avatarUrl }));
      showToast('Profile updated successfully', 'success');
      setIsDirty(false);
    } catch {
      showToast('Failed to update profile', 'error');
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarUrl(reader.result as string);
        setIsDirty(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePasswordChange = () => {
    if (newPassword.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }
    if (!currentPassword) {
      showToast('Please enter your current password', 'error');
      return;
    }
    showToast('Password updated successfully', 'success');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const userInitials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase() || '?';

  if (!currentUser) {
    return (
      <div>
        <h2 className="text-2xl font-medium text-[#1f1f1f]">Your Profile</h2>
        <p className="mt-4 text-sm text-[#595959]">Please log in to view your profile.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-medium text-[#1f1f1f] tracking-tight">Your Profile</h2>
      <p className="mt-1 text-sm text-[#595959]">Manage your personal information and preferences.</p>

      {/* Avatar */}
      <div className="mt-8 flex flex-col items-center sm:items-start">
        <div className="relative">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Avatar"
              className="h-24 w-24 rounded-full border-[3px] border-[#e5e0d5] object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-[3px] border-[#e5e0d5] bg-[rgba(201,168,124,0.15)] text-xl font-bold text-[#c9a87c]">
              {userInitials}
            </div>
          )}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-[#595959] transition-colors hover:bg-[rgba(0,0,0,0.04)]"
        >
          <Camera size={14} />
          Change Avatar
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />
      </div>

      {/* Profile Form */}
      <div className="mt-8 max-w-lg space-y-5">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Full Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Department</Label>
          <Input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Your department"
            className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Role</Label>
          <div className="flex items-center h-10 px-3 rounded-md border border-[#e5e0d5] bg-[#fbf9f4] text-sm text-[#1f1f1f] capitalize">
            {role}
          </div>
          <p className="text-xs text-[#8a8a8a]">Your role is managed by an administrator.</p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-8 flex gap-3">
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className="rounded-lg bg-[#c9a87c] px-5 py-2.5 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          Save Changes
        </button>
        <button
          onClick={() => {
            setName(currentUser.name || '');
            setEmail(currentUser.email || '');
            setIsDirty(false);
          }}
          disabled={!isDirty}
          className="rounded-lg px-5 py-2.5 text-sm font-medium text-[#595959] transition-all hover:bg-[rgba(0,0,0,0.04)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Discard Changes
        </button>
      </div>

      {/* Change Password */}
      <Separator className="my-10 bg-[#e5e0d5]" />

      <div>
        <h3 className="text-lg font-medium text-[#1f1f1f]">Change Password</h3>
        <div className="mt-5 max-w-lg space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Current Password</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 characters"
              className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">Confirm Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
          </div>

          <button
            onClick={handlePasswordChange}
            className="rounded-lg border border-[#e5e0d5] bg-[#f5f0e8] px-5 py-2.5 text-sm font-medium text-[#1f1f1f] transition-all hover:bg-[#ede7db] active:scale-[0.98]"
          >
            Update Password
          </button>
        </div>
      </div>
    </div>
  );
}
