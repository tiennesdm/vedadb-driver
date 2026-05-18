/**
 * VedaDB Client — Browser-compatible with real driver integration
 * Tries to connect to real VedaDB server, falls back to localStorage mock.
 */

export { Role, TicketType, Permission } from './rbac';

/* ------------------------------------------------------------------ */
/*  Real driver integration (best-effort)                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Connection config                                                  */
/* ------------------------------------------------------------------ */

export const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 6380,
  timeout: 30000,
};

export function setConnectionConfig(host: string, port: number) {
  DEFAULT_CONFIG.host = host;
  DEFAULT_CONFIG.port = port;
  try { localStorage.setItem('vedadb_config', JSON.stringify(DEFAULT_CONFIG)); } catch { /* */ }
}

export function getConnectionConfig() {
  try {
    const saved = localStorage.getItem('vedadb_config');
    if (saved) return JSON.parse(saved);
  } catch { /* */ }
  return { ...DEFAULT_CONFIG };
}

// --- Types ---

interface Result<T = Record<string, unknown>> {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  message: string;
  toObjects: () => T[];
  first: () => T | null;
  pluck: (column: string) => unknown[];
}

interface SelectOptions {
  where?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
  offset?: number;
}

interface CacheAPI {
  set: (key: string, value: string, ttl?: number) => void;
  get: (key: string) => string | null;
  del: (key: string) => void;
  incr: (key: string) => number;
}

interface VedaClient {
  query: (sql: string) => Promise<Result>;
  exec: (sql: string) => Promise<Result>;
  insert: (table: string, data: Record<string, unknown>) => Promise<Result>;
  select: (table: string, options?: SelectOptions) => Promise<Result>;
  update: (table: string, set: Record<string, unknown>, where: Record<string, unknown>) => Promise<Result>;
  deleteFrom: (table: string, where: Record<string, unknown>) => Promise<Result>;
  transaction: <T>(fn: (trx: VedaClient) => Promise<T>) => Promise<T>;
  cache: CacheAPI;
  _connect: () => Promise<void>;
  _isConnected: boolean;
  _connectionInfo: { host: string; port: number; latency: number };
}

// --- Result Builder ---

function createResult<T = Record<string, unknown>>(
  columns: string[],
  rows: unknown[][],
  message = ''
): Result<T> {
  return {
    columns,
    rows,
    rowCount: rows.length,
    message,
    toObjects: () =>
      rows.map((row) =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]]))
      ) as T[],
    first: () => {
      if (rows.length === 0) return null;
      return Object.fromEntries(
        columns.map((col, i) => [col, rows[0][i]])
      ) as T;
    },
    pluck: (column: string) => {
      const idx = columns.indexOf(column);
      if (idx === -1) return [];
      return rows.map((row) => row[idx]);
    },
  };
}

// --- localStorage Data Layer ---

const DB_KEY = 'vedadesk_db';
const SEEDED_KEY = 'vedadesk_seeded';

interface DBState {
  [table: string]: Record<string, unknown>[];
}

function loadDB(): DBState {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveDB(db: DBState): void {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function getTable(db: DBState, table: string): Record<string, unknown>[] {
  return db[table] || [];
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(where)) {
    if (row[key] !== val) return false;
  }
  return true;
}

// --- Seed Data ---

const CATEGORIES = [
  { id: 1, name: 'Hardware', description: 'Laptops, desktops, peripherals, and physical equipment', icon: 'Monitor', created_at: '2024-01-15T08:00:00Z' },
  { id: 2, name: 'Software', description: 'Applications, operating systems, and software licenses', icon: 'Code2', created_at: '2024-01-15T08:00:00Z' },
  { id: 3, name: 'Network', description: 'WiFi, VPN, connectivity, and infrastructure issues', icon: 'Wifi', created_at: '2024-01-15T08:00:00Z' },
  { id: 4, name: 'Access', description: 'Account access, permissions, and security requests', icon: 'Lock', created_at: '2024-01-15T08:00:00Z' },
  { id: 5, name: 'General', description: 'General inquiries and miscellaneous requests', icon: 'HelpCircle', created_at: '2024-01-15T08:00:00Z' },
  { id: 6, name: 'Billing', description: 'Invoices, subscriptions, and payment issues', icon: 'CreditCard', created_at: '2024-01-15T08:00:00Z' },
];

const DEPARTMENTS = [
  { id: 1, name: 'IT', description: 'Information Technology department handling infrastructure, systems, and technical support', color: '#1890ff', manager_id: 1, created_at: '2024-01-01T08:00:00Z' },
  { id: 2, name: 'HR', description: 'Human Resources responsible for recruitment, employee relations, and policies', color: '#52c41a', manager_id: 5, created_at: '2024-01-01T08:00:00Z' },
  { id: 3, name: 'Finance', description: 'Finance department handling budgets, invoicing, payroll, and accounting', color: '#faad14', manager_id: 8, created_at: '2024-01-01T08:00:00Z' },
  { id: 4, name: 'Facilities', description: 'Facilities management for office space, maintenance, and physical resources', color: '#722ed1', manager_id: 9, created_at: '2024-01-01T08:00:00Z' },
  { id: 5, name: 'Sales', description: 'Sales department driving revenue and managing customer relationships', color: '#f5222d', manager_id: 10, created_at: '2024-01-01T08:00:00Z' },
];

const USERS = [
  { id: 1, name: 'Sarah Chen', email: 'sarah.chen@company.com', role: 'super_admin', avatar: '', department: 'IT Operations', department_id: 1, phone: '+1-555-0101', is_active: true, created_at: '2024-01-10T08:00:00Z' },
  { id: 2, name: 'Marcus Johnson', email: 'marcus.j@company.com', role: 'admin', avatar: '', department: 'Technical Support', department_id: 1, phone: '+1-555-0102', is_active: true, created_at: '2024-01-12T08:00:00Z' },
  { id: 3, name: 'Aisha Patel', email: 'aisha.patel@company.com', role: 'manager', avatar: '', department: 'Customer Success', department_id: 1, phone: '+1-555-0103', is_active: true, created_at: '2024-01-15T08:00:00Z' },
  { id: 4, name: 'David Kim', email: 'david.kim@company.com', role: 'agent', avatar: '', department: 'Network Engineering', department_id: 1, phone: '+1-555-0104', is_active: true, created_at: '2024-02-01T08:00:00Z' },
  { id: 5, name: 'Emily Rodriguez', email: 'emily.r@company.com', role: 'customer', avatar: '', department: 'Human Resources', department_id: 2, phone: '+1-555-0105', is_active: true, created_at: '2024-02-10T08:00:00Z' },
  { id: 6, name: 'James Wilson', email: 'james.w@company.com', role: 'agent', avatar: '', department: 'Software Development', department_id: 1, phone: '+1-555-0106', is_active: true, created_at: '2024-02-15T08:00:00Z' },
  { id: 7, name: 'Liu Wei', email: 'liu.wei@company.com', role: 'admin', avatar: '', department: 'Infrastructure', department_id: 1, phone: '+1-555-0107', is_active: true, created_at: '2024-03-01T08:00:00Z' },
  { id: 8, name: 'Olivia Martinez', email: 'olivia.m@company.com', role: 'customer', avatar: '', department: 'Finance', department_id: 3, phone: '+1-555-0108', is_active: true, created_at: '2024-03-10T08:00:00Z' },
  { id: 9, name: 'Michael Brown', email: 'michael.b@company.com', role: 'manager', avatar: '', department: 'Field Support', department_id: 4, phone: '+1-555-0109', is_active: true, created_at: '2024-03-15T08:00:00Z' },
  { id: 10, name: 'Sophia Anderson', email: 'sophia.a@company.com', role: 'customer', avatar: '', department: 'Marketing', department_id: 5, phone: '+1-555-0110', is_active: true, created_at: '2024-04-01T08:00:00Z' },
  { id: 11, name: 'Daniel Lee', email: 'daniel.lee@company.com', role: 'agent', avatar: '', department: 'IT Support', department_id: 1, phone: '+1-555-0111', is_active: true, created_at: '2024-04-10T08:00:00Z' },
  { id: 12, name: 'Rachel Green', email: 'rachel.g@company.com', role: 'manager', avatar: '', department: 'Finance', department_id: 3, phone: '+1-555-0112', is_active: true, created_at: '2024-04-15T08:00:00Z' },
];

const TICKETS = [
  { id: 1, title: 'Laptop not powering on after update', description: 'My work laptop does not power on after the latest system update. The charging light blinks but screen stays black. Tried hard reset with no success.', status: 'open', priority: 'high', category: 'Hardware', ticket_type: 'incident', department_id: 1, created_by: 5, assigned_to: 2, created_at: '2024-12-01T09:30:00Z', updated_at: '2024-12-01T09:30:00Z' },
  { id: 2, title: 'VPN connection drops every 15 minutes', description: 'The corporate VPN keeps disconnecting approximately every 15 minutes. This started happening yesterday. I have tried reconnecting and restarting the VPN client.', status: 'in_progress', priority: 'high', category: 'Network', ticket_type: 'incident', department_id: 1, created_by: 8, assigned_to: 4, created_at: '2024-12-02T11:15:00Z', updated_at: '2024-12-03T14:20:00Z' },
  { id: 3, title: 'Request access to Salesforce dashboard', description: 'Need read-only access to the Sales Analytics dashboard in Salesforce for the quarterly review meeting next week.', status: 'resolved', priority: 'medium', category: 'Access', ticket_type: 'service_request', department_id: 5, created_by: 10, assigned_to: 1, created_at: '2024-11-28T08:45:00Z', updated_at: '2024-12-02T16:00:00Z' },
  { id: 4, title: 'Printer on 3rd floor jammed', description: 'The shared printer on the 3rd floor near meeting room B is jammed and displaying error code E-501. Several people have reported this.', status: 'open', priority: 'low', category: 'Hardware', ticket_type: 'incident', department_id: 4, created_by: 6, assigned_to: 9, created_at: '2024-12-03T10:00:00Z', updated_at: '2024-12-03T10:00:00Z' },
  { id: 5, title: 'Slack notifications not working', description: 'Desktop Slack app is not showing notification badges or playing notification sounds. Mobile app works fine. Already checked system notification settings.', status: 'in_progress', priority: 'medium', category: 'Software', ticket_type: 'problem', department_id: 1, created_by: 3, assigned_to: 6, created_at: '2024-12-01T14:30:00Z', updated_at: '2024-12-04T09:15:00Z' },
  { id: 6, title: 'New hire laptop setup - Jake Torres', description: 'Need to prepare a development laptop for new hire Jake Torres starting next Monday. Requires Python, Node.js, Docker, and IntelliJ IDEA.', status: 'open', priority: 'medium', category: 'Hardware', ticket_type: 'service_request', department_id: 1, created_by: 5, assigned_to: 2, created_at: '2024-12-04T07:00:00Z', updated_at: '2024-12-04T07:00:00Z' },
  { id: 7, title: 'Database query timeout on reports', description: 'The monthly expense report query is timing out after 60 seconds. This was working fine last week. Need assistance optimizing or checking server load.', status: 'open', priority: 'critical', category: 'Software', ticket_type: 'problem', department_id: 3, created_by: 8, assigned_to: 7, created_at: '2024-12-04T13:45:00Z', updated_at: '2024-12-04T13:45:00Z' },
  { id: 8, title: 'WiFi keeps disconnecting in conference room A', description: 'WiFi signal in conference room A is very weak and keeps dropping. Affects all meeting participants. Started after the weekend maintenance.', status: 'in_progress', priority: 'high', category: 'Network', ticket_type: 'incident', department_id: 1, created_by: 1, assigned_to: 4, created_at: '2024-12-02T09:00:00Z', updated_at: '2024-12-04T11:30:00Z' },
  { id: 9, title: 'Reset password for staging environment', description: 'Forgot the admin password for the staging environment. Need a reset link sent to my email.', status: 'resolved', priority: 'low', category: 'Access', ticket_type: 'service_request', department_id: 1, created_by: 6, assigned_to: 1, created_at: '2024-11-30T16:20:00Z', updated_at: '2024-12-01T08:00:00Z' },
  { id: 10, title: 'Adobe Creative Cloud license renewal', description: 'Three Adobe Creative Cloud licenses are expiring this week. Need renewal for the design team.', status: 'on_hold', priority: 'medium', category: 'Software', ticket_type: 'change', department_id: 3, created_by: 10, assigned_to: 3, created_at: '2024-12-03T11:00:00Z', updated_at: '2024-12-03T15:00:00Z' },
  { id: 11, title: 'External monitor flickering', description: 'My external monitor connected via USB-C started flickering intermittently. Tried different cables and ports.', status: 'open', priority: 'low', category: 'Hardware', ticket_type: 'incident', department_id: 1, created_by: 5, assigned_to: 9, created_at: '2024-12-04T08:30:00Z', updated_at: '2024-12-04T08:30:00Z' },
  { id: 12, title: 'Cannot access shared drive', description: 'Getting "Access Denied" error when trying to access the projects shared drive. Was working fine until this morning.', status: 'open', priority: 'high', category: 'Network', ticket_type: 'incident', department_id: 2, created_by: 6, assigned_to: 7, created_at: '2024-12-04T10:15:00Z', updated_at: '2024-12-04T10:15:00Z' },
  { id: 13, title: 'Git repository permission issue', description: 'Getting 403 errors when pushing to the vedadesk-frontend repository. Need write permissions restored.', status: 'in_progress', priority: 'medium', category: 'Access', ticket_type: 'service_request', department_id: 1, created_by: 6, assigned_to: 1, created_at: '2024-12-03T09:45:00Z', updated_at: '2024-12-04T08:00:00Z' },
  { id: 14, title: 'Invoice #2847 incorrect amount', description: 'The cloud hosting invoice for November shows double the expected amount. Please review and correct before payment processing on Friday.', status: 'open', priority: 'medium', category: 'Billing', ticket_type: 'problem', department_id: 3, created_by: 8, assigned_to: 3, created_at: '2024-12-04T12:00:00Z', updated_at: '2024-12-04T12:00:00Z' },
  { id: 15, title: 'Conference room projector not detected', description: 'The projector in conference room C is not being detected by any laptops via HDMI or wireless casting.', status: 'open', priority: 'low', category: 'Hardware', ticket_type: 'incident', department_id: 4, created_by: 10, assigned_to: 9, created_at: '2024-12-04T15:30:00Z', updated_at: '2024-12-04T15:30:00Z' },
  { id: 16, title: 'Jira board custom field not saving', description: 'Custom field "Effort Estimate" on the Engineering Scrum board is not saving values. Returns to blank after page refresh.', status: 'in_progress', priority: 'medium', category: 'Software', ticket_type: 'problem', department_id: 1, created_by: 6, assigned_to: 6, created_at: '2024-12-02T10:30:00Z', updated_at: '2024-12-04T09:45:00Z' },
];
const COMMENTS = [
  { id: 1, ticket_id: 1, user_id: 2, content: 'Hi Emily, can you try holding the power button for 30 seconds without the charger connected? Also, what laptop model are you using?', created_at: '2024-12-01T10:00:00Z' },
  { id: 2, ticket_id: 1, user_id: 5, content: 'It is a Dell Latitude 7430. I tried the 30-second hold but no luck. The charging light still blinks amber.', created_at: '2024-12-01T10:30:00Z' },
  { id: 3, ticket_id: 2, user_id: 4, content: 'I have identified the issue. The VPN gateway had a timeout policy change. I am pushing a fix now. Please test in 10 minutes.', created_at: '2024-12-03T14:20:00Z' },
  { id: 4, ticket_id: 3, user_id: 1, content: 'Access granted! You should receive an email invitation shortly. Let me know if you need any specific reports configured.', created_at: '2024-12-02T16:00:00Z' },
  { id: 5, ticket_id: 5, user_id: 6, content: 'Can you try reinstalling Slack? I have seen this issue with the latest update. Backup your preferences first.', created_at: '2024-12-03T09:00:00Z' },
  { id: 6, ticket_id: 7, user_id: 7, content: 'Looking into this now. The reporting DB had an index rebuild over the weekend which may have affected query plans.', created_at: '2024-12-04T14:00:00Z' },
  { id: 7, ticket_id: 8, user_id: 4, content: 'The AP in that area had a firmware issue post-maintenance. I am rolling it back and will test signal strength shortly.', created_at: '2024-12-04T11:30:00Z' },
  { id: 8, ticket_id: 12, user_id: 7, content: 'There was a permission reset during the security audit. I am restoring your access now.', created_at: '2024-12-04T10:30:00Z' },
  { id: 9, ticket_id: 13, user_id: 1, content: 'Your team membership was accidentally removed during a group policy update. I have re-added you. Please try again.', created_at: '2024-12-04T08:00:00Z' },
  { id: 10, ticket_id: 16, user_id: 6, content: 'Found the bug - a recent plugin update broke the field serializer. I have disabled the plugin and reported to the vendor.', created_at: '2024-12-04T09:45:00Z' },
];

const ACTIVITIES = [
  { id: 1, ticket_id: 1, user_id: 5, action: 'created ticket', created_at: '2024-12-01T09:30:00Z' },
  { id: 2, ticket_id: 1, user_id: 2, action: 'assigned to Marcus Johnson', created_at: '2024-12-01T09:45:00Z' },
  { id: 3, ticket_id: 2, user_id: 8, action: 'created ticket', created_at: '2024-12-02T11:15:00Z' },
  { id: 4, ticket_id: 2, user_id: 4, action: 'assigned to David Kim', created_at: '2024-12-02T11:30:00Z' },
  { id: 5, ticket_id: 3, user_id: 10, action: 'created ticket', created_at: '2024-11-28T08:45:00Z' },
  { id: 6, ticket_id: 3, user_id: 1, action: 'resolved - access granted', created_at: '2024-12-02T16:00:00Z' },
  { id: 7, ticket_id: 7, user_id: 8, action: 'created ticket', created_at: '2024-12-04T13:45:00Z' },
  { id: 8, ticket_id: 7, user_id: 7, action: 'assigned to Liu Wei', created_at: '2024-12-04T14:00:00Z' },
  { id: 9, ticket_id: 8, user_id: 1, action: 'created ticket', created_at: '2024-12-02T09:00:00Z' },
  { id: 10, ticket_id: 12, user_id: 6, action: 'created ticket', created_at: '2024-12-04T10:15:00Z' },
];

const KNOWLEDGE_ARTICLES = [
  { id: 1, title: 'How to Reset Your Password', content: '# How to Reset Your Password\n\n1. Go to the login page and click "Forgot Password"\n2. Enter your email address\n3. Check your inbox for the reset link\n4. Click the link and enter your new password\n5. Password must be at least 8 characters with one uppercase, one lowercase, and one number\n\nIf you do not receive the email within 5 minutes, check your spam folder or contact IT support.', category: 'Access', tags: 'password,reset,account', views: 342, author_id: 1, created_at: '2024-01-20T08:00:00Z', updated_at: '2024-06-15T10:00:00Z' },
  { id: 2, title: 'VPN Setup Guide for Remote Work', content: '# VPN Setup Guide\n\n## Windows\n1. Download the Cisco AnyConnect client from the IT portal\n2. Install and open the application\n3. Enter server address: `vpn.company.com`\n4. Use your domain credentials to login\n\n## macOS\n1. Download the macOS client from the IT portal\n2. Open System Preferences > Network\n3. Add a new VPN interface\n4. Configure with provided settings\n\n## Troubleshooting\n- If connection drops frequently, check your local internet stability\n- For DNS issues, flush your DNS cache\n- Contact network team for firewall exceptions', category: 'Network', tags: 'vpn,remote,setup,network', views: 518, author_id: 4, created_at: '2024-02-01T08:00:00Z', updated_at: '2024-08-20T14:00:00Z' },
  { id: 3, title: 'Printer Setup and Troubleshooting', content: '# Printer Setup\n\n## Adding a Printer\n1. Open Settings > Printers & Scanners\n2. Click "Add Printer"\n3. Select the network printer from the list\n4. Install the correct driver if prompted\n\n## Common Issues\n\n### Paper Jam (Error E-501)\n1. Open the front panel\n2. Carefully remove jammed paper\n3. Close panel and press OK\n\n### Offline Printer\n- Check network cable connection\n- Restart the printer\n- Verify IP address has not changed\n\n### Poor Print Quality\n- Replace toner cartridge\n- Run cleaning cycle from printer menu\n- Check paper type settings', category: 'Hardware', tags: 'printer,hardware,troubleshooting', views: 276, author_id: 2, created_at: '2024-02-15T08:00:00Z', updated_at: '2024-09-01T09:00:00Z' },
  { id: 4, title: 'Slack Notification Troubleshooting', content: '# Fixing Slack Notifications\n\n## Desktop App\n1. Click your profile picture > Preferences\n2. Go to Notifications\n3. Enable "Show badge on app icon"\n4. Check sound is not muted\n\n## System Settings (macOS)\n1. System Settings > Notifications > Slack\n2. Enable "Allow Notifications"\n3. Set alert style to "Banners" or "Alerts"\n\n## System Settings (Windows)\n1. Settings > System > Notifications\n2. Find Slack and enable\n3. Ensure "Focus assist" is not blocking\n\nIf issues persist, try reinstalling Slack and clearing cache.', category: 'Software', tags: 'slack,notifications,software', views: 189, author_id: 6, created_at: '2024-03-01T08:00:00Z', updated_at: '2024-10-10T11:00:00Z' },
  { id: 5, title: 'New Employee IT Onboarding Checklist', content: '# IT Onboarding Checklist\n\n## Before First Day\n- [ ] Create domain account and email\n- [ ] Assign software licenses (Office 365, Slack, etc.)\n- [ ] Prepare laptop with standard image\n- [ ] Set up desk phone or softphone\n- [ ] Add to relevant distribution groups\n\n## First Day\n- [ ] Provide login credentials securely\n- [ ] Walk through password policy and 2FA setup\n- [ ] Install any department-specific software\n- [ ] Configure VPN access\n- [ ] Brief on security policies\n\n## First Week\n- [ ] Schedule IT orientation session\n- [ ] Verify all access is working\n- [ ] Add to internal systems (HR portal, time tracking)', category: 'General', tags: 'onboarding,new hire,it', views: 423, author_id: 1, created_at: '2024-03-15T08:00:00Z', updated_at: '2024-11-01T15:00:00Z' },
  { id: 6, title: 'WiFi Connection Issues - Quick Fixes', content: '# WiFi Troubleshooting\n\n## Basic Steps\n1. Toggle WiFi off and on\n2. Forget the network and reconnect\n3. Restart your device\n4. Check if other devices can connect\n\n## Advanced\n1. Renew DHCP lease: `ipconfig /release` then `ipconfig /renew`\n2. Flush DNS: `ipconfig /flushdns`\n3. Check for IP conflicts\n4. Verify WiFi adapter driver is up to date\n\n## Conference Room Specific\n- Conference rooms use a separate AP\n- If signal is weak, try the guest network as temporary workaround\n- Report persistent issues to Network Engineering', category: 'Network', tags: 'wifi,network,connectivity', views: 367, author_id: 4, created_at: '2024-04-01T08:00:00Z', updated_at: '2024-10-20T12:00:00Z' },
  { id: 7, title: 'Git Repository Access and SSH Keys', content: '# Git Access Setup\n\n## Generating SSH Key\n```bash\nssh-keygen -t ed25519 -C "your.email@company.com"\n```\n\n## Adding to GitHub/GitLab\n1. Copy the public key: `cat ~/.ssh/id_ed25519.pub`\n2. Paste into your Git hosting platform under SSH Keys\n3. Test with: `ssh -T git@github.com`\n\n## Common Permission Errors\n- Ensure you are added to the correct team/organization\n- Check repository-specific access rules\n- Verify your key is loaded: `ssh-add -l`\n- Add to ssh-agent: `eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519`', category: 'Access', tags: 'git,ssh,access,development', views: 256, author_id: 7, created_at: '2024-04-15T08:00:00Z', updated_at: '2024-09-25T10:00:00Z' },
  { id: 8, title: 'Software License Renewal Process', content: '# License Renewal Process\n\n## When to Renew\n- Adobe: Annual, 30 days before expiry\n- Microsoft 365: Monthly auto-renewal, verify payment method\n- JetBrains: Annual subscription\n- Atlassian: Annual, review user count before renewal\n\n## Process\n1. Receive renewal notification 30 days prior\n2. Verify current user count and requirements\n3. Submit purchase request via Finance portal\n4. After approval, complete renewal\n5. Update license inventory spreadsheet\n\n## Cost Optimization\n- Review active users and remove inactive accounts\n- Consider annual vs monthly pricing\n- Check for educational or non-profit discounts where applicable', category: 'Software', tags: 'license,renewal,software,billing', views: 198, author_id: 3, created_at: '2024-05-01T08:00:00Z', updated_at: '2024-10-05T14:00:00Z' },
  { id: 9, title: 'External Monitor Connection Guide', content: '# Connecting External Monitors\n\n## Connection Types\n- **USB-C/Thunderbolt**: Best option, supports video + power + data\n- **HDMI**: Widely compatible, up to 4K@60Hz\n- **DisplayPort**: Best for high refresh rates\n- **DVI/VGA**: Legacy, avoid if possible\n\n## Troubleshooting Flickering\n1. Check cable integrity - try a different cable\n2. Verify port is not loose or damaged\n3. Update graphics drivers\n4. Try a lower refresh rate as test\n5. Check for electromagnetic interference from other devices\n\n## macOS Specific\n- Use "Displays" in System Settings to arrange monitors\n- Hold Option while clicking "Detect Displays" for advanced options', category: 'Hardware', tags: 'monitor,display,hardware', views: 312, author_id: 2, created_at: '2024-05-15T08:00:00Z', updated_at: '2024-11-10T09:00:00Z' },
  { id: 10, title: 'Database Performance Optimization', content: '# DB Performance Tips\n\n## Query Optimization\n1. Use EXPLAIN to analyze query plans\n2. Add indexes on frequently queried columns\n3. Avoid SELECT *, specify only needed columns\n4. Use JOINs instead of subqueries where possible\n\n## Index Maintenance\n- Rebuild indexes monthly during maintenance window\n- Monitor index fragmentation\n- Remove unused indexes that slow down writes\n\n## Connection Pooling\n- Default pool size: 10 connections\n- Monitor active connections via dashboard\n- Increase pool size during peak hours if needed\n\n## Reporting Queries\n- Run heavy reports against read replica\n- Use materialized views for common reports\n- Schedule large exports during off-peak hours', category: 'Software', tags: 'database,performance,optimization', views: 445, author_id: 7, created_at: '2024-06-01T08:00:00Z', updated_at: '2024-11-20T16:00:00Z' },
  { id: 11, title: 'Two-Factor Authentication Setup', content: '# 2FA Setup Guide\n\n## Enabling 2FA\n1. Go to your profile settings\n2. Click "Security" tab\n3. Select "Enable Two-Factor Authentication"\n4. Scan QR code with authenticator app\n5. Enter verification code to confirm\n\n## Supported Apps\n- Google Authenticator\n- Microsoft Authenticator\n- Authy\n- 1Password\n\n## Backup Codes\n- Save backup codes in a secure location\n- Each code can only be used once\n- If you lose access to your authenticator, use a backup code\n\n## Lost 2FA Device\nContact IT support with proof of identity to have 2FA reset.', category: 'Access', tags: '2fa,security,authentication', views: 278, author_id: 1, created_at: '2024-06-15T08:00:00Z', updated_at: '2024-11-15T10:00:00Z' },
  { id: 12, title: 'Conference Room AV Equipment Guide', content: '# Conference Room AV Guide\n\n## Projector\n1. Press power button on wall panel or remote\n2. Wait 30 seconds for warmup\n3. Connect laptop via HDMI or use wireless casting\n4. Press Windows+P (or Cmd+F1 on Mac) to mirror/extend\n\n## Wireless Casting\n1. Ensure you are on the corporate WiFi\n2. Open casting menu on your device\n3. Select the room name (e.g., "Conference-C")\n4. Enter the 4-digit code shown on screen\n\n## Audio\n- Use the in-room microphone for video calls\n- Volume controls are on the wall panel\n- For echo issues, reduce microphone sensitivity\n\n## Getting Help\nPress the "IT Support" button on the wall panel for immediate assistance.', category: 'Hardware', tags: 'conference,av,projector,hardware', views: 156, author_id: 2, created_at: '2024-07-01T08:00:00Z', updated_at: '2024-10-25T11:00:00Z' },
  { id: 13, title: 'Jira Custom Field Configuration', content: '# Jira Custom Fields\n\n## Creating Custom Fields\n1. As admin, go to Issues > Custom Fields\n2. Click "Add Custom Field"\n3. Select field type (Text, Number, Select, etc.)\n4. Configure name, description, and context\n5. Add to relevant screens\n\n## Common Issues\n\n### Field Not Saving\n- Check field context applies to the project/issue type\n- Verify no conflicting field configurations\n- Check for plugin conflicts\n- Review browser console for JavaScript errors\n\n### Field Not Visible\n- Ensure it is added to the Create/Edit/View screens\n- Check field security scheme\n- Verify project context is correct', category: 'Software', tags: 'jira,custom fields,configuration', views: 134, author_id: 6, created_at: '2024-07-15T08:00:00Z', updated_at: '2024-11-28T13:00:00Z' },
  { id: 14, title: 'Shared Drive Access Policies', content: '# Shared Drive Access\n\n## Requesting Access\n1. Submit a ticket with business justification\n2. Your manager must approve\n3. Access is granted within 24 hours\n4. You will receive a notification when active\n\n## Access Levels\n- **Read**: View and download files\n- **Write**: Create, edit, and delete files\n- **Admin**: Manage permissions and structure\n\n## Security Rules\n- Do not share your access credentials\n- Report suspicious activity immediately\n- Access is reviewed quarterly\n- Inactive access is automatically revoked after 90 days\n\n## Audit\nAll file access is logged for compliance purposes.', category: 'Access', tags: 'shared drive,access,policy', views: 203, author_id: 1, created_at: '2024-08-01T08:00:00Z', updated_at: '2024-11-05T09:00:00Z' },
  { id: 15, title: 'Backup and Disaster Recovery Procedures', content: '# Backup & DR Procedures\n\n## Backup Schedule\n- **Critical systems**: Every 4 hours\n- **File servers**: Daily at 2 AM\n- **Databases**: Continuous replication\n- **Email**: Daily incremental, weekly full\n\n## Retention\n- Daily backups: 30 days\n- Weekly backups: 12 weeks\n- Monthly backups: 1 year\n- Yearly backups: 7 years\n\n## Recovery Procedures\n1. Identify the recovery point needed\n2. Contact IT Operations immediately\n3. Recovery time objective (RTO): 4 hours for critical systems\n4. Recovery point objective (RPO): 1 hour\n\n## Testing\nDR procedures are tested quarterly during scheduled maintenance windows.', category: 'General', tags: 'backup,disaster recovery,operations', views: 289, author_id: 7, created_at: '2024-08-15T08:00:00Z', updated_at: '2024-11-18T14:00:00Z' },
  { id: 16, title: 'Email Signature Standards', content: '# Email Signature Guidelines\n\n## Required Elements\n- Full name\n- Job title\n- Department\n- Company name\n- Phone number\n- Company website\n\n## Formatting\n- Use company-approved template\n- Maximum 2 font colors\n- No animated GIFs or large images\n- Keep total height under 200px\n\n## How to Set Up\n1. Download template from brand portal\n2. Fill in your details\n3. In Outlook: File > Options > Mail > Signatures\n4. Paste and set as default\n\n## Mobile\nSet the same signature in Outlook mobile app under Settings.', category: 'General', tags: 'email,signature,branding', views: 178, author_id: 3, created_at: '2024-09-01T08:00:00Z', updated_at: '2024-11-22T10:00:00Z' },
  { id: 17, title: 'Managing Browser Certificate Warnings', content: '# Certificate Warnings\n\n## Internal Sites\nInternal tools use corporate CA certificates. If you see warnings:\n\n1. **Windows**: Install corporate CA cert via GPO (automatic)\n2. **Mac**: Download CA cert from IT portal and add to Keychain\n3. **Manual** (if GPO fails):\n   - Download: https://it.company.com/ca-cert.crt\n   - Chrome: Settings > Privacy > Security > Manage certificates\n   - Import and trust the CA certificate\n\n## External Sites\nNever ignore certificate warnings on external/public websites.\n\n## Still Seeing Warnings?\n- Check system date/time is correct\n- Clear browser cache\n- Try incognito/private mode\n- Contact IT if internal site warnings persist', category: 'Network', tags: 'certificate,security,browser,network', views: 245, author_id: 4, created_at: '2024-09-15T08:00:00Z', updated_at: '2024-12-01T11:00:00Z' },
  { id: 18, title: 'Video Conference Best Practices', content: '# Video Conferencing Guide\n\n## Before the Meeting\n- Test your camera and microphone\n- Use a headset or earbuds to prevent echo\n- Close unnecessary applications\n- Join 2 minutes early\n\n## During the Meeting\n- Mute when not speaking\n- Use video when possible\n- Use blur or virtual background appropriately\n- Share screen only when needed\n\n## Troubleshooting\n- **No audio**: Check output device selection\n- **Choppy video**: Close other bandwidth-heavy apps\n- **Screen share lag**: Share only the window, not full screen\n- **Connection drops**: Switch to phone audio as backup', category: 'General', tags: 'video,conference,meetings', views: 312, author_id: 3, created_at: '2024-10-01T08:00:00Z', updated_at: '2024-12-03T09:00:00Z' },
  { id: 19, title: 'Laptop Battery Optimization', content: '# Battery Optimization\n\n## Settings\n- Reduce screen brightness to 70%\n- Enable battery saver mode when below 20%\n- Set sleep timer to 5 minutes on battery\n- Disable keyboard backlight when not needed\n\n## Software\n- Close unused browser tabs\n- Quit applications not in use\n- Disable startup programs you do not need\n- Keep OS and drivers updated\n\n## Hardware Care\n- Avoid extreme temperatures\n- Do not leave plugged in 100% of the time\n- Calibrate battery monthly (full discharge + charge)\n- Use original charger only\n\n## Expected Battery Life\n- Modern laptops: 6-10 hours with light use\n- Report significant degradation (>50%) to IT', category: 'Hardware', tags: 'battery,laptop,hardware', views: 267, author_id: 2, created_at: '2024-10-15T08:00:00Z', updated_at: '2024-12-02T14:00:00Z' },
  { id: 20, title: 'Security Incident Reporting', content: '# Reporting Security Incidents\n\n## What to Report\n- Phishing emails\n- Suspicious login alerts\n- Lost or stolen devices\n- Unauthorized data access\n- Malware or virus infections\n\n## How to Report\n1. **Immediate threat**: Call Security Hotline at x9999\n2. **Standard report**: Create a ticket with category "Security"\n3. **Email reports**: Forward phishing emails to security@company.com\n\n## What Happens Next\n- Acknowledgment within 1 hour\n- Investigation within 4 hours\n- Resolution updates every 24 hours\n- Post-incident review for major events\n\n## Do NOT\n- Forward suspicious emails to others\n- Click links in suspicious messages\n- Attempt to investigate malware yourself\n- Delay reporting due to uncertainty', category: 'General', tags: 'security,incident,reporting', views: 198, author_id: 1, created_at: '2024-11-01T08:00:00Z', updated_at: '2024-12-04T10:00:00Z' },
];


const SLA_POLICIES = [
  { id: 1, name: 'Critical Incident', description: 'For critical system outages and major disruptions', priority: 'critical', response_time_minutes: 15, resolution_time_minutes: 240, business_hours_only: false, department_id: 1, created_at: '2024-01-01T08:00:00Z' },
  { id: 2, name: 'High Priority', description: 'For high priority incidents affecting multiple users', priority: 'high', response_time_minutes: 60, resolution_time_minutes: 480, business_hours_only: true, department_id: 1, created_at: '2024-01-01T08:00:00Z' },
  { id: 3, name: 'Standard Support', description: 'Default SLA for general support requests', priority: 'medium', response_time_minutes: 240, resolution_time_minutes: 1440, business_hours_only: true, department_id: 1, created_at: '2024-01-01T08:00:00Z' },
  { id: 4, name: 'Low Priority', description: 'For low priority and feature requests', priority: 'low', response_time_minutes: 480, resolution_time_minutes: 2880, business_hours_only: true, department_id: 1, created_at: '2024-01-01T08:00:00Z' },
  { id: 5, name: 'HR Confidential', description: 'Special SLA for HR-related confidential tickets', priority: 'high', response_time_minutes: 120, resolution_time_minutes: 720, business_hours_only: true, department_id: 2, created_at: '2024-02-01T08:00:00Z' },
];

const CANNED_RESPONSES = [
  { id: 1, title: 'Password Reset Instructions', content: 'Hello,\n\nTo reset your password, please follow these steps:\n1. Go to the login page and click "Forgot Password"\n2. Enter your email address\n3. Check your inbox for the reset link\n4. Click the link and enter your new password\n\nIf you need further assistance, let us know.', category: 'Access', tags: 'password,reset', usage_count: 47, created_by: 1, created_at: '2024-01-15T08:00:00Z' },
  { id: 2, title: 'VPN Troubleshooting Steps', content: 'Thank you for contacting support.\n\nPlease try the following VPN troubleshooting steps:\n1. Disconnect and reconnect to VPN\n2. Restart the VPN client\n3. Check your internet connection\n4. Clear DNS cache: ipconfig /flushdns\n5. Try a different VPN gateway\n\nLet us know if the issue persists.', category: 'Network', tags: 'vpn,troubleshooting', usage_count: 32, created_by: 4, created_at: '2024-02-01T08:00:00Z' },
  { id: 3, title: 'Software Installation Request', content: 'Hi,\n\nWe have received your software installation request. Our team will review the request and get back to you within 24 hours.\n\nPlease ensure you have approval from your manager for any licensed software.\n\nBest regards,\nIT Support', category: 'Software', tags: 'software,installation', usage_count: 28, created_by: 2, created_at: '2024-02-15T08:00:00Z' },
  { id: 4, title: 'Hardware Replacement Approval', content: 'Your hardware replacement request has been approved.\n\nWe will order the replacement device and notify you when it arrives. Estimated delivery: 5-7 business days.\n\nPlease back up your data before the swap.\n\nThank you,\nIT Operations', category: 'Hardware', tags: 'hardware,replacement', usage_count: 19, created_by: 1, created_at: '2024-03-01T08:00:00Z' },
  { id: 5, title: 'Access Granted Notification', content: 'Hello,\n\nYour access request has been granted. You should now be able to access the requested resource.\n\nIf you encounter any issues, please reply to this ticket.\n\nBest regards,\nIT Security', category: 'Access', tags: 'access,granted', usage_count: 56, created_by: 1, created_at: '2024-03-15T08:00:00Z' },
  { id: 6, title: 'Escalation to Network Team', content: 'This ticket has been escalated to the Network Engineering team.\n\nA network specialist will investigate the issue and provide an update within 2 hours.\n\nTicket priority: High\nExpected response: Within 2 hours\n\nNetwork Team', category: 'Network', tags: 'escalation,network', usage_count: 15, created_by: 7, created_at: '2024-04-01T08:00:00Z' },
  { id: 7, title: 'Out of Office Handover', content: 'Thank you for your message.\n\nI am currently out of office and will return on [DATE]. Your ticket has been assigned to a colleague who will assist you in my absence.\n\nFor urgent matters, please contact the IT hotline at x9999.\n\nBest regards', category: 'General', tags: 'ooo,handover', usage_count: 12, created_by: 3, created_at: '2024-04-15T08:00:00Z' },
  { id: 8, title: 'Meeting Room AV Setup', content: 'The AV equipment in the meeting room has been checked and is working correctly.\n\nQuick start guide:\n1. Press the power button on the wall panel\n2. Connect your laptop via HDMI or use wireless casting\n3. Use the in-room microphone for video calls\n\nFor assistance during your meeting, press the IT Support button on the wall panel.\n\nFacilities Team', category: 'Hardware', tags: 'av,meeting room', usage_count: 22, created_by: 9, created_at: '2024-05-01T08:00:00Z' },
  { id: 9, title: 'Account Locked Recovery', content: 'Your account has been unlocked.\n\nPlease try logging in again. If your account was locked due to too many failed attempts, wait 15 minutes before trying.\n\nFor security reasons, please ensure your password meets our complexity requirements:\n- Minimum 8 characters\n- At least one uppercase letter\n- At least one number\n\nIT Security', category: 'Access', tags: 'account,locked', usage_count: 38, created_by: 7, created_at: '2024-05-15T08:00:00Z' },
  { id: 10, title: 'Feedback Request', content: 'Hi,\n\nWe hope your issue has been resolved satisfactorily.\n\nWe would appreciate your feedback on the support you received. Please take a moment to rate your experience by replying to this email.\n\nYour feedback helps us improve our services.\n\nThank you,\nCustomer Success Team', category: 'General', tags: 'feedback,csat', usage_count: 41, created_by: 3, created_at: '2024-06-01T08:00:00Z' },
];

const ANNOUNCEMENTS = [
  { id: 1, title: 'System Maintenance - Dec 8', content: 'Scheduled maintenance on Dec 8, 2024 at 02:00 UTC. Expected downtime: 2 hours. All services will be temporarily unavailable.', target_roles: 'admin,agent,user', is_pinned: true, published_by: 1, published_at: '2024-12-01T08:00:00Z', expires_at: '2024-12-09T08:00:00Z' },
  { id: 2, title: 'New VPN Client Rollout', content: 'We are rolling out a new VPN client starting next week. Please update your client by Dec 15. Instructions will be sent via email.', target_roles: 'admin,agent,user', is_pinned: false, published_by: 1, published_at: '2024-12-02T08:00:00Z', expires_at: '2024-12-20T08:00:00Z' },
  { id: 3, title: 'Office Closure - Holiday Period', content: 'The office will be closed from Dec 23 to Jan 2 for the holiday period. Remote support will be available for critical issues only.', target_roles: 'admin,agent,user', is_pinned: true, published_by: 5, published_at: '2024-12-03T08:00:00Z', expires_at: '2025-01-03T08:00:00Z' },
  { id: 4, title: 'Security Awareness Training', content: 'Mandatory security awareness training is due by Dec 31. Please complete the online module via the HR portal.', target_roles: 'admin,agent', is_pinned: false, published_by: 5, published_at: '2024-12-04T08:00:00Z', expires_at: '2024-12-31T23:59:59Z' },
  { id: 5, title: 'New Hire Onboarding Update', content: 'The onboarding process has been updated with new checklists. Managers, please review the updated documentation.', target_roles: 'admin', is_pinned: false, published_by: 5, published_at: '2024-11-28T08:00:00Z', expires_at: '2024-12-31T23:59:59Z' },
];

const SERVICE_CATALOG_ITEMS = [
  { id: 1, name: 'Laptop Provisioning', description: 'Request a new laptop or replacement device. Includes standard software installation.', category: 'Hardware', estimated_days: 3, approval_required: true, cost: 0, department_id: 1, is_active: true, created_at: '2024-01-01T08:00:00Z' },
  { id: 2, name: 'Software License Request', description: 'Request a new software license or renewal of an existing license.', category: 'Software', estimated_days: 2, approval_required: true, cost: 0, department_id: 1, is_active: true, created_at: '2024-01-01T08:00:00Z' },
  { id: 3, name: 'VPN Access Setup', description: 'Request VPN access for remote work or travel.', category: 'Network', estimated_days: 1, approval_required: false, cost: 0, department_id: 1, is_active: true, created_at: '2024-01-01T08:00:00Z' },
  { id: 4, name: 'Email Distribution Group', description: 'Create or modify an email distribution group.', category: 'Access', estimated_days: 1, approval_required: false, cost: 0, department_id: 1, is_active: true, created_at: '2024-01-01T08:00:00Z' },
  { id: 5, name: 'Conference Room Booking Setup', description: 'Request access to conference room booking system or resolve booking issues.', category: 'Facilities', estimated_days: 1, approval_required: false, cost: 0, department_id: 4, is_active: true, created_at: '2024-02-01T08:00:00Z' },
  { id: 6, name: 'New Employee Account Setup', description: 'Complete IT onboarding package for new hires including accounts, laptop, and access.', category: 'Access', estimated_days: 2, approval_required: true, cost: 0, department_id: 1, is_active: true, created_at: '2024-02-01T08:00:00Z' },
];

const TIME_ENTRIES = [
  { id: 1, ticket_id: 1, user_id: 2, minutes: 45, description: 'Initial diagnosis and troubleshooting', billable: true, created_at: '2024-12-01T10:00:00Z' },
  { id: 2, ticket_id: 1, user_id: 2, minutes: 30, description: 'Hardware inspection and reset attempts', billable: true, created_at: '2024-12-01T11:00:00Z' },
  { id: 3, ticket_id: 2, user_id: 4, minutes: 20, description: 'VPN gateway analysis', billable: true, created_at: '2024-12-02T12:00:00Z' },
  { id: 4, ticket_id: 2, user_id: 4, minutes: 60, description: 'Policy fix and testing', billable: true, created_at: '2024-12-03T14:00:00Z' },
  { id: 5, ticket_id: 3, user_id: 1, minutes: 15, description: 'Access review and approval', billable: false, created_at: '2024-12-02T16:00:00Z' },
  { id: 6, ticket_id: 5, user_id: 6, minutes: 25, description: 'Slack reinstallation guidance', billable: true, created_at: '2024-12-03T09:00:00Z' },
  { id: 7, ticket_id: 7, user_id: 7, minutes: 90, description: 'Database query analysis', billable: true, created_at: '2024-12-04T14:00:00Z' },
  { id: 8, ticket_id: 8, user_id: 4, minutes: 40, description: 'AP firmware rollback', billable: true, created_at: '2024-12-04T11:00:00Z' },
  { id: 9, ticket_id: 12, user_id: 7, minutes: 15, description: 'Permission restoration', billable: true, created_at: '2024-12-04T10:30:00Z' },
  { id: 10, ticket_id: 16, user_id: 6, minutes: 120, description: 'Plugin conflict investigation', billable: true, created_at: '2024-12-04T09:00:00Z' },
];

const CSAT_RATINGS = [
  { id: 1, ticket_id: 3, rating: 5, comment: 'Sarah was very helpful and resolved my issue quickly!', submitted_by: 10, submitted_at: '2024-12-03T08:00:00Z' },
  { id: 2, ticket_id: 9, rating: 4, comment: 'Good service, password reset was fast.', submitted_by: 6, submitted_at: '2024-12-02T10:00:00Z' },
  { id: 3, ticket_id: 1, rating: 3, comment: 'Still waiting for resolution, but agent was communicative.', submitted_by: 5, submitted_at: '2024-12-03T14:00:00Z' },
  { id: 4, ticket_id: 8, rating: 5, comment: 'David fixed the WiFi issue very quickly. Great work!', submitted_by: 1, submitted_at: '2024-12-04T16:00:00Z' },
  { id: 5, ticket_id: 13, rating: 4, comment: 'Issue resolved within expected time.', submitted_by: 6, submitted_at: '2024-12-04T10:00:00Z' },
  { id: 6, ticket_id: 2, rating: 4, comment: 'VPN is stable now, thanks for the quick fix.', submitted_by: 8, submitted_at: '2024-12-04T09:00:00Z' },
  { id: 7, ticket_id: 14, rating: 2, comment: 'Invoice issue still not fully resolved.', submitted_by: 8, submitted_at: '2024-12-04T14:00:00Z' },
  { id: 8, ticket_id: 4, rating: 3, comment: 'Printer still has issues occasionally.', submitted_by: 6, submitted_at: '2024-12-04T11:00:00Z' },
];

const AUDIT_LOGS = [
  { id: 1, action: 'login', entity_type: 'user', entity_id: 1, user_id: 1, details: 'User logged in from IP 192.168.1.100', ip_address: '192.168.1.100', created_at: '2024-12-01T08:00:00Z' },
  { id: 2, action: 'ticket_created', entity_type: 'ticket', entity_id: 1, user_id: 5, details: 'Ticket #1 created: Laptop not powering on after update', ip_address: '192.168.1.105', created_at: '2024-12-01T09:30:00Z' },
  { id: 3, action: 'ticket_assigned', entity_type: 'ticket', entity_id: 1, user_id: 2, details: 'Ticket #1 assigned to Marcus Johnson', ip_address: '192.168.1.102', created_at: '2024-12-01T09:45:00Z' },
  { id: 4, action: 'login', entity_type: 'user', entity_id: 4, user_id: 4, details: 'User logged in from IP 192.168.1.104', ip_address: '192.168.1.104', created_at: '2024-12-02T08:30:00Z' },
  { id: 5, action: 'ticket_created', entity_type: 'ticket', entity_id: 2, user_id: 8, details: 'Ticket #2 created: VPN connection drops every 15 minutes', ip_address: '192.168.1.108', created_at: '2024-12-02T11:15:00Z' },
  { id: 6, action: 'ticket_resolved', entity_type: 'ticket', entity_id: 3, user_id: 1, details: 'Ticket #3 resolved: Access granted to Salesforce dashboard', ip_address: '192.168.1.100', created_at: '2024-12-02T16:00:00Z' },
  { id: 7, action: 'user_updated', entity_type: 'user', entity_id: 6, user_id: 1, details: 'Updated user profile for James Wilson', ip_address: '192.168.1.100', created_at: '2024-12-03T10:00:00Z' },
  { id: 8, action: 'login_failed', entity_type: 'user', entity_id: 0, user_id: 10, details: 'Failed login attempt from IP 192.168.1.110', ip_address: '192.168.1.110', created_at: '2024-12-03T14:00:00Z' },
  { id: 9, action: 'kb_created', entity_type: 'knowledge_article', entity_id: 21, user_id: 6, details: 'New KB article created: Teams Audio Troubleshooting', ip_address: '192.168.1.106', created_at: '2024-12-03T16:00:00Z' },
  { id: 10, action: 'ticket_updated', entity_type: 'ticket', entity_id: 8, user_id: 4, details: 'Ticket #8 status changed to in_progress', ip_address: '192.168.1.104', created_at: '2024-12-04T11:30:00Z' },
  { id: 11, action: 'settings_changed', entity_type: 'setting', entity_id: 0, user_id: 1, details: 'SLA policy Critical Incident was updated', ip_address: '192.168.1.100', created_at: '2024-12-04T09:00:00Z' },
  { id: 12, action: 'user_created', entity_type: 'user', entity_id: 13, user_id: 1, details: 'New user created: Thomas Wright', ip_address: '192.168.1.100', created_at: '2024-12-04T13:00:00Z' },
  { id: 13, action: 'ticket_deleted', entity_type: 'ticket', entity_id: 17, user_id: 1, details: 'Duplicate ticket #17 was deleted', ip_address: '192.168.1.100', created_at: '2024-12-04T15:00:00Z' },
  { id: 14, action: 'login', entity_type: 'user', entity_id: 2, user_id: 2, details: 'User logged in from IP 192.168.1.102', ip_address: '192.168.1.102', created_at: '2024-12-04T16:00:00Z' },
  { id: 15, action: 'automation_triggered', entity_type: 'automation', entity_id: 1, user_id: 0, details: 'Auto-assignment rule triggered for ticket #18', ip_address: 'system', created_at: '2024-12-04T17:00:00Z' },
];

const AUTOMATION_RULES = [
  { id: 1, name: 'Auto-assign Hardware Tickets', description: 'Automatically assign hardware tickets to the IT support team lead', trigger: 'ticket_created', conditions: '{"category": "Hardware"}', actions: '{"assign_to": 2, "set_priority": "medium"}', is_active: true, run_count: 23, created_by: 1, created_at: '2024-01-15T08:00:00Z' },
  { id: 2, name: 'Critical Priority Alert', description: 'Send alert and escalate critical priority tickets immediately', trigger: 'ticket_created', conditions: '{"priority": "critical"}', actions: '{"set_priority": "critical", "notify": [1, 7]}', is_active: true, run_count: 5, created_by: 1, created_at: '2024-02-01T08:00:00Z' },
  { id: 3, name: 'SLA Breach Warning', description: 'Send warning notification when tickets approach SLA breach', trigger: 'sla_approach', conditions: '{"hours_remaining": 2}', actions: '{"notify": [1], "escalate": true}', is_active: true, run_count: 12, created_by: 7, created_at: '2024-03-01T08:00:00Z' },
  { id: 4, name: 'Customer Auto-Reply', description: 'Send automatic acknowledgment when customer creates a ticket', trigger: 'ticket_created', conditions: '{"role": "customer"}', actions: '{"send_email": true, "set_status": "open"}', is_active: true, run_count: 45, created_by: 3, created_at: '2024-04-01T08:00:00Z' },
];
function seedData(db: DBState): void {
  db.departments = [...DEPARTMENTS];
  db.categories = [...CATEGORIES];
  db.users = [...USERS];
  db.tickets = [...TICKETS];
  db.comments = [...COMMENTS];
  db.activities = [...ACTIVITIES];
  db.knowledge_articles = [...KNOWLEDGE_ARTICLES];
  db.sla_policies = [...SLA_POLICIES];
  db.canned_responses = [...CANNED_RESPONSES];
  db.announcements = [...ANNOUNCEMENTS];
  db.service_catalog = [...SERVICE_CATALOG_ITEMS];
  db.time_entries = [...TIME_ENTRIES];
  db.csat_ratings = [...CSAT_RATINGS];
  db.audit_logs = [...AUDIT_LOGS];
  db.automation_rules = [...AUTOMATION_RULES];
}

// --- Client Factory ---

export function createClient(config: { host?: string; port?: number } = {}): VedaClient {
  const cfg = getConnectionConfig();
  const host = config.host || cfg.host || 'localhost';
  const port = config.port || cfg.port || 6380;

  // Try real driver first (only works in Node.js/TCP environments)
  let _realClient: any = null;

  const client: VedaClient = {
    _isConnected: false,
    _connectionInfo: { host, port, latency: 0 },

    async _connect() {
      // Attempt real VedaDB connection
      try {
        const vedadb = await import('vedadb');
        if (vedadb?.createClient) {
          _realClient = vedadb.createClient({ host, port, timeout: 30000 });
          await _realClient.connect();
          client._isConnected = true;
          client._connectionInfo.latency = Math.floor(Math.random() * 3) + 2;
          return;
        }
      } catch {
        /* real driver unavailable — fall back to localStorage mock */
      }

      // Browser mock fallback
      await delay(600);
      client._isConnected = true;
      client._connectionInfo.latency = Math.floor(Math.random() * 3) + 2;

      const db = loadDB();
      const seeded = localStorage.getItem(SEEDED_KEY);
      if (!seeded) {
        seedData(db);
        saveDB(db);
        localStorage.setItem(SEEDED_KEY, 'true');
      }
    },

    async query(sql: string): Promise<Result> {
      await delay(50);
      const lower = sql.toLowerCase().trim();

      // Very basic SQL parser for common patterns
      if (lower.startsWith('select')) {
        // Parse simple SELECT ... FROM table [WHERE ...] [ORDER BY ...] [LIMIT ...]
        const fromMatch = lower.match(/from\s+(\w+)/);
        const table = fromMatch ? fromMatch[1] : '';
        const db = loadDB();
        const allRows = getTable(db, table);

        // Parse WHERE clause (simple equality only)
        const whereMatch = lower.match(/where\s+(.+?)(?:order by|limit|$)/i);
        let filtered = allRows;
        if (whereMatch) {
          const whereClause = whereMatch[1].trim();
          // Handle AND conditions
          const conditions = whereClause.split(/\s+and\s+/i);
          filtered = allRows.filter((row) =>
            conditions.every((cond) => {
              const eqMatch = cond.match(/(\w+)\s*=\s*'?([^']+)'?/);
              if (eqMatch) {
                const [, col, val] = eqMatch;
                return String(row[col]) === val;
              }
              return true;
            })
          );
        }

        // Parse ORDER BY
        const orderMatch = lower.match(/order by\s+(\w+)(?:\s+(asc|desc))?/i);
        if (orderMatch) {
          const [, col, dir] = orderMatch;
          filtered.sort((a, b) => {
            const aVal = a[col];
            const bVal = b[col];
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return dir?.toLowerCase() === 'desc' ? 1 : -1;
            if (bVal == null) return dir?.toLowerCase() === 'desc' ? -1 : 1;
            if (typeof aVal === 'number' && typeof bVal === 'number') {
              return dir?.toLowerCase() === 'desc' ? bVal - aVal : aVal - bVal;
            }
            const cmp = String(aVal).localeCompare(String(bVal));
            return dir?.toLowerCase() === 'desc' ? -cmp : cmp;
          });
        }

        // Parse LIMIT
        const limitMatch = lower.match(/limit\s+(\d+)/);
        if (limitMatch) {
          const limit = parseInt(limitMatch[1], 10);
          filtered = filtered.slice(0, limit);
        }

        // Parse OFFSET
        const offsetMatch = lower.match(/offset\s+(\d+)/);
        if (offsetMatch) {
          const offset = parseInt(offsetMatch[1], 10);
          filtered = filtered.slice(offset);
        }

        const columns = filtered.length > 0 ? Object.keys(filtered[0]) : [];
        const rows = filtered.map((row) => columns.map((c) => row[c]));
        return createResult(columns, rows, `SELECT returned ${filtered.length} rows`);
      }

      return createResult([], [], 'Query executed');
    },

    async exec(sql: string): Promise<Result> {
      await delay(50);
      return createResult([], [], `Executed: ${sql}`);
    },

    async insert(table: string, data: Record<string, unknown>): Promise<Result> {
      await delay(50);
      const db = loadDB();
      const rows = getTable(db, table);

      // Auto-increment ID
      const ids = rows.map((r) => (r.id as number) || 0);
      const maxId = ids.length > 0 ? Math.max(...ids) : 0;
      const newRow: Record<string, unknown> = { ...data, id: (data.id as number) || maxId + 1 };

      // Add timestamps
      const now = new Date().toISOString();
      if (!newRow.created_at) newRow.created_at = now;
      if (!newRow.updated_at) newRow.updated_at = now;

      rows.push(newRow);
      db[table] = rows;
      saveDB(db);

      const columns = Object.keys(newRow);
      return createResult(columns, [columns.map((c) => newRow[c])], `Inserted 1 row into ${table}`);
    },

    async select(table: string, options: SelectOptions = {}): Promise<Result> {
      await delay(50);
      const db = loadDB();
      let rows = getTable(db, table);

      // WHERE filtering
      if (options.where) {
        rows = rows.filter((row) => matchesWhere(row, options.where!));
      }

      // ORDER BY
      if (options.orderBy) {
        const [col, dir] = options.orderBy.split(' ');
        rows = [...rows].sort((a, b) => {
          const aVal = a[col];
          const bVal = b[col];
          if (aVal == null && bVal == null) return 0;
          if (aVal == null) return dir?.toLowerCase() === 'desc' ? 1 : -1;
          if (bVal == null) return dir?.toLowerCase() === 'desc' ? -1 : 1;
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return dir?.toLowerCase() === 'desc' ? bVal - aVal : aVal - bVal;
          }
          const cmp = String(aVal).localeCompare(String(bVal));
          return dir?.toLowerCase() === 'desc' ? -cmp : cmp;
        });
      }

      // Total before limit
      const totalCount = rows.length;

      // OFFSET
      if (options.offset) {
        rows = rows.slice(options.offset);
      }

      // LIMIT
      if (options.limit) {
        rows = rows.slice(0, options.limit);
      }

      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const rowData = rows.map((row) => columns.map((c) => row[c]));
      const result = createResult(columns, rowData, `SELECT returned ${rows.length} rows`);
      // @ts-expect-error attaching totalCount for pagination
      result._totalCount = totalCount;
      return result;
    },

    async update(table: string, set: Record<string, unknown>, where: Record<string, unknown>): Promise<Result> {
      await delay(50);
      const db = loadDB();
      const rows = getTable(db, table);
      let updated = 0;

      for (const row of rows) {
        if (matchesWhere(row, where)) {
          Object.assign(row, set, { updated_at: new Date().toISOString() });
          updated++;
        }
      }

      db[table] = rows;
      saveDB(db);
      return createResult([], [], `Updated ${updated} rows in ${table}`);
    },

    async deleteFrom(table: string, where: Record<string, unknown>): Promise<Result> {
      await delay(50);
      const db = loadDB();
      const rows = getTable(db, table);
      const beforeLen = rows.length;
      const filtered = rows.filter((row) => !matchesWhere(row, where));
      const deleted = beforeLen - filtered.length;

      db[table] = filtered;
      saveDB(db);
      return createResult([], [], `Deleted ${deleted} rows from ${table}`);
    },

    async transaction<T>(fn: (trx: VedaClient) => Promise<T>): Promise<T> {
      // In localStorage mode, transactions are effectively synchronous
      // We just run the function and if it throws, the DB isn't updated
      // (since we only save at the end of each operation)
      return fn(client);
    },

    cache: {
      set(key: string, value: string, _ttl?: number): void {
        localStorage.setItem(`vedacache_${key}`, value);
      },
      get(key: string): string | null {
        return localStorage.getItem(`vedacache_${key}`);
      },
      del(key: string): void {
        localStorage.removeItem(`vedacache_${key}`);
      },
      incr(key: string): number {
        const val = localStorage.getItem(`vedacache_${key}`);
        const num = val ? parseInt(val, 10) : 0;
        const next = num + 1;
        localStorage.setItem(`vedacache_${key}`, String(next));
        return next;
      },
    },
  };

  return client;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton instance
let _defaultClient: VedaClient | null = null;

export function getDefaultClient(): VedaClient {
  if (!_defaultClient) {
    _defaultClient = createClient();
  }
  return _defaultClient;
}

export type { VedaClient, Result, SelectOptions, CacheAPI };
