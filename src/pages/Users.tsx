/**
 * Users Page — Team member management with role assignment, department organization, and user CRUD
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  UserPlus,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Trash2,
  Ticket,
  CheckCircle,
  X,
  AlertTriangle,
} from 'lucide-react';
import useAppStore from '@/lib/vedadb-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import EmptyState from '@/components/EmptyState';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  avatar: string;
  created_at: string;
  ticket_count?: number;
  resolved_count?: number;
}

/* ------------------------------------------------------------------ */
/*  Role badge styles                                                  */
/* ------------------------------------------------------------------ */

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-[rgba(114,46,209,0.1)] text-[#722ed1] border-[rgba(114,46,209,0.2)]',
  agent: 'bg-[rgba(24,144,255,0.1)] text-[#1890ff] border-[rgba(24,144,255,0.2)]',
  viewer: 'bg-[rgba(138,138,138,0.1)] text-[#8a8a8a] border-[rgba(138,138,138,0.2)]',
};

const ROLE_DESC: Record<string, string> = {
  admin: 'Full access — can manage tickets, users, and settings',
  agent: 'Can create, edit, and resolve tickets',
  viewer: 'Can view tickets and knowledge base only',
};

/* ------------------------------------------------------------------ */
/*  Animation variants                                                 */
/* ------------------------------------------------------------------ */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

/* ------------------------------------------------------------------ */
/*  Users Page                                                         */
/* ------------------------------------------------------------------ */

export default function Users() {
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const currentUser = useAppStore((s) => s.currentUser);

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name_asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(true);

  /* Modal states */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', role: 'agent', department: '', avatar: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserRecord | null>(null);

  const isAdmin = currentUser?.role === 'admin';

  /* Fetch users with ticket counts */
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await query(`
        SELECT u.*,
          (SELECT COUNT(*) FROM tickets WHERE assigned_to = u.id) as ticket_count,
          (SELECT COUNT(*) FROM tickets WHERE assigned_to = u.id AND status = 'resolved') as resolved_count
        FROM users u
        ORDER BY u.name ASC
      `);
      const objs = result.toObjects() as unknown as UserRecord[];
      setUsers(objs);

      // Extract unique departments
      const depts = Array.from(new Set(objs.map((u) => u.department).filter(Boolean))).sort();
      setDepartments(depts);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [query]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  /* Filtered & sorted users */
  const filteredUsers = useMemo(() => {
    let list = [...users];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term)
      );
    }

    if (roleFilter !== 'all') {
      list = list.filter((u) => u.role === roleFilter);
    }

    if (deptFilter !== 'all') {
      list = list.filter((u) => u.department === deptFilter);
    }

    switch (sortBy) {
      case 'name_asc':
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name_desc':
        list.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'most_tickets':
        list.sort((a, b) => (b.ticket_count || 0) - (a.ticket_count || 0));
        break;
      case 'recent':
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'role':
        list.sort((a, b) => a.role.localeCompare(b.role));
        break;
    }

    return list;
  }, [users, searchTerm, roleFilter, deptFilter, sortBy]);

  /* Form helpers */
  const openAddModal = () => {
    setEditingUser(null);
    setFormData({ name: '', email: '', role: 'agent', department: '', avatar: '' });
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (user: UserRecord) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department || '',
      avatar: user.avatar || '',
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim() || formData.name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Enter a valid email address';
    }
    if (!formData.role) {
      errors.role = 'Select a role';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    if (editingUser) {
      await update('users', {
        name: formData.name.trim(),
        email: formData.email.trim(),
        role: formData.role,
        department: formData.department.trim(),
        avatar: formData.avatar.trim(),
      }, { id: editingUser.id });
    } else {
      await insert('users', {
        name: formData.name.trim(),
        email: formData.email.trim(),
        role: formData.role,
        department: formData.department.trim(),
        avatar: formData.avatar.trim() || '',
      });
    }
    setModalOpen(false);
    fetchUsers();
  };

  const confirmDelete = (user: UserRecord) => {
    setDeletingUser(user);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    // Unassign tickets first, then delete user
    await update('tickets', { assigned_to: null }, { assigned_to: deletingUser.id });
    await deleteFrom('users', { id: deletingUser.id });
    setDeleteDialogOpen(false);
    setDeletingUser(null);
    fetchUsers();
  };

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-medium text-[#1f1f1f]">Team Members</h2>
          <span className="rounded-full bg-[#f5f0e8] px-2.5 py-0.5 text-xs font-medium text-[#595959]">
            {users.length} members
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
            <Input
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 w-[260px] rounded-lg border-[#e5e0d5] bg-white pl-9 pr-8 text-sm placeholder:text-[#8a8a8a] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a8a8a] hover:text-[#1f1f1f]"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {isAdmin && (
            <Button
              onClick={openAddModal}
              className="h-9 gap-1.5 rounded-lg bg-[#c9a87c] px-4 text-sm font-medium text-[#1f1f1f] hover:bg-[#b8996f]"
            >
              <UserPlus size={16} />
              Add Member
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-[#e5e0d5] pb-4">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-[130px] rounded-lg border-[#e5e0d5] bg-[#f5f0e8] text-sm focus:ring-[rgba(201,168,124,0.15)]">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>

        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="h-9 w-[160px] rounded-lg border-[#e5e0d5] bg-[#f5f0e8] text-sm focus:ring-[rgba(201,168,124,0.15)]">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-9 w-[150px] rounded-lg border-[#e5e0d5] bg-[#f5f0e8] text-sm focus:ring-[rgba(201,168,124,0.15)]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name_asc">Name A-Z</SelectItem>
            <SelectItem value="name_desc">Name Z-A</SelectItem>
            <SelectItem value="most_tickets">Most Tickets</SelectItem>
            <SelectItem value="recent">Recently Added</SelectItem>
            <SelectItem value="role">Role</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center rounded-lg bg-[#f5f0e8] p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-all ${
              viewMode === 'grid' ? 'bg-[#c9a87c] text-[#1f1f1f]' : 'text-[#8a8a8a] hover:text-[#595959]'
            }`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-all ${
              viewMode === 'list' ? 'bg-[#c9a87c] text-[#1f1f1f]' : 'text-[#8a8a8a] hover:text-[#595959]'
            }`}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-[#e5e0d5] bg-white p-6">
              <div className="mx-auto h-16 w-16 rounded-full bg-[#f5f0e8]" />
              <div className="mx-auto mt-4 h-4 w-32 rounded bg-[#f5f0e8]" />
              <div className="mx-auto mt-2 h-3 w-48 rounded bg-[#f5f0e8]" />
            </div>
          ))}
        </div>
      ) : filteredUsers.length === 0 ? (
        <EmptyState
          illustration="./empty-users.svg"
          title="No team members found"
          description={searchTerm ? 'Try adjusting your search or filters' : 'Add your first team member to get started'}
          action={
            isAdmin ? (
              <Button
                onClick={openAddModal}
                className="h-9 gap-1.5 rounded-lg bg-[#c9a87c] px-4 text-sm font-medium text-[#1f1f1f] hover:bg-[#b8996f]"
              >
                <UserPlus size={16} />
                Add Member
              </Button>
            ) : undefined
          }
        />
      ) : (
        <AnimatePresence mode="wait">
          {viewMode === 'grid' ? (
            <motion.div
              key="grid"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0 }}
              className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {filteredUsers.map((user) => (
                <motion.div
                  key={user.id}
                  variants={cardVariants}
                  className="group relative cursor-pointer rounded-xl border border-[#e5e0d5] bg-white p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-[rgba(201,168,124,0.3)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
                  onClick={() => openEditModal(user)}
                >
                  {/* Actions menu */}
                  {isAdmin && (
                    <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8a] transition-colors hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[140px]">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditModal(user); }}>
                            <Pencil size={14} className="mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); confirmDelete(user); }} className="text-[#f5222d] focus:text-[#f5222d]">
                            <Trash2 size={14} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {/* Avatar */}
                  <div className="flex justify-center">
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="h-16 w-16 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(201,168,124,0.15)] text-base font-bold text-[#c9a87c]">
                        {getInitials(user.name)}
                      </div>
                    )}
                  </div>

                  {/* Name */}
                  <p className="mt-4 truncate text-center text-sm font-semibold text-[#1f1f1f]">
                    {user.name}
                  </p>

                  {/* Email */}
                  <p className="mt-0.5 truncate text-center text-xs text-[#8a8a8a]">
                    {user.email}
                  </p>

                  {/* Role Badge */}
                  <div className="mt-2 flex justify-center">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${
                        ROLE_STYLES[user.role] || ROLE_STYLES.viewer
                      }`}
                    >
                      {user.role}
                    </span>
                  </div>

                  {/* Department */}
                  <p className="mt-1 truncate text-center text-xs text-[#595959]">
                    {user.department}
                  </p>

                  {/* Stats */}
                  <div className="mt-4 flex items-center justify-around border-t border-[#e5e0d5] pt-3">
                    <div className="text-center">
                      <div className="flex items-center gap-1">
                        <Ticket size={14} className="text-[#8a8a8a]" />
                        <span className="text-sm font-semibold text-[#1f1f1f]">
                          {user.ticket_count || 0}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#8a8a8a]">tickets</span>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center gap-1">
                        <CheckCircle size={14} className="text-[#52c41a]" />
                        <span className="text-sm font-semibold text-[#52c41a]">
                          {user.resolved_count || 0}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#8a8a8a]">resolved</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 overflow-hidden rounded-xl border border-[#e5e0d5] bg-white"
            >
              {/* Table Header */}
              <div className="hidden grid-cols-[56px_1fr_120px_150px_100px_100px_120px_60px] gap-4 border-b border-[#e5e0d5] bg-[#f5f0e8] px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#595959] md:grid">
                <span />
                <span>Name</span>
                <span>Role</span>
                <span>Department</span>
                <span className="text-center">Tickets</span>
                <span className="text-center">Resolved</span>
                <span>Joined</span>
                <span />
              </div>

              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="group grid cursor-pointer grid-cols-1 items-center gap-3 border-b border-[#e5e0d5] px-4 py-3 transition-colors last:border-b-0 hover:bg-[#fbf9f4] md:grid-cols-[56px_1fr_120px_150px_100px_100px_120px_60px] md:gap-4"
                  onClick={() => openEditModal(user)}
                >
                  {/* Avatar */}
                  <div className="hidden md:flex">
                    {user.avatar ? (
                      <img src={user.avatar} alt={user.name} className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(201,168,124,0.15)] text-xs font-bold text-[#c9a87c]">
                        {getInitials(user.name)}
                      </div>
                    )}
                  </div>

                  {/* Name + Email */}
                  <div className="flex items-center gap-3 md:gap-0">
                    <div className="md:hidden">
                      {user.avatar ? (
                        <img src={user.avatar} alt={user.name} className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(201,168,124,0.15)] text-xs font-bold text-[#c9a87c]">
                          {getInitials(user.name)}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1f1f1f]">{user.name}</p>
                      <p className="text-xs text-[#8a8a8a]">{user.email}</p>
                    </div>
                  </div>

                  {/* Role */}
                  <div>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${
                        ROLE_STYLES[user.role] || ROLE_STYLES.viewer
                      }`}
                    >
                      {user.role}
                    </span>
                  </div>

                  {/* Department */}
                  <div className="text-sm text-[#595959]">{user.department}</div>

                  {/* Tickets */}
                  <div className="text-center text-sm font-semibold text-[#1f1f1f]">
                    {user.ticket_count || 0}
                  </div>

                  {/* Resolved */}
                  <div className="text-center text-sm font-semibold text-[#52c41a]">
                    {user.resolved_count || 0}
                  </div>

                  {/* Joined */}
                  <div className="font-mono text-xs text-[#8a8a8a]">
                    {new Date(user.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end">
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8a] transition-colors hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditModal(user); }}>
                            <Pencil size={14} className="mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); confirmDelete(user); }} className="text-[#f5222d] focus:text-[#f5222d]">
                            <Trash2 size={14} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Add/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[520px] border-[#e5e0d5] bg-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#1f1f1f]">
              {editingUser ? 'Edit Team Member' : 'Add Team Member'}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Full Name *
              </label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter full name"
                className={`h-10 rounded-lg border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)] ${
                  formErrors.name ? 'border-[#f5222d]' : ''
                }`}
              />
              {formErrors.name && <p className="mt-1 text-xs text-[#f5222d]">{formErrors.name}</p>}
            </div>

            {/* Email */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Email *
              </label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Enter email address"
                className={`h-10 rounded-lg border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)] ${
                  formErrors.email ? 'border-[#f5222d]' : ''
                }`}
              />
              {formErrors.email && <p className="mt-1 text-xs text-[#f5222d]">{formErrors.email}</p>}
            </div>

            {/* Role */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Role *
              </label>
              <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
                <SelectTrigger className="h-10 w-full rounded-lg border-[#e5e0d5] focus:ring-[rgba(201,168,124,0.15)]">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-[#595959]">{ROLE_DESC[formData.role]}</p>
              {formErrors.role && <p className="mt-1 text-xs text-[#f5222d]">{formErrors.role}</p>}
            </div>

            {/* Department */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Department
              </label>
              <Input
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                placeholder="e.g., IT Operations"
                className="h-10 rounded-lg border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
              />
            </div>

            {/* Avatar URL */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Avatar URL
              </label>
              <Input
                value={formData.avatar}
                onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
                placeholder="https://example.com/avatar.jpg (optional)"
                className="h-10 rounded-lg border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setModalOpen(false)}
              className="h-9 rounded-lg border-[#e5e0d5] px-4 text-sm text-[#595959] hover:bg-[#f5f0e8]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              className="h-9 rounded-lg bg-[#c9a87c] px-4 text-sm font-medium text-[#1f1f1f] hover:bg-[#b8996f]"
            >
              {editingUser ? 'Save Changes' : 'Add Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-[400px] border-[#e5e0d5] bg-white">
          <div className="flex flex-col items-center pt-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fff1f0]">
              <AlertTriangle size={24} className="text-[#f5222d]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[#1f1f1f]">Remove Team Member</h3>
            <p className="mt-2 text-sm text-[#595959]">
              Are you sure you want to remove <strong className="text-[#1f1f1f]">{deletingUser?.name}</strong>?
              Their ticket assignments will become unassigned.
            </p>
          </div>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="h-9 rounded-lg border-[#e5e0d5] px-4 text-sm text-[#595959] hover:bg-[#f5f0e8]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              className="h-9 rounded-lg bg-[#f5222d] px-4 text-sm font-medium text-white hover:bg-[#cf1322]"
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
