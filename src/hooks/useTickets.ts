/**
 * Custom hook for ticket data fetching, filtering, sorting, and pagination
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import useAppStore from '@/lib/vedadb-store';

export interface Ticket {
  id: number;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed' | 'on_hold';
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  created_by: number | null;
  assigned_to: number | null;
  assignee_name?: string;
  assignee_avatar?: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  avatar: string;
  department: string;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  description: string;
  icon: string;
  created_at: string;
}

export interface Comment {
  id: number;
  ticket_id: number;
  user_id: number;
  author_name?: string;
  author_avatar?: string;
  content: string;
  created_at: string;
}

export interface Activity {
  id: number;
  ticket_id: number;
  user_id: number | null;
  user_name?: string;
  action: string;
  created_at: string;
}

export interface TicketFilters {
  search: string;
  status: string;
  priority: string;
  category: string;
  assignedTo: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: TicketFilters = {
  search: '',
  status: '',
  priority: '',
  category: '',
  assignedTo: '',
  sortBy: 'created_at',
  sortDir: 'desc',
};

const SORT_MAP: Record<string, string> = {
  newest: 'created_at',
  oldest: 'created_at',
  priority_high: 'priority',
  priority_low: 'priority',
  title_az: 'title',
  title_za: 'title',
};

const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

export function useTicketsList() {
  const query = useAppStore((s) => s.query);
  const select = useAppStore((s) => s.select);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState<TicketFilters>(DEFAULT_FILTERS);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      const result = await select('users', {});
      setUsers(result.toObjects() as unknown as User[]);
    } catch {
      // ignore
    }
  }, [select]);

  // Fetch categories
  const fetchCategories = useCallback(async () => {
    try {
      const result = await select('categories', {});
      setCategories(result.toObjects() as unknown as Category[]);
    } catch {
      // ignore
    }
  }, [select]);

  // Fetch tickets with filters
  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      let sql = `SELECT t.*, u.name as assignee_name, u.avatar as assignee_avatar FROM tickets t LEFT JOIN users u ON t.assigned_to = u.id`;
      const conditions: string[] = [];

      if (filters.status) conditions.push(`t.status = '${filters.status}'`);
      if (filters.priority) conditions.push(`t.priority = '${filters.priority}'`);
      if (filters.category) conditions.push(`t.category = '${filters.category}'`);
      if (filters.assignedTo) conditions.push(`t.assigned_to = ${filters.assignedTo}`);
      if (filters.search) {
        const searchTerm = filters.search.replace(/'/g, "''");
        conditions.push(`(t.title LIKE '%${searchTerm}%' OR t.description LIKE '%${searchTerm}%' OR t.id = '${searchTerm}')`);
      }

      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

      // Sort
      const sortCol = SORT_MAP[filters.sortBy] || 'created_at';
      const sortDir = filters.sortBy === 'oldest' || filters.sortBy === 'priority_low' || filters.sortBy === 'title_az' ? 'ASC' : 'DESC';
      sql += ` ORDER BY t.${sortCol} ${sortDir}`;

      // Count
      let countSql = `SELECT COUNT(*) as total FROM tickets t`;
      if (conditions.length) countSql += ' WHERE ' + conditions.join(' AND ');
      const countResult = await query(countSql);
      const count = (countResult.toObjects() as { total: number }[])[0]?.total || 0;
      setTotalCount(count);

      // Pagination
      const offset = (page - 1) * pageSize;
      sql += ` LIMIT ${pageSize} OFFSET ${offset}`;

      const result = await query(sql);
      const rows = result.toObjects() as unknown as Ticket[];

      // Client-side priority sort
      if (filters.sortBy === 'priority_high' || filters.sortBy === 'priority_low') {
        rows.sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] || 0;
          const pb = PRIORITY_ORDER[b.priority] || 0;
          return filters.sortBy === 'priority_high' ? pb - pa : pa - pb;
        });
      }

      setTickets(rows);
    } catch {
      setTickets([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [query, select, filters, page, pageSize]);

  useEffect(() => {
    fetchUsers();
    fetchCategories();
  }, [fetchUsers, fetchCategories]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.status) count++;
    if (filters.priority) count++;
    if (filters.category) count++;
    if (filters.assignedTo) count++;
    if (filters.search) count++;
    return count;
  }, [filters]);

  return {
    tickets,
    users,
    categories,
    totalCount,
    loading,
    page,
    setPage,
    pageSize,
    setPageSize,
    filters,
    setFilters,
    activeFilterCount,
    refresh: fetchTickets,
  };
}

export function useTicketDetail(ticketId: number | null) {
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const currentUser = useAppStore((s) => s.currentUser);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTicket = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const result = await query(`
        SELECT t.*,
          creator.name as creator_name, creator.avatar as creator_avatar,
          assignee.name as assignee_name, assignee.avatar as assignee_avatar
        FROM tickets t
        LEFT JOIN users creator ON t.created_by = creator.id
        LEFT JOIN users assignee ON t.assigned_to = assignee.id
        WHERE t.id = ${ticketId}
      `);
      const ticketObjs = result.toObjects() as unknown as Ticket[];
      setTicket(ticketObjs[0] || null);

      // Fetch comments
      const commentsResult = await query(`
        SELECT c.*, u.name as author_name, u.avatar as author_avatar
        FROM comments c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.ticket_id = ${ticketId}
        ORDER BY c.created_at ASC
      `);
      setComments(commentsResult.toObjects() as unknown as Comment[]);

      // Fetch activities
      const activitiesResult = await query(`
        SELECT a.*, u.name as user_name
        FROM activities a
        LEFT JOIN users u ON a.user_id = u.id
        WHERE a.ticket_id = ${ticketId}
        ORDER BY a.created_at DESC
      `);
      setActivities(activitiesResult.toObjects() as unknown as Activity[]);

      // Fetch all users for reassignment
      const usersResult = await query(`SELECT * FROM users ORDER BY name ASC`);
      setUsers(usersResult.toObjects() as unknown as User[]);
    } catch {
      setTicket(null);
      setComments([]);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [query, ticketId]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  const createTicket = useCallback(async (data: {
    title: string;
    description: string;
    priority: string;
    category: string;
    assigned_to: number | null;
  }) => {
    await insert('tickets', {
      title: data.title,
      description: data.description,
      priority: data.priority,
      category: data.category,
      assigned_to: data.assigned_to,
      status: 'open',
      created_by: currentUser?.id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Add activity
    const ticketResult = await query(`SELECT id FROM tickets ORDER BY id DESC LIMIT 1`);
    const ticketObjs = ticketResult.toObjects() as unknown as { id: number }[];
    const newTicketId = ticketObjs[0]?.id;

    if (newTicketId && currentUser) {
      await insert('activities', {
        ticket_id: newTicketId,
        user_id: currentUser.id,
        action: 'Ticket created',
        created_at: new Date().toISOString(),
      });
    }

    return newTicketId;
  }, [insert, query, currentUser]);

  const updateTicket = useCallback(async (id: number, data: Record<string, unknown>) => {
    await update('tickets', {
      ...data,
      updated_at: new Date().toISOString(),
    }, { id });

    if (data.status && currentUser) {
      await insert('activities', {
        ticket_id: id,
        user_id: currentUser.id,
        action: `Status changed to ${data.status}`,
        created_at: new Date().toISOString(),
      });
    }
  }, [update, insert, currentUser]);

  const deleteTicket = useCallback(async (id: number) => {
    // Delete comments and activities first
    const client = useAppStore.getState().client;
    if (client) {
      await client.transaction(async (trx) => {
        await trx.deleteFrom('comments', { ticket_id: id });
        await trx.deleteFrom('activities', { ticket_id: id });
        await trx.deleteFrom('tickets', { id });
      });
    } else {
      await deleteFrom('comments', { ticket_id: id });
      await deleteFrom('activities', { ticket_id: id });
      await deleteFrom('tickets', { id });
    }
  }, [deleteFrom]);

  const addComment = useCallback(async (content: string) => {
    if (!ticketId || !currentUser) return;
    await insert('comments', {
      ticket_id: ticketId,
      user_id: currentUser.id,
      content,
      created_at: new Date().toISOString(),
    });
    await insert('activities', {
      ticket_id: ticketId,
      user_id: currentUser.id,
      action: 'Added a comment',
      created_at: new Date().toISOString(),
    });
    await fetchTicket();
  }, [insert, ticketId, currentUser, fetchTicket]);

  const changeStatus = useCallback(async (newStatus: string) => {
    if (!ticketId) return;
    await update('tickets', {
      status: newStatus,
      updated_at: new Date().toISOString(),
    }, { id: ticketId });
    if (currentUser) {
      await insert('activities', {
        ticket_id: ticketId,
        user_id: currentUser.id,
        action: `Status changed to ${newStatus}`,
        created_at: new Date().toISOString(),
      });
    }
    await fetchTicket();
  }, [update, insert, ticketId, currentUser, fetchTicket]);

  const reassign = useCallback(async (newAssigneeId: number | null, newAssigneeName: string) => {
    if (!ticketId) return;
    await update('tickets', {
      assigned_to: newAssigneeId,
      updated_at: new Date().toISOString(),
    }, { id: ticketId });
    if (currentUser) {
      await insert('activities', {
        ticket_id: ticketId,
        user_id: currentUser.id,
        action: `Reassigned to ${newAssigneeName || 'Unassigned'}`,
        created_at: new Date().toISOString(),
      });
    }
    await fetchTicket();
  }, [update, insert, ticketId, currentUser, fetchTicket]);

  return {
    ticket,
    comments,
    activities,
    users,
    loading,
    refresh: fetchTicket,
    createTicket,
    updateTicket,
    deleteTicket,
    addComment,
    changeStatus,
    reassign,
  };
}
