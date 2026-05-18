import { create } from 'zustand';
import {
  vedaQuery,
  vedaInsert,
  vedaExec,
  vedaTestConnection,
  setApiBase,
  setApiKey,
  getConnectionStatus,
  toObjects,
  type QueryResult,
} from './vedadb-api';
import { Role, type Permission, hasPermission, hasRoleLevel } from './rbac';

/* ------------------------------------------------------------------ */
/*  NotificationItem type (used by NotificationCenter)                 */
/* ------------------------------------------------------------------ */

export interface NotificationItem {
  id: string;
  type: 'ticket' | 'status' | 'mention' | 'system';
  message: string;
  read: boolean;
  created_at: string;
  link?: string;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  department_id: number;
  department_name?: string;
  phone?: string;
  avatar?: string;
  is_active: number;
  created_at: string;
}

export interface Ticket {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  ticket_type: string;
  created_by: number;
  assigned_to: number | null;
  department_id: number;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
  assignee_name?: string;
  requester_name?: string;
}

export interface Category {
  id: number;
  name: string;
  description: string;
}

export interface KBArticle {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string;
  views: number;
  author_id: number;
  author_name?: string;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: number;
  ticket_id: number;
  user_id: number;
  user_name?: string;
  content: string;
  created_at: string;
}

export interface Activity {
  id: number;
  ticket_id: number;
  user_id: number;
  user_name?: string;
  action: string;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

/* Backward-compatible QueryResult wrapper */
interface QueryableResult {
  columns: string[];
  rows: string[][];
  rowCount: number;
  message: string;
  toObjects: () => Record<string, string>[];
  first: () => Record<string, string> | null;
}

function wrapResult(result: QueryResult): QueryableResult {
  return {
    ...result,
    toObjects: () => toObjects(result),
    first: () => {
      const objs = toObjects(result);
      return objs[0] || null;
    },
  };
}

interface AppState {
  // Auth
  currentUser: User | null;
  isAuthenticated: boolean;

  // Connection
  dbStatus: 'connecting' | 'connected' | 'disconnected';
  dbError: string | null;
  dbLatency: number;

  // Data (cached from real DB)
  tickets: Ticket[];
  users: User[];
  categories: Category[];
  articles: KBArticle[];
  comments: Comment[];
  activities: Activity[];
  departments: { id: number; name: string; color: string }[];

  // UI state
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;
  notifications: NotificationItem[];
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: number;

  // Backward-compat: direct DB access methods used by hooks
  query: (sql: string) => Promise<QueryableResult>;
  select: (table: string, options: {
    columns?: string[];
    where?: string;
    orderBy?: string;
    limit?: number;
    offset?: number;
  }) => Promise<QueryableResult>;
  insert: (table: string, values: Record<string, string | number | null>) => Promise<void>;
  update: (table: string, values: Record<string, string | number | null>, where: Record<string, number | string>) => Promise<void>;
  deleteFrom: (table: string, where: Record<string, number | string>) => Promise<void>;
  /** @deprecated No client in HTTP mode — returns null */
  client: null;

  // Actions
  initDB: () => Promise<void>;
  connect: (url?: string, apiKey?: string) => Promise<boolean>;

  // Auth
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;

  // RBAC
  hasPermission: (p: Permission) => boolean;
  hasRoleLevel: (minRole: Role) => boolean;

  // Tickets
  fetchTickets: () => Promise<void>;
  fetchTicketById: (id: number) => Promise<Ticket | null>;
  createTicket: (data: Partial<Ticket>) => Promise<void>;
  updateTicket: (id: number, data: Partial<Ticket>) => Promise<void>;
  deleteTicket: (id: number) => Promise<void>;
  rejectTicket: (id: number, reason: string, targetDept: number) => Promise<void>;

  // Comments
  fetchComments: (ticketId: number) => Promise<void>;
  addComment: (ticketId: number, content: string) => Promise<void>;

  // Activities
  fetchActivities: (ticketId: number) => Promise<void>;
  addActivity: (ticketId: number, action: string) => Promise<void>;

  // Users
  fetchUsers: () => Promise<void>;

  // Categories
  fetchCategories: () => Promise<void>;

  // Knowledge Base
  fetchArticles: () => Promise<void>;
  fetchArticleById: (id: number) => Promise<KBArticle | null>;
  createArticle: (data: Partial<KBArticle>) => Promise<void>;
  updateArticle: (id: number, data: Partial<KBArticle>) => Promise<void>;
  deleteArticle: (id: number) => Promise<void>;
}

const useAppStore = create<AppState>((set, get) => ({
  /* -------------------- State -------------------- */
  currentUser: null,
  isAuthenticated: false,
  dbStatus: 'connecting',
  dbError: null,
  dbLatency: 0,
  client: null,
  tickets: [],
  users: [],
  categories: [],
  articles: [],
  comments: [],
  activities: [],
  departments: [
    { id: 1, name: 'IT Support', color: '#1890ff' },
    { id: 2, name: 'HR', color: '#52c41a' },
    { id: 3, name: 'Finance', color: '#faad14' },
    { id: 4, name: 'Facilities', color: '#722ed1' },
    { id: 5, name: 'Sales', color: '#f5222d' },
  ],

  // UI state
  commandPaletteOpen: false,
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
  notifications: [],
  markNotificationRead: (id) => set((s) => ({
    notifications: s.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n
    ),
  })),
  markAllNotificationsRead: () => set((s) => ({
    notifications: s.notifications.map((n) => ({ ...n, read: true })),
  })),
  get unreadCount() {
    const s = get();
    return s.notifications.filter((n) => !n.read).length;
  },

  /* Backward-compat query methods used by hooks */
  query: async (sql: string) => {
    const result = await vedaQuery(sql);
    set({ dbLatency: getConnectionStatus().latency });
    return wrapResult(result);
  },

  select: async (table: string, options: {
    columns?: string[];
    where?: string;
    orderBy?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    let sql = `SELECT ${options.columns?.join(', ') || '*'} FROM ${table}`;
    if (options.where) sql += ` WHERE ${options.where}`;
    if (options.orderBy) sql += ` ORDER BY ${options.orderBy}`;
    if (options.limit) sql += ` LIMIT ${options.limit}`;
    if (options.offset) sql += ` OFFSET ${options.offset}`;
    const result = await vedaQuery(sql);
    return wrapResult(result);
  },

  insert: async (table: string, values: Record<string, string | number | null>) => {
    const strValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      strValues[k] = v === null || v === undefined ? '' : String(v);
    }
    await vedaInsert(table, strValues);
  },

  update: async (table: string, values: Record<string, string | number | null>, where: Record<string, number | string>) => {
    const whereClause = Object.entries(where)
      .map(([k, v]) => `${k} = ${typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v}`)
      .join(' AND ');
    const sets = Object.entries(values)
      .map(([k, v]) => `${k} = '${String(v === null || v === undefined ? '' : v).replace(/'/g, "''")}'`)
      .join(', ');
    await vedaExec(`UPDATE ${table} SET ${sets} WHERE ${whereClause}`);
  },

  deleteFrom: async (table: string, where: Record<string, number | string>) => {
    const whereClause = Object.entries(where)
      .map(([k, v]) => `${k} = ${typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v}`)
      .join(' AND ');
    await vedaExec(`DELETE FROM ${table} WHERE ${whereClause}`);
  },

  /* -------------------- Init -------------------- */
  initDB: async () => {
    set({ dbStatus: 'connecting', dbError: null });
    try {
      const ok = await vedaTestConnection();
      if (ok) {
        set({ dbStatus: 'connected' });
        // Load initial data
        await get().fetchTickets();
        await get().fetchUsers();
        await get().fetchCategories();
        await get().fetchArticles();
      } else {
        set({ dbStatus: 'disconnected', dbError: 'Cannot connect to VedaDB. Check API URL in Settings.' });
      }
    } catch (err: any) {
      set({ dbStatus: 'disconnected', dbError: err.message || 'Connection failed' });
    }
  },

  /* -------------------- Connect -------------------- */
  connect: async (url?: string, apiKey?: string) => {
    if (url) setApiBase(url);
    if (apiKey) setApiKey(apiKey);
    return await vedaTestConnection();
  },

  /* -------------------- Auth -------------------- */
  login: async (email: string, _password: string) => {
    try {
      const result = await vedaQuery(`SELECT * FROM users WHERE email = '${email}' AND is_active = 1`);
      const users = toObjects(result) as unknown as User[];
      if (users.length > 0) {
        const user = users[0];
        // Fetch department name
        if (user.department_id) {
          const deptResult = await vedaQuery(`SELECT name FROM departments WHERE id = ${user.department_id}`);
          const deptRow = toObjects(deptResult)[0];
          if (deptRow) user.department_name = deptRow.name;
        }
        set({ currentUser: user, isAuthenticated: true });
        // Log activity
        await vedaExec(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, created_at) VALUES (${user.id}, 'LOGIN', 'users', ${user.id}, datetime('now'))`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  logout: () => {
    const user = get().currentUser;
    if (user) {
      vedaExec(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, created_at) VALUES (${user.id}, 'LOGOUT', 'users', ${user.id}, datetime('now'))`).catch(() => {});
    }
    set({ currentUser: null, isAuthenticated: false, tickets: [], users: [], categories: [], articles: [], comments: [], activities: [] });
  },

  /* -------------------- RBAC -------------------- */
  hasPermission: (p: Permission) => {
    const user = get().currentUser;
    if (!user) return false;
    return hasPermission(user.role as Role, p);
  },
  hasRoleLevel: (minRole: Role) => {
    const user = get().currentUser;
    if (!user) return false;
    return hasRoleLevel(user.role as Role, minRole);
  },

  /* -------------------- Tickets -------------------- */
  fetchTickets: async () => {
    const user = get().currentUser;
    if (!user) return;

    let sql = `SELECT t.*, u.name as assignee_name, req.name as requester_name 
               FROM tickets t 
               LEFT JOIN users u ON t.assigned_to = u.id 
               LEFT JOIN users req ON t.created_by = req.id`;

    // Role-based filtering
    const role = user.role;
    if (role === 'customer') {
      sql += ` WHERE t.created_by = ${user.id}`;
    } else if (role === 'agent') {
      sql += ` WHERE t.department_id = ${user.department_id} OR t.assigned_to = ${user.id} OR t.created_by = ${user.id}`;
    }
    // admin/manager sees all

    sql += ` ORDER BY t.updated_at DESC`;

    try {
      const result = await vedaQuery(sql);
      set({ tickets: toObjects(result) as unknown as Ticket[] });
    } catch (err: any) {
      set({ dbError: err.message });
    }
  },

  fetchTicketById: async (id: number) => {
    try {
      const result = await vedaQuery(
        `SELECT t.*, u.name as assignee_name, req.name as requester_name 
         FROM tickets t 
         LEFT JOIN users u ON t.assigned_to = u.id 
         LEFT JOIN users req ON t.created_by = req.id 
         WHERE t.id = ${id}`
      );
      const rows = toObjects(result) as unknown as Ticket[];
      return rows[0] || null;
    } catch {
      return null;
    }
  },

  createTicket: async (data: Partial<Ticket>) => {
    const user = get().currentUser;
    if (!user) return;
    const cols = Object.keys(data).join(', ');
    const vals = Object.values(data).map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
    await vedaExec(`INSERT INTO tickets (${cols}, created_by, created_at, updated_at) VALUES (${vals}, ${user.id}, datetime('now'), datetime('now'))`);
    await get().fetchTickets();
  },

  updateTicket: async (id: number, data: Partial<Ticket>) => {
    const sets = Object.entries(data)
      .map(([k, v]) => `${k} = '${String(v).replace(/'/g, "''")}'`)
      .join(', ');
    await vedaExec(`UPDATE tickets SET ${sets}, updated_at = datetime('now') WHERE id = ${id}`);
    await get().fetchTickets();
  },

  deleteTicket: async (id: number) => {
    await vedaExec(`DELETE FROM tickets WHERE id = ${id}`);
    await vedaExec(`DELETE FROM comments WHERE ticket_id = ${id}`);
    await vedaExec(`DELETE FROM activities WHERE ticket_id = ${id}`);
    await get().fetchTickets();
  },

  /** REJECT TICKET — moves to another department */
  rejectTicket: async (id: number, reason: string, targetDept: number) => {
    const user = get().currentUser;
    if (!user) return;
    await vedaExec(
      `UPDATE tickets SET status = 'rejected', rejection_reason = '${reason.replace(/'/g, "''")}', department_id = ${targetDept}, assigned_to = NULL, updated_at = datetime('now') WHERE id = ${id}`
    );
    await vedaExec(
      `INSERT INTO activities (ticket_id, user_id, action, created_at) VALUES (${id}, ${user.id}, 'Ticket rejected: ${reason.replace(/'/g, "''")} → transferred to department ${targetDept}', datetime('now'))`
    );
    await get().fetchTickets();
    await get().fetchActivities(id);
  },

  /* -------------------- Comments -------------------- */
  fetchComments: async (ticketId: number) => {
    try {
      const result = await vedaQuery(
        `SELECT c.*, u.name as user_name FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.ticket_id = ${ticketId} ORDER BY c.created_at ASC`
      );
      set({ comments: toObjects(result) as unknown as Comment[] });
    } catch { /* */ }
  },

  addComment: async (ticketId: number, content: string) => {
    const user = get().currentUser;
    if (!user) return;
    await vedaExec(`INSERT INTO comments (ticket_id, user_id, content, created_at) VALUES (${ticketId}, ${user.id}, '${content.replace(/'/g, "''")}', datetime('now'))`);
    await get().fetchComments(ticketId);
  },

  /* -------------------- Activities -------------------- */
  fetchActivities: async (ticketId: number) => {
    try {
      const result = await vedaQuery(
        `SELECT a.*, u.name as user_name FROM activities a LEFT JOIN users u ON a.user_id = u.id WHERE a.ticket_id = ${ticketId} ORDER BY a.created_at DESC`
      );
      set({ activities: toObjects(result) as unknown as Activity[] });
    } catch { /* */ }
  },

  addActivity: async (ticketId: number, action: string) => {
    const user = get().currentUser;
    if (!user) return;
    await vedaExec(`INSERT INTO activities (ticket_id, user_id, action, created_at) VALUES (${ticketId}, ${user.id}, '${action.replace(/'/g, "''")}', datetime('now'))`);
  },

  /* -------------------- Users -------------------- */
  fetchUsers: async () => {
    try {
      const result = await vedaQuery(`SELECT u.*, d.name as department_name FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.name`);
      set({ users: toObjects(result) as unknown as User[] });
    } catch { /* */ }
  },

  /* -------------------- Categories -------------------- */
  fetchCategories: async () => {
    try {
      const result = await vedaQuery(`SELECT * FROM categories ORDER BY name`);
      set({ categories: toObjects(result) as unknown as Category[] });
    } catch { /* */ }
  },

  /* -------------------- Knowledge Base -------------------- */
  fetchArticles: async () => {
    try {
      const result = await vedaQuery(
        `SELECT a.*, u.name as author_name FROM knowledge_articles a LEFT JOIN users u ON a.author_id = u.id ORDER BY a.updated_at DESC`
      );
      set({ articles: toObjects(result) as unknown as KBArticle[] });
    } catch { /* */ }
  },

  fetchArticleById: async (id: number) => {
    try {
      await vedaExec(`UPDATE knowledge_articles SET views = views + 1 WHERE id = ${id}`);
      const result = await vedaQuery(
        `SELECT a.*, u.name as author_name FROM knowledge_articles a LEFT JOIN users u ON a.author_id = u.id WHERE a.id = ${id}`
      );
      const rows = toObjects(result) as unknown as KBArticle[];
      return rows[0] || null;
    } catch {
      return null;
    }
  },

  createArticle: async (data: Partial<KBArticle>) => {
    const user = get().currentUser;
    if (!user) return;
    const cols = Object.keys(data).join(', ');
    const vals = Object.values(data).map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
    await vedaExec(`INSERT INTO knowledge_articles (${cols}, author_id, views, created_at, updated_at) VALUES (${vals}, ${user.id}, 0, datetime('now'), datetime('now'))`);
    await get().fetchArticles();
  },

  updateArticle: async (id: number, data: Partial<KBArticle>) => {
    const sets = Object.entries(data)
      .map(([k, v]) => `${k} = '${String(v).replace(/'/g, "''")}'`)
      .join(', ');
    await vedaExec(`UPDATE knowledge_articles SET ${sets}, updated_at = datetime('now') WHERE id = ${id}`);
    await get().fetchArticles();
  },

  deleteArticle: async (id: number) => {
    await vedaExec(`DELETE FROM knowledge_articles WHERE id = ${id}`);
    await get().fetchArticles();
  },
}));

export default useAppStore;
