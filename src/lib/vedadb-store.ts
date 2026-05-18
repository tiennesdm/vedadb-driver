/**
 * Zustand store for global state management using VedaDB client.
 */
import { create } from 'zustand';
import type { VedaClient, Result } from './vedadb';
import { createClient } from './vedadb';
import { Role, Permission, hasPermission, hasRoleLevel } from './rbac';

interface NotificationItem {
  id: number;
  type: 'ticket' | 'status' | 'mention' | 'system';
  message: string;
  read: boolean;
  created_at: string;
}

interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: string;
  department?: string;
  department_id?: number;
  phone?: string;
  is_active?: boolean;
  avatar?: string;
}

interface AppState {
  // Auth
  currentUser: CurrentUser | null;
  isAuthenticated: boolean;

  // VedaDB
  client: VedaClient | null;
  dbStatus: 'connecting' | 'connected' | 'disconnected';
  dbLatency: number;

  // Notifications
  notifications: NotificationItem[];
  unreadCount: number;

  // Command palette
  commandPaletteOpen: boolean;

  // Actions
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  initDB: () => Promise<void>;
  setDbStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  setDbLatency: (latency: number) => void;
  addNotification: (item: Omit<NotificationItem, 'id' | 'read'>) => void;
  markNotificationRead: (id: number) => void;
  markAllNotificationsRead: () => void;
  setCommandPaletteOpen: (open: boolean) => void;

  // RBAC helpers
  hasPermission: (permission: Permission) => boolean;
  hasRoleLevel: (minRole: Role) => boolean;

  // Data helpers
  query: (sql: string) => Promise<Result>;
  select: (table: string, options?: Parameters<VedaClient['select']>[1]) => Promise<Result>;
  insert: (table: string, data: Record<string, unknown>) => Promise<Result>;
  update: (table: string, set: Record<string, unknown>, where: Record<string, unknown>) => Promise<Result>;
  deleteFrom: (table: string, where: Record<string, unknown>) => Promise<Result>;
}

const useAppStore = create<AppState>((set, get) => ({
  currentUser: null,
  isAuthenticated: false,
  client: null,
  dbStatus: 'connecting',
  dbLatency: 0,
  notifications: [
    { id: 1, type: 'ticket', message: 'New ticket #1 assigned to you: "Laptop not powering on after update"', read: false, created_at: '2024-12-04T09:30:00Z' },
    { id: 2, type: 'status', message: 'Ticket #3 status changed to Resolved', read: false, created_at: '2024-12-04T08:00:00Z' },
    { id: 3, type: 'mention', message: 'Sarah Chen mentioned you in ticket #7', read: true, created_at: '2024-12-03T16:00:00Z' },
    { id: 4, type: 'system', message: 'System maintenance scheduled for Dec 8, 2024 at 02:00 UTC', read: true, created_at: '2024-12-03T12:00:00Z' },
  ],
  unreadCount: 2,
  commandPaletteOpen: false,

  login: async (email: string, _password: string) => {
    const state = get();
    if (!state.client) return false;

    const result = await state.client.select('users', { where: { email } });
    const users = result.toObjects();
    if (users.length === 0) return false;

    const user = users[0];
    const userData: CurrentUser = {
      id: user.id as number,
      name: user.name as string,
      email: user.email as string,
      role: user.role as string,
      department: (user.department as string) || undefined,
      department_id: (user.department_id as number) || undefined,
      phone: (user.phone as string) || undefined,
      is_active: (user.is_active as boolean) ?? undefined,
      avatar: (user.avatar as string) || undefined,
    };

    set({ currentUser: userData, isAuthenticated: true });
    localStorage.setItem('vedadesk_user', JSON.stringify(userData));
    return true;
  },

  logout: () => {
    localStorage.removeItem('vedadesk_user');
    set({ currentUser: null, isAuthenticated: false });
  },

  initDB: async () => {
    const client = createClient();
    set({ client, dbStatus: 'connecting' });
    await client._connect();
    set({ dbStatus: 'connected', dbLatency: client._connectionInfo.latency });

    // Check for existing session
    const savedUser = localStorage.getItem('vedadesk_user');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        set({ currentUser: userData, isAuthenticated: true });
      } catch { /* ignore */ }
    }
  },

  setDbStatus: (status) => set({ dbStatus: status }),
  setDbLatency: (latency) => set({ dbLatency: latency }),

  addNotification: (item) => {
    const state = get();
    const newItem: NotificationItem = { ...item, id: Date.now(), read: false };
    set({
      notifications: [newItem, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    });
  },

  markNotificationRead: (id) => {
    const state = get();
    const notifications = state.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n
    );
    const unreadCount = notifications.filter((n) => !n.read).length;
    set({ notifications, unreadCount });
  },

  markAllNotificationsRead: () => {
    const state = get();
    const notifications = state.notifications.map((n) => ({ ...n, read: true }));
    set({ notifications, unreadCount: 0 });
  },

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  hasPermission: (permission: Permission) => {
    const state = get();
    if (!state.currentUser?.role) return false;
    const role = Object.values(Role).find((r) => r === state.currentUser!.role);
    if (!role) return false;
    return hasPermission(role, permission);
  },

  hasRoleLevel: (minRole: Role) => {
    const state = get();
    if (!state.currentUser?.role) return false;
    const role = Object.values(Role).find((r) => r === state.currentUser!.role);
    if (!role) return false;
    return hasRoleLevel(role, minRole);
  },

  query: async (sql: string) => {
    const state = get();
    if (!state.client) throw new Error('DB not initialized');
    return state.client.query(sql);
  },

  select: async (table, options) => {
    const state = get();
    if (!state.client) throw new Error('DB not initialized');
    return state.client.select(table, options);
  },

  insert: async (table, data) => {
    const state = get();
    if (!state.client) throw new Error('DB not initialized');
    return state.client.insert(table, data);
  },

  update: async (table, setData, where) => {
    const state = get();
    if (!state.client) throw new Error('DB not initialized');
    return state.client.update(table, setData, where);
  },

  deleteFrom: async (table, where) => {
    const state = get();
    if (!state.client) throw new Error('DB not initialized');
    return state.client.deleteFrom(table, where);
  },
}));

export default useAppStore;
export type { NotificationItem, CurrentUser };
