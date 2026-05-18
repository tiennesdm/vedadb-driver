/**
 * Browser-compatible VedaDB mock client
 * Provides the same API as the real vedadb npm package but uses localStorage for persistence.
 * Seeds realistic mock data on first load.
 */

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

const USERS = [
  { id: 1, name: 'Sarah Chen', email: 'sarah.chen@company.com', role: 'admin', avatar: '', department: 'IT Operations', created_at: '2024-01-10T08:00:00Z' },
  { id: 2, name: 'Marcus Johnson', email: 'marcus.j@company.com', role: 'agent', avatar: '', department: 'Technical Support', created_at: '2024-01-12T08:00:00Z' },
  { id: 3, name: 'Aisha Patel', email: 'aisha.patel@company.com', role: 'agent', avatar: '', department: 'Customer Success', created_at: '2024-01-15T08:00:00Z' },
  { id: 4, name: 'David Kim', email: 'david.kim@company.com', role: 'agent', avatar: '', department: 'Network Engineering', created_at: '2024-02-01T08:00:00Z' },
  { id: 5, name: 'Emily Rodriguez', email: 'emily.r@company.com', role: 'viewer', avatar: '', department: 'Human Resources', created_at: '2024-02-10T08:00:00Z' },
  { id: 6, name: 'James Wilson', email: 'james.w@company.com', role: 'agent', avatar: '', department: 'Software Development', created_at: '2024-02-15T08:00:00Z' },
  { id: 7, name: 'Liu Wei', email: 'liu.wei@company.com', role: 'admin', avatar: '', department: 'Infrastructure', created_at: '2024-03-01T08:00:00Z' },
  { id: 8, name: 'Olivia Martinez', email: 'olivia.m@company.com', role: 'viewer', avatar: '', department: 'Finance', created_at: '2024-03-10T08:00:00Z' },
  { id: 9, name: 'Michael Brown', email: 'michael.b@company.com', role: 'agent', avatar: '', department: 'Field Support', created_at: '2024-03-15T08:00:00Z' },
  { id: 10, name: 'Sophia Anderson', email: 'sophia.a@company.com', role: 'viewer', avatar: '', department: 'Marketing', created_at: '2024-04-01T08:00:00Z' },
];

const TICKETS = [
  { id: 1, title: 'Laptop not powering on after update', description: 'My work laptop does not power on after the latest system update. The charging light blinks but screen stays black. Tried hard reset with no success.', status: 'open', priority: 'high', category: 'Hardware', created_by: 5, assigned_to: 2, created_at: '2024-12-01T09:30:00Z', updated_at: '2024-12-01T09:30:00Z' },
  { id: 2, title: 'VPN connection drops every 15 minutes', description: 'The corporate VPN keeps disconnecting approximately every 15 minutes. This started happening yesterday. I have tried reconnecting and restarting the VPN client.', status: 'in_progress', priority: 'high', category: 'Network', created_by: 8, assigned_to: 4, created_at: '2024-12-02T11:15:00Z', updated_at: '2024-12-03T14:20:00Z' },
  { id: 3, title: 'Request access to Salesforce dashboard', description: 'Need read-only access to the Sales Analytics dashboard in Salesforce for the quarterly review meeting next week.', status: 'resolved', priority: 'medium', category: 'Access', created_by: 10, assigned_to: 1, created_at: '2024-11-28T08:45:00Z', updated_at: '2024-12-02T16:00:00Z' },
  { id: 4, title: 'Printer on 3rd floor jammed', description: 'The shared printer on the 3rd floor near meeting room B is jammed and displaying error code E-501. Several people have reported this.', status: 'open', priority: 'low', category: 'Hardware', created_by: 6, assigned_to: 9, created_at: '2024-12-03T10:00:00Z', updated_at: '2024-12-03T10:00:00Z' },
  { id: 5, title: 'Slack notifications not working', description: 'Desktop Slack app is not showing notification badges or playing notification sounds. Mobile app works fine. Already checked system notification settings.', status: 'in_progress', priority: 'medium', category: 'Software', created_by: 3, assigned_to: 6, created_at: '2024-12-01T14:30:00Z', updated_at: '2024-12-04T09:15:00Z' },
  { id: 6, title: 'New hire laptop setup - Jake Torres', description: 'Need to prepare a development laptop for new hire Jake Torres starting next Monday. Requires Python, Node.js, Docker, and IntelliJ IDEA.', status: 'open', priority: 'medium', category: 'Hardware', created_by: 5, assigned_to: 2, created_at: '2024-12-04T07:00:00Z', updated_at: '2024-12-04T07:00:00Z' },
  { id: 7, title: 'Database query timeout on reports', description: 'The monthly expense report query is timing out after 60 seconds. This was working fine last week. Need assistance optimizing or checking server load.', status: 'open', priority: 'critical', category: 'Software', created_by: 8, assigned_to: 7, created_at: '2024-12-04T13:45:00Z', updated_at: '2024-12-04T13:45:00Z' },
  { id: 8, title: 'WiFi keeps disconnecting in conference room A', description: 'WiFi signal in conference room A is very weak and keeps dropping. Affects all meeting participants. Started after the weekend maintenance.', status: 'in_progress', priority: 'high', category: 'Network', created_by: 1, assigned_to: 4, created_at: '2024-12-02T09:00:00Z', updated_at: '2024-12-04T11:30:00Z' },
  { id: 9, title: 'Reset password for staging environment', description: 'Forgot the admin password for the staging environment. Need a reset link sent to my email.', status: 'resolved', priority: 'low', category: 'Access', created_by: 6, assigned_to: 1, created_at: '2024-11-30T16:20:00Z', updated_at: '2024-12-01T08:00:00Z' },
  { id: 10, title: 'Adobe Creative Cloud license renewal', description: 'Three Adobe Creative Cloud licenses are expiring this week. Need renewal for the design team.', status: 'on_hold', priority: 'medium', category: 'Software', created_by: 10, assigned_to: 3, created_at: '2024-12-03T11:00:00Z', updated_at: '2024-12-03T15:00:00Z' },
  { id: 11, title: 'External monitor flickering', description: 'My external monitor connected via USB-C started flickering intermittently. Tried different cables and ports.', status: 'open', priority: 'low', category: 'Hardware', created_by: 5, assigned_to: 9, created_at: '2024-12-04T08:30:00Z', updated_at: '2024-12-04T08:30:00Z' },
  { id: 12, title: 'Cannot access shared drive \\fileserver\projects', description: 'Getting \"Access Denied\" error when trying to access the projects shared drive. Was working fine until this morning.', status: 'open', priority: 'high', category: 'Network', created_by: 6, assigned_to: 7, created_at: '2024-12-04T10:15:00Z', updated_at: '2024-12-04T10:15:00Z' },
  { id: 13, title: 'Git repository permission issue', description: 'Getting 403 errors when pushing to the vedadesk-frontend repository. Need write permissions restored.', status: 'in_progress', priority: 'medium', category: 'Access', created_by: 6, assigned_to: 1, created_at: '2024-12-03T09:45:00Z', updated_at: '2024-12-04T08:00:00Z' },
  { id: 14, title: 'Invoice #2847 incorrect amount', description: 'The cloud hosting invoice for November shows double the expected amount. Please review and correct before payment processing on Friday.', status: 'open', priority: 'medium', category: 'Billing', created_by: 8, assigned_to: 3, created_at: '2024-12-04T12:00:00Z', updated_at: '2024-12-04T12:00:00Z' },
  { id: 15, title: 'Conference room projector not detected', description: 'The projector in conference room C is not being detected by any laptops via HDMI or wireless casting.', status: 'open', priority: 'low', category: 'Hardware', created_by: 10, assigned_to: 9, created_at: '2024-12-04T15:30:00Z', updated_at: '2024-12-04T15:30:00Z' },
  { id: 16, title: 'Jira board custom field not saving', description: 'Custom field \"Effort Estimate\" on the Engineering Scrum board is not saving values. Returns to blank after page refresh.', status: 'in_progress', priority: 'medium', category: 'Software', created_by: 6, assigned_to: 6, created_at: '2024-12-02T10:30:00Z', updated_at: '2024-12-04T09:45:00Z' },
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

function seedData(db: DBState): void {
  db.categories = [...CATEGORIES];
  db.users = [...USERS];
  db.tickets = [...TICKETS];
  db.comments = [...COMMENTS];
  db.activities = [...ACTIVITIES];
  db.knowledge_articles = [...KNOWLEDGE_ARTICLES];
}

// --- Client Factory ---

export function createClient(config: { host?: string; port?: number } = {}): VedaClient {
  const host = config.host || 'localhost';
  const port = config.port || 6380;

  const client: VedaClient = {
    _isConnected: false,
    _connectionInfo: { host, port, latency: 0 },

    async _connect() {
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
