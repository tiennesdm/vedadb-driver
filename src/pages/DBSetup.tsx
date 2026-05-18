/**
 * DB Setup Page — Creates all tables and seeds demo data in VedaDB
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  Play,
  RotateCcw,
  ChevronRight,
  Table2,
  Users,
  Ticket,
  BookOpen,
  Settings,
  Shield,
  Activity,
  Bell,
  Star,
  MessageSquare,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { vedaExec, vedaInsert, vedaTestConnection } from '@/lib/vedadb-api';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  SQL Schema                                                         */
/* ------------------------------------------------------------------ */

const TABLES_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#1890ff',
    created_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    role TEXT DEFAULT 'agent',
    department_id INTEGER,
    phone TEXT,
    avatar TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'medium',
    category TEXT,
    ticket_type TEXT DEFAULT 'incident',
    created_by INTEGER,
    assigned_to INTEGER,
    department_id INTEGER,
    rejection_reason TEXT,
    created_at TEXT DEFAULT datetime('now'),
    updated_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    user_id INTEGER,
    content TEXT,
    created_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    user_id INTEGER,
    action TEXT,
    created_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    category TEXT,
    tags TEXT,
    views INTEGER DEFAULT 0,
    author_id INTEGER,
    created_at TEXT DEFAULT datetime('now'),
    updated_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS sla_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    priority TEXT,
    response_time INTEGER,
    resolution_time INTEGER,
    business_hours INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS canned_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    category TEXT,
    created_by INTEGER,
    is_shared INTEGER DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    type TEXT DEFAULT 'info',
    target_roles TEXT,
    is_active INTEGER DEFAULT 1,
    published_at TEXT,
    expires_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    user_id INTEGER,
    description TEXT,
    minutes_spent INTEGER,
    is_billable INTEGER DEFAULT 1,
    created_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS csat_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    user_id INTEGER,
    rating INTEGER,
    comment TEXT,
    created_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT,
    entity_type TEXT,
    entity_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT DEFAULT datetime('now')
  )`,
  `CREATE TABLE IF NOT EXISTS service_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    category TEXT,
    form_template TEXT,
    approval_workflow TEXT,
    icon TEXT,
    is_active INTEGER DEFAULT 1
  )`,
];

/* ------------------------------------------------------------------ */
/*  Seed Data                                                          */
/* ------------------------------------------------------------------ */

const DEPARTMENTS = [
  { name: 'IT Support', description: 'Technical support and infrastructure management', color: '#1890ff' },
  { name: 'Human Resources', description: 'Employee relations, recruitment, and benefits', color: '#52c41a' },
  { name: 'Finance', description: 'Accounting, budgeting, and financial operations', color: '#faad14' },
  { name: 'Facilities', description: 'Office maintenance, security, and logistics', color: '#722ed1' },
  { name: 'Sales', description: 'Sales operations and customer relationship management', color: '#f5222d' },
];

const USERS = [
  { name: 'Sarah Chen', email: 'sarah.chen@company.com', password: 'password', role: 'super_admin', department_id: 1, phone: '+1-555-0101', avatar: '' },
  { name: 'Marcus Johnson', email: 'marcus.j@company.com', password: 'password', role: 'admin', department_id: 1, phone: '+1-555-0102', avatar: '' },
  { name: 'Aisha Patel', email: 'aisha.patel@company.com', password: 'password', role: 'manager', department_id: 2, phone: '+1-555-0103', avatar: '' },
  { name: 'David Kim', email: 'david.kim@company.com', password: 'password', role: 'agent', department_id: 1, phone: '+1-555-0104', avatar: '' },
  { name: 'Emily Rodriguez', email: 'emily.r@company.com', password: 'password', role: 'customer', department_id: 5, phone: '+1-555-0105', avatar: '' },
  { name: 'James Wilson', email: 'james.w@company.com', password: 'password', role: 'agent', department_id: 1, phone: '+1-555-0106', avatar: '' },
  { name: 'Olivia Martinez', email: 'olivia.m@company.com', password: 'password', role: 'manager', department_id: 3, phone: '+1-555-0107', avatar: '' },
  { name: 'Liam Thompson', email: 'liam.t@company.com', password: 'password', role: 'agent', department_id: 4, phone: '+1-555-0108', avatar: '' },
  { name: 'Sophia Lee', email: 'sophia.lee@company.com', password: 'password', role: 'customer', department_id: 5, phone: '+1-555-0109', avatar: '' },
  { name: 'Noah Garcia', email: 'noah.g@company.com', password: 'password', role: 'admin', department_id: 2, phone: '+1-555-0110', avatar: '' },
  { name: 'Isabella Brown', email: 'isabella.b@company.com', password: 'password', role: 'agent', department_id: 3, phone: '+1-555-0111', avatar: '' },
  { name: 'Ethan Davis', email: 'ethan.d@company.com', password: 'password', role: 'customer', department_id: 4, phone: '+1-555-0112', avatar: '' },
];

const CATEGORIES = [
  { name: 'Hardware', description: 'Physical devices, computers, printers, and peripherals' },
  { name: 'Software', description: 'Applications, licenses, installations, and updates' },
  { name: 'Network', description: 'Connectivity, Wi-Fi, VPN, and network infrastructure' },
  { name: 'Access', description: 'Account access, permissions, and security credentials' },
  { name: 'General', description: 'General inquiries and miscellaneous requests' },
  { name: 'Billing', description: 'Invoices, payments, subscriptions, and refunds' },
];

const TICKETS = [
  { title: 'Laptop screen flickering intermittently', description: 'My laptop screen started flickering yesterday. It happens every few minutes and lasts for about 10 seconds. I have tried restarting but the issue persists.', status: 'open', priority: 'high', category: 'Hardware', ticket_type: 'incident', created_by: 5, assigned_to: 4, department_id: 1 },
  { title: 'Request access to Salesforce CRM', description: 'I need access to Salesforce for the new client onboarding project. My manager has approved this request.', status: 'in_progress', priority: 'medium', category: 'Access', ticket_type: 'service_request', created_by: 5, assigned_to: 2, department_id: 1 },
  { title: 'VPN connection drops frequently', description: 'The VPN connection drops every 20-30 minutes. This is affecting my ability to work remotely. I am using the latest client version.', status: 'open', priority: 'high', category: 'Network', ticket_type: 'incident', created_by: 9, assigned_to: 6, department_id: 1 },
  { title: 'Printer on 3rd floor not responding', description: 'The HP printer on the 3rd floor near cubicle 302 is not responding to print jobs. Several colleagues have reported the same issue.', status: 'open', priority: 'medium', category: 'Hardware', ticket_type: 'incident', created_by: 7, assigned_to: 8, department_id: 4 },
  { title: 'New employee onboarding - laptop setup', description: 'We have 3 new hires starting next Monday. Need laptops configured with standard software packages.', status: 'in_progress', priority: 'medium', category: 'Hardware', ticket_type: 'service_request', created_by: 3, assigned_to: 4, department_id: 1 },
  { title: 'Email sync issues on mobile devices', description: 'Company email is not syncing on iPhones and Android devices. Started happening after the last server update.', status: 'open', priority: 'critical', category: 'Network', ticket_type: 'problem', created_by: 1, assigned_to: 6, department_id: 1 },
  { title: 'Software license renewal for Adobe Creative Cloud', description: 'The Adobe Creative Cloud team license expires at the end of this month. Need to process the renewal.', status: 'on_hold', priority: 'low', category: 'Software', ticket_type: 'service_request', created_by: 7, assigned_to: 11, department_id: 3 },
  { title: 'Conference room AV system upgrade', description: 'Request to upgrade the AV system in Conference Room B. The current projector has poor resolution and the speakers have audio issues.', status: 'open', priority: 'medium', category: 'Hardware', ticket_type: 'change', created_by: 3, assigned_to: 8, department_id: 4 },
  { title: 'Password reset for finance portal', description: 'I forgot my password for the internal finance portal. Need a reset link sent to my email.', status: 'resolved', priority: 'low', category: 'Access', ticket_type: 'incident', created_by: 12, assigned_to: 2, department_id: 1 },
  { title: 'Network slowness during peak hours', description: 'Internet speed drops significantly between 2-4 PM daily. This affects video calls and file uploads.', status: 'in_progress', priority: 'high', category: 'Network', ticket_type: 'problem', created_by: 4, assigned_to: 6, department_id: 1 },
  { title: 'Request for new monitor - dual screen setup', description: 'Requesting a second monitor for my desk to improve productivity. My current setup only has one 24-inch display.', status: 'open', priority: 'low', category: 'Hardware', ticket_type: 'service_request', created_by: 10, assigned_to: 4, department_id: 1 },
  { title: 'Database backup failure alert', description: 'Automated backup job failed last night with error code 0x80070005. Need immediate investigation.', status: 'open', priority: 'critical', category: 'Software', ticket_type: 'incident', created_by: 1, assigned_to: 2, department_id: 1 },
  { title: 'Office temperature too low', description: 'The air conditioning in the east wing is set too high. Multiple employees have complained about being cold.', status: 'open', priority: 'low', category: 'General', ticket_type: 'incident', created_by: 9, assigned_to: 8, department_id: 4 },
  { title: 'New firewall rule request', description: 'Need to open port 8443 for the new payment gateway integration. Security team has reviewed and approved.', status: 'in_progress', priority: 'high', category: 'Network', ticket_type: 'change', created_by: 10, assigned_to: 6, department_id: 1 },
  { title: 'Slack integration with Jira not working', description: 'The Slack-Jira integration stopped sending notifications. Need to reconfigure the webhook.', status: 'open', priority: 'medium', category: 'Software', ticket_type: 'incident', created_by: 5, assigned_to: 4, department_id: 1 },
  { title: 'Request for standing desk', description: 'Doctor recommended a standing desk due to back pain. HR has approved the ergonomic accommodation.', status: 'on_hold', priority: 'low', category: 'General', ticket_type: 'service_request', created_by: 12, assigned_to: 8, department_id: 4 },
  { title: 'Wi-Fi dead zone in cafeteria', description: 'No Wi-Fi signal in the cafeteria area. Employees cannot stay connected during lunch breaks.', status: 'open', priority: 'medium', category: 'Network', ticket_type: 'problem', created_by: 7, assigned_to: 6, department_id: 1 },
  { title: 'Invoice #2847 discrepancy', description: 'The amount on invoice #2847 does not match the purchase order. Need finance to investigate the discrepancy.', status: 'in_progress', priority: 'medium', category: 'Billing', ticket_type: 'incident', created_by: 3, assigned_to: 11, department_id: 3 },
  { title: 'Annual security audit preparation', description: 'Preparing documentation and system access logs for the upcoming annual security audit scheduled for next month.', status: 'open', priority: 'high', category: 'Access', ticket_type: 'change', created_by: 2, assigned_to: 10, department_id: 2 },
  { title: 'USB ports not working after update', description: 'After the latest Windows update, all USB ports on my laptop stopped working. External devices are not detected.', status: 'open', priority: 'high', category: 'Hardware', ticket_type: 'incident', created_by: 9, assigned_to: 4, department_id: 1 },
];

const COMMENTS = [
  { ticket_id: 1, user_id: 4, content: 'I have diagnosed the issue. It appears to be a loose display cable connection. I will schedule a hardware replacement.' },
  { ticket_id: 1, user_id: 5, content: 'Thank you for the quick response. When can I expect the replacement?' },
  { ticket_id: 2, user_id: 2, content: 'Access request received. I am verifying with your manager and will provision the account shortly.' },
  { ticket_id: 3, user_id: 6, content: 'We are investigating a potential issue with the VPN gateway. A patch is being tested.' },
  { ticket_id: 6, user_id: 6, content: 'This is a known issue affecting the ActiveSync service. We are working on a fix.' },
  { ticket_id: 10, user_id: 6, content: 'Network monitoring shows bandwidth saturation on the main switch. We are adding a secondary link.' },
  { ticket_id: 12, user_id: 2, content: 'The backup failed due to insufficient disk space on the backup server. I am clearing old backups now.' },
  { ticket_id: 14, user_id: 6, content: 'Firewall rule has been created and tested. The payment gateway is now accessible.' },
  { ticket_id: 18, user_id: 11, content: 'I found the discrepancy. There was a duplicate line item in the invoice. Corrected version has been sent.' },
  { ticket_id: 19, user_id: 10, content: 'All documentation has been prepared and access logs have been compiled for the auditors.' },
];

const ACTIVITIES = [
  { ticket_id: 1, user_id: 5, action: 'Ticket created' },
  { ticket_id: 1, user_id: 4, action: 'Status changed to in_progress' },
  { ticket_id: 2, user_id: 5, action: 'Ticket created' },
  { ticket_id: 2, user_id: 2, action: 'Assigned to Marcus Johnson' },
  { ticket_id: 3, user_id: 9, action: 'Ticket created' },
  { ticket_id: 6, user_id: 1, action: 'Ticket created' },
  { ticket_id: 6, user_id: 6, action: 'Status changed to in_progress' },
  { ticket_id: 9, user_id: 12, action: 'Ticket created' },
  { ticket_id: 9, user_id: 2, action: 'Status changed to resolved' },
  { ticket_id: 12, user_id: 1, action: 'Ticket created' },
];

const KNOWLEDGE_ARTICLES = [
  { title: 'How to Reset Your Password', content: '# How to Reset Your Password\n\n## Step 1: Access the Portal\nNavigate to the login page and click on **Forgot Password**.\n\n## Step 2: Enter Your Email\nType in your company email address and click **Submit**.\n\n## Step 3: Check Your Inbox\nYou will receive a password reset link within 5 minutes.\n\n## Step 4: Create New Password\nChoose a strong password with at least 8 characters.\n\n> **Tip:** Use a combination of uppercase, lowercase, numbers, and symbols.\n\nIf you do not receive the email, contact IT Support.', category: 'Access', tags: 'password,security,login', author_id: 2, views: 342 },
  { title: 'VPN Setup Guide for Remote Work', content: '# VPN Setup Guide\n\n## Prerequisites\n- Company laptop with admin rights\n- VPN client installed\n- Valid employee credentials\n\n## Installation Steps\n1. Download the VPN client from the IT portal\n2. Run the installer as Administrator\n3. Enter the server address: `vpn.company.com`\n4. Authenticate with your domain credentials\n\n## Troubleshooting\n- If connection drops, try switching to UDP protocol\n- For slow speeds, select a different server region\n- Contact IT if you see error code **0x800704CF**', category: 'Network', tags: 'vpn,remote,connectivity', author_id: 6, views: 521 },
  { title: 'Printer Not Working? Here is What to Do', content: '# Printer Troubleshooting\n\n## Quick Checks\n- Ensure the printer is powered on\n- Check cable connections\n- Verify you are on the correct network\n\n## Common Solutions\n1. **Restart the printer** - Turn off, wait 10 seconds, turn on\n2. **Clear print queue** - Open printer settings and cancel pending jobs\n3. **Update drivers** - Download latest drivers from manufacturer website\n\n## Still Not Working?\nSubmit a ticket with the printer model number and error code displayed on the screen.', category: 'Hardware', tags: 'printer,hardware,troubleshooting', author_id: 4, views: 198 },
  { title: 'Understanding Software Licensing', content: '# Software Licensing Guide\n\n## License Types\n- **Individual** - Assigned to one user\n- **Shared** - Pool of licenses for teams\n- **Enterprise** - Company-wide access\n\n## How to Request\n1. Fill out the Software Request Form\n2. Get manager approval\n3. Finance will process the purchase\n\n## Renewals\nLicenses expire annually. You will receive a reminder 30 days before expiration.', category: 'Software', tags: 'licensing,software,purchase', author_id: 11, views: 87 },
  { title: 'Wi-Fi Connection Issues? Try These Steps', content: '# Wi-Fi Troubleshooting\n\n## Basic Steps\n1. Toggle Wi-Fi off and on\n2. Forget the network and reconnect\n3. Restart your device\n\n## Advanced\n- Check if the issue is location-specific\n- Update your wireless adapter drivers\n- Try connecting to the guest network as a test\n\n## Report\nIf issues persist, note your location and device MAC address when submitting a ticket.', category: 'Network', tags: 'wifi,network,troubleshooting', author_id: 6, views: 276 },
  { title: 'How to Request Hardware Upgrades', content: '# Hardware Upgrade Requests\n\n## Eligibility\nEmployees are eligible for hardware upgrades every 3 years.\n\n## Process\n1. Complete the Hardware Request Form\n2. Attach justification (performance metrics, doctor note, etc.)\n3. Manager approval required\n\n## Standard Equipment\n- Laptop: ThinkPad T14 or equivalent\n- Monitor: 27-inch 4K display\n- Accessories: Keyboard, mouse, headset\n\n## Timeline\nRequests are processed within 5-7 business days.', category: 'Hardware', tags: 'hardware,equipment,upgrade', author_id: 3, views: 154 },
  { title: 'Two-Factor Authentication Setup', content: '# 2FA Setup Guide\n\n## Why 2FA?\nTwo-factor authentication adds an extra layer of security to your account.\n\n## Setup Steps\n1. Go to **Settings > Security**\n2. Click **Enable 2FA**\n3. Scan the QR code with your authenticator app\n4. Enter the 6-digit code to verify\n\n## Supported Apps\n- Google Authenticator\n- Microsoft Authenticator\n- Authy\n\n## Recovery\nSave your backup codes in a secure location. If you lose your phone, contact IT immediately.', category: 'Access', tags: '2fa,security,authentication', author_id: 2, views: 410 },
  { title: 'Common Network Error Codes', content: '# Network Error Codes Reference\n\n| Code | Meaning | Solution |\n|------|---------|----------|\n| 0x800704CF | Network location not found | Check VPN connection |\n| DNS_PROBE | DNS resolution failed | Flush DNS cache |\n| TIMEOUT | Connection timed out | Check firewall settings |\n| 403 | Access forbidden | Contact IT for permissions |\n\n## Quick Fix\nMost network issues can be resolved by restarting your network adapter or reconnecting to VPN.', category: 'Network', tags: 'network,errors,reference', author_id: 6, views: 633 },
  { title: 'Email Signature Standards', content: '# Company Email Signature Policy\n\n## Required Elements\n- Full name\n- Job title\n- Department\n- Direct phone number\n- Company logo\n\n## Format\n```\nJohn Doe | Senior Developer | IT Department\nDirect: +1-555-0100 | Main: +1-555-0000\n```\n\n## Notes\n- Keep signatures under 6 lines\n- Do not use animated images\n- Social media links are optional\n\nContact Marketing for the latest logo assets.', category: 'General', tags: 'email,branding,policy', author_id: 3, views: 122 },
  { title: 'Data Backup Best Practices', content: '# Backup Best Practices\n\n## The 3-2-1 Rule\n- **3** copies of important data\n- **2** different storage media\n- **1** offsite backup\n\n## Company Policy\n- All work files must be stored on OneDrive\n- Local copies should be synced daily\n- Sensitive data requires encryption\n\n## Recovery\nIf you accidentally delete a file, check the OneDrive recycle bin first. Files are retained for 93 days.', category: 'Software', tags: 'backup,data,recovery', author_id: 2, views: 289 },
  { title: 'Office Ergonomics Guide', content: '# Ergonomics at Work\n\n## Chair Setup\n- Adjust seat height so feet rest flat on floor\n- Lumbar support should fit the curve of your lower back\n- Armrests at elbow height\n\n## Monitor Position\n- Top of screen at or slightly below eye level\n- Distance: 20-30 inches from your face\n- Reduce glare with proper lighting\n\n## Break Reminders\nFollow the 20-20-20 rule: Every 20 minutes, look at something 20 feet away for 20 seconds.\n\nRequest an ergonomic assessment through the Facilities team.', category: 'General', tags: 'ergonomics,health,facilities', author_id: 8, views: 175 },
  { title: 'Understanding Invoice Discrepancies', content: '# Invoice Troubleshooting\n\n## Common Issues\n1. **Duplicate charges** - Same item billed twice\n2. **Wrong quantity** - Ordered 10, billed for 100\n3. **Missing discount** - Promotional rate not applied\n\n## Resolution Steps\n1. Compare invoice to purchase order\n2. Note discrepancies with line item numbers\n3. Submit a ticket to Finance with supporting documents\n\n## Timeline\nMost discrepancies are resolved within 3-5 business days.', category: 'Billing', tags: 'invoice,billing,finance', author_id: 11, views: 94 },
  { title: 'Conference Room Booking Guide', content: '# How to Book a Conference Room\n\n## Via Outlook\n1. Create a new calendar event\n2. Click **Add Room**\n3. Select the desired room\n4. Check availability in the scheduling assistant\n\n## Available Rooms\n- Room A (8 people)\n- Room B (12 people, with AV)\n- Room C (4 people, huddle room)\n\n## Rules\n- Book maximum 2 hours during peak times\n- Cancel if no longer needed\n- Clean up after your meeting', category: 'General', tags: 'meeting,booking,facilities', author_id: 8, views: 211 },
  { title: 'Cybersecurity Awareness: Phishing', content: '# Phishing Awareness\n\n## What is Phishing?\nPhishing is a cyberattack that uses disguised email to trick recipients into giving away sensitive information.\n\n## Red Flags\n- Urgent language ("Act now!", "Account suspended!")\n- Suspicious sender address\n- Unexpected attachments\n- Requests for passwords or financial info\n\n## What To Do\n1. Do NOT click links or download attachments\n2. Report using the **Report Phishing** button\n3. Delete the email\n\nWhen in doubt, contact the Security team.', category: 'Access', tags: 'security,phishing,awareness', author_id: 10, views: 445 },
  { title: 'How to Connect to the Guest Wi-Fi', content: '# Guest Wi-Fi Access\n\n## Network Name\n`Company-Guest`\n\n## Password\nAsk Reception for the daily password.\n\n## Limitations\n- No access to internal resources\n- Bandwidth limited to 10 Mbps\n- Session expires after 8 hours\n\n## For Employees\nUse the corporate Wi-Fi (`Company-Secure`) with your domain credentials instead.', category: 'Network', tags: 'wifi,guest,access', author_id: 6, views: 367 },
];

const SLA_POLICIES = [
  { name: 'Critical Incident', priority: 'critical', response_time: 15, resolution_time: 240, business_hours: 1, is_active: 1 },
  { name: 'High Priority', priority: 'high', response_time: 60, resolution_time: 480, business_hours: 1, is_active: 1 },
  { name: 'Medium Priority', priority: 'medium', response_time: 240, resolution_time: 1440, business_hours: 1, is_active: 1 },
  { name: 'Low Priority', priority: 'low', response_time: 480, resolution_time: 2880, business_hours: 1, is_active: 1 },
  { name: 'After Hours Critical', priority: 'critical', response_time: 30, resolution_time: 480, business_hours: 0, is_active: 1 },
];

const CANNED_RESPONSES = [
  { title: 'Acknowledge Receipt', content: 'Thank you for contacting IT Support. We have received your request and are reviewing it. You will receive an update shortly.', category: 'General', created_by: 2, is_shared: 1 },
  { title: 'Password Reset Instructions', content: 'To reset your password:\n1. Go to the login page\n2. Click "Forgot Password"\n3. Enter your email address\n4. Follow the instructions in the email\n\nIf you do not receive the email within 5 minutes, check your spam folder or contact us.', category: 'Access', created_by: 2, is_shared: 1 },
  { title: 'VPN Troubleshooting', content: 'If you are experiencing VPN issues:\n1. Ensure you are using the latest VPN client\n2. Try switching between TCP and UDP protocols\n3. Restart the VPN service\n4. Check your internet connection\n\nIf the problem persists, please provide the error code you are seeing.', category: 'Network', created_by: 6, is_shared: 1 },
  { title: 'Escalated to Level 2', content: 'Your ticket has been escalated to our Level 2 support team. A specialist will be assigned to your case and will contact you within 4 business hours.', category: 'General', created_by: 4, is_shared: 1 },
  { title: 'Hardware Replacement Scheduled', content: 'We have approved your hardware replacement request. The new equipment will be delivered to your desk within 3-5 business days. You will receive a separate notification once it arrives.', category: 'Hardware', created_by: 4, is_shared: 1 },
  { title: 'Ticket Resolved - Confirmation', content: 'We believe this issue has been resolved. Please confirm by replying to this ticket within 48 hours. If we do not hear from you, the ticket will be automatically closed.', category: 'General', created_by: 2, is_shared: 1 },
  { title: 'Out of Office Handoff', content: 'I am currently out of the office. Your ticket has been reassigned to a colleague who will assist you. For urgent matters, please call the IT hotline at ext. 9999.', category: 'General', created_by: 4, is_shared: 1 },
  { title: 'Software Installation Approved', content: 'Your software installation request has been approved. The software will be pushed to your device via our management system within 24 hours. You may need to restart your computer.', category: 'Software', created_by: 2, is_shared: 1 },
  { title: 'Security Incident Reported', content: 'Thank you for reporting this security concern. Our security team has been notified and will investigate. Please do not delete any related emails or files until the investigation is complete.', category: 'Access', created_by: 10, is_shared: 1 },
  { title: 'Billing Dispute Received', content: 'We have received your billing inquiry and are reviewing the details. Our finance team will get back to you within 2 business days with a resolution.', category: 'Billing', created_by: 11, is_shared: 1 },
];

const ANNOUNCEMENTS = [
  { title: 'Scheduled Network Maintenance', content: 'The corporate network will undergo scheduled maintenance this Saturday from 2:00 AM to 6:00 AM EST. VPN and internal systems may be unavailable during this window.', type: 'warning', target_roles: 'admin,agent,manager,customer', is_active: 1, published_at: '2026-05-20T10:00:00Z', expires_at: '2026-05-24T06:00:00Z' },
  { title: 'New IT Support Portal Launched', content: 'We are excited to announce the launch of our new IT Support Portal powered by VedaDesk. The portal features a knowledge base, ticket tracking, and self-service options.', type: 'info', target_roles: 'admin,agent,manager,customer', is_active: 1, published_at: '2026-05-18T09:00:00Z', expires_at: '2026-06-18T09:00:00Z' },
  { title: 'Cybersecurity Training Mandatory', content: 'All employees must complete the annual cybersecurity awareness training by June 30th. Access the training module through the Learning Management System.', type: 'alert', target_roles: 'admin,agent,manager,customer', is_active: 1, published_at: '2026-05-15T08:00:00Z', expires_at: '2026-06-30T23:59:00Z' },
];

const CSAT_RATINGS = [
  { ticket_id: 9, user_id: 12, rating: 5, comment: 'Very quick resolution, thank you!' },
  { ticket_id: 3, user_id: 9, rating: 3, comment: 'Issue is still happening intermittently.' },
  { ticket_id: 5, user_id: 3, rating: 4, comment: 'Good communication throughout the process.' },
  { ticket_id: 14, user_id: 10, rating: 5, comment: 'Excellent work, firewall rule is working perfectly.' },
  { ticket_id: 7, user_id: 7, rating: 2, comment: 'Took longer than expected to process.' },
  { ticket_id: 18, user_id: 3, rating: 4, comment: 'Finance team was very helpful.' },
  { ticket_id: 1, user_id: 5, rating: 4, comment: 'Technician was professional and thorough.' },
  { ticket_id: 10, user_id: 4, rating: 3, comment: 'Partial improvement, still monitoring.' },
];

const SERVICE_CATALOG = [
  { name: 'New Laptop Request', description: 'Request a new laptop for new hires or hardware refresh. Includes standard software pre-installation.', category: 'Hardware', form_template: '{"fields":[{"name":"justification","type":"textarea","label":"Business Justification","required":true},{"name":"start_date","type":"date","label":"Employee Start Date","required":true}]}', approval_workflow: 'manager,it', icon: 'Monitor' },
  { name: 'Software Installation', description: 'Request installation of approved software on your company device.', category: 'Software', form_template: '{"fields":[{"name":"software_name","type":"text","label":"Software Name","required":true},{"name":"license_type","type":"select","label":"License Type","options":["Individual","Shared","Enterprise"],"required":true}]}', approval_workflow: 'manager', icon: 'Code' },
  { name: 'VPN Access Request', description: 'Request VPN access for remote work or travel.', category: 'Network', form_template: '{"fields":[{"name":"access_type","type":"select","label":"Access Type","options":["Full-Time Remote","Travel","Temporary"],"required":true},{"name":"duration","type":"text","label":"Duration (if temporary)","required":false}]}', approval_workflow: 'manager,it', icon: 'Wifi' },
  { name: 'Account Unlock', description: 'Unlock your account after too many failed login attempts.', category: 'Access', form_template: '{"fields":[{"name":"username","type":"text","label":"Username","required":true},{"name":"contact_method","type":"select","label":"Preferred Contact","options":["Email","Phone","Slack"],"required":true}]}', approval_workflow: 'auto', icon: 'Lock' },
  { name: 'Conference Room AV Support', description: 'Request AV equipment setup or technical support for meetings.', category: 'Facilities', form_template: '{"fields":[{"name":"room","type":"text","label":"Room Number","required":true},{"name":"meeting_time","type":"datetime","label":"Meeting Time","required":true}]}', approval_workflow: 'auto', icon: 'Monitor' },
  { name: 'Email Distribution List', description: 'Create or modify an email distribution list.', category: 'General', form_template: '{"fields":[{"name":"list_name","type":"text","label":"List Name","required":true},{"name":"members","type":"textarea","label":"Member Emails (one per line)","required":true}]}', approval_workflow: 'manager', icon: 'Mail' },
];

/* ------------------------------------------------------------------ */
/*  Step Definitions                                                   */
/* ------------------------------------------------------------------ */

interface StepDef {
  id: string;
  label: string;
  icon: ComponentType<LucideProps>;
  type: 'schema' | 'seed';
  count?: number;
}

const STEPS: StepDef[] = [
  { id: 'schema', label: 'Create Tables', icon: Table2, type: 'schema', count: TABLES_SQL.length },
  { id: 'departments', label: 'Seed Departments', icon: Shield, type: 'seed', count: DEPARTMENTS.length },
  { id: 'users', label: 'Seed Users', icon: Users, type: 'seed', count: USERS.length },
  { id: 'categories', label: 'Seed Categories', icon: Settings, type: 'seed', count: CATEGORIES.length },
  { id: 'tickets', label: 'Seed Tickets', icon: Ticket, type: 'seed', count: TICKETS.length },
  { id: 'comments', label: 'Seed Comments', icon: BookOpen, type: 'seed', count: COMMENTS.length },
  { id: 'activities', label: 'Seed Activities', icon: Activity, type: 'seed', count: ACTIVITIES.length },
  { id: 'articles', label: 'Seed Knowledge Articles', icon: BookOpen, type: 'seed', count: KNOWLEDGE_ARTICLES.length },
  { id: 'sla', label: 'Seed SLA Policies', icon: Shield, type: 'seed', count: SLA_POLICIES.length },
  { id: 'canned', label: 'Seed Canned Responses', icon: MessageSquare, type: 'seed', count: CANNED_RESPONSES.length },
  { id: 'announcements', label: 'Seed Announcements', icon: Bell, type: 'seed', count: ANNOUNCEMENTS.length },
  { id: 'csat', label: 'Seed CSAT Ratings', icon: Star, type: 'seed', count: CSAT_RATINGS.length },
  { id: 'catalog', label: 'Seed Service Catalog', icon: Settings, type: 'seed', count: SERVICE_CATALOG.length },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

type StepState = 'pending' | 'running' | 'done' | 'error';

interface StepStatus {
  id: string;
  state: StepState;
  message?: string;
}

export default function DBSetup() {
  const navigate = useNavigate();
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({});
  const [overallState, setOverallState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [, setCurrentStepIndex] = useState(-1);
  const [log, setLog] = useState<string[]>([]);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const setStep = useCallback((id: string, state: StepState, message?: string) => {
    setStepStatuses((prev) => ({ ...prev, [id]: { id, state, message } }));
  }, []);

  /* Test connection */
  const handleTestConnection = async () => {
    setTestState('testing');
    addLog('Testing connection to VedaDB...');
    try {
      const ok = await vedaTestConnection();
      if (ok) {
        setTestState('ok');
        addLog('Connection successful!');
      } else {
        setTestState('fail');
        addLog('Connection failed. Check API URL and try again.');
      }
    } catch (err: any) {
      setTestState('fail');
      addLog(`Connection error: ${err.message || 'Unknown error'}`);
    }
  };

  /* Execute schema */
  const runSchema = async () => {
    setStep('schema', 'running');
    addLog('Creating tables...');
    try {
      for (let i = 0; i < TABLES_SQL.length; i++) {
        const sql = TABLES_SQL[i];
        const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] || `table_${i}`;
        addLog(`  Creating ${tableName}...`);
        await vedaExec(sql);
        addLog(`  ${tableName} OK`);
      }
      setStep('schema', 'done', `${TABLES_SQL.length} tables created`);
      addLog('All tables created successfully!');
    } catch (err: any) {
      setStep('schema', 'error', err.message);
      addLog(`ERROR creating tables: ${err.message}`);
      throw err;
    }
  };

  /* Seed helpers */
  const seedTable = async (stepId: string, table: string, rows: Record<string, string | number>[]) => {
    setStep(stepId, 'running');
    addLog(`Seeding ${table}...`);
    try {
      for (const row of rows) {
        await vedaInsert(table, Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, String(v)])
        ));
      }
      setStep(stepId, 'done', `${rows.length} rows inserted`);
      addLog(`${table}: ${rows.length} rows inserted`);
    } catch (err: any) {
      setStep(stepId, 'error', err.message);
      addLog(`ERROR seeding ${table}: ${err.message}`);
      throw err;
    }
  };

  /* Run all */
  const runSetup = async () => {
    setOverallState('running');
    setLog([]);
    setStepStatuses({});
    setCurrentStepIndex(0);

    try {
      // Schema
      await runSchema();
      setCurrentStepIndex(1);

      // Seed departments
      await seedTable('departments', 'departments', DEPARTMENTS as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(2);

      // Seed users
      await seedTable('users', 'users', USERS as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(3);

      // Seed categories
      await seedTable('categories', 'categories', CATEGORIES as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(4);

      // Seed tickets
      await seedTable('tickets', 'tickets', TICKETS as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(5);

      // Seed comments
      await seedTable('comments', 'comments', COMMENTS as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(6);

      // Seed activities
      await seedTable('activities', 'activities', ACTIVITIES as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(7);

      // Seed knowledge articles
      await seedTable('articles', 'knowledge_articles', KNOWLEDGE_ARTICLES as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(8);

      // Seed SLA policies
      await seedTable('sla', 'sla_policies', SLA_POLICIES as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(9);

      // Seed canned responses
      await seedTable('canned', 'canned_responses', CANNED_RESPONSES as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(10);

      // Seed announcements
      await seedTable('announcements', 'announcements', ANNOUNCEMENTS as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(11);

      // Seed CSAT ratings
      await seedTable('csat', 'csat_ratings', CSAT_RATINGS as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(12);

      // Seed service catalog
      await seedTable('catalog', 'service_catalog', SERVICE_CATALOG as unknown as Record<string, string | number>[]);
      setCurrentStepIndex(13);

      setOverallState('done');
      addLog('Setup complete! All tables created and seeded.');
    } catch (err: any) {
      setOverallState('error');
      addLog(`SETUP FAILED: ${err.message}`);
    }
  };

  const totalSteps = STEPS.length;
  const doneSteps = Object.values(stepStatuses).filter((s) => s.state === 'done').length;
  const progressPercent = overallState === 'idle' ? 0 : Math.round((doneSteps / totalSteps) * 100);

  return (
    <div className="min-h-screen bg-[#fbf9f4]">
      {/* Header */}
      <div className="border-b border-[#e5e0d5] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[#595959] transition-colors hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <div className="h-5 w-px bg-[#e5e0d5]" />
            <div className="flex items-center gap-2">
              <Database size={20} className="text-[#c9a87c]" />
              <h1 className="text-lg font-semibold text-[#1f1f1f]">Database Setup</h1>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Intro */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h2 className="text-2xl font-medium text-[#1f1f1f]">Initialize VedaDesk Database</h2>
          <p className="mt-2 text-sm text-[#595959]">
            This will create all required tables and seed them with demo data.
            Make sure your VedaDB server is running before proceeding.
          </p>
        </motion.div>

        {/* Connection Test */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8 rounded-xl border border-[#e5e0d5] bg-white p-6"
        >
          <h3 className="mb-3 text-sm font-medium text-[#1f1f1f]">Step 0: Test Connection</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestConnection}
              disabled={testState === 'testing'}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all',
                testState === 'idle' && 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95',
                testState === 'testing' && 'bg-[#e5e0d5] text-[#8a8a8a] cursor-not-allowed',
                testState === 'ok' && 'bg-[#52c41a] text-white',
                testState === 'fail' && 'bg-[#f5222d] text-white',
              )}
            >
              {testState === 'idle' && <PlugIcon size={16} />}
              {testState === 'testing' && <Loader2 size={16} className="animate-spin" />}
              {testState === 'ok' && <CheckCircle2 size={16} />}
              {testState === 'fail' && <XCircle size={16} />}
              {testState === 'idle' && 'Test Connection'}
              {testState === 'testing' && 'Testing...'}
              {testState === 'ok' && 'Connected'}
              {testState === 'fail' && 'Connection Failed'}
            </button>
            {testState === 'ok' && (
              <span className="text-sm text-[#52c41a]">VedaDB is reachable. Ready to proceed.</span>
            )}
            {testState === 'fail' && (
              <span className="text-sm text-[#f5222d]">
                Cannot connect. Check that VedaDB is running on the configured API URL.
              </span>
            )}
          </div>
        </motion.div>

        {/* Progress Bar */}
        {overallState !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-6"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-[#1f1f1f]">Progress</span>
              <span className="text-sm text-[#595959]">{doneSteps}/{totalSteps} steps</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#e5e0d5]">
              <motion.div
                className={cn(
                  'h-full rounded-full transition-colors',
                  overallState === 'error' ? 'bg-[#f5222d]' : 'bg-[#c9a87c]',
                )}
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="mt-1 text-xs text-[#8a8a8a]">{progressPercent}% complete</p>
          </motion.div>
        )}

        {/* Step Grid */}
        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {STEPS.map((step, idx) => {
            const status = stepStatuses[step.id];
            const state: StepState = status?.state || 'pending';
            const StepIcon = step.icon;

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * idx }}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-4 transition-all',
                  state === 'pending' && 'border-[#e5e0d5] bg-white',
                  state === 'running' && 'border-[#c9a87c] bg-[rgba(201,168,124,0.05)]',
                  state === 'done' && 'border-[#52c41a] bg-[#f6ffed]',
                  state === 'error' && 'border-[#f5222d] bg-[#fff1f0]',
                )}
              >
                <div className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  state === 'pending' && 'bg-[#f5f0e8] text-[#8a8a8a]',
                  state === 'running' && 'bg-[rgba(201,168,124,0.15)] text-[#c9a87c]',
                  state === 'done' && 'bg-[rgba(82,196,26,0.15)] text-[#52c41a]',
                  state === 'error' && 'bg-[rgba(245,34,45,0.15)] text-[#f5222d]',
                )}>
                  {state === 'running' ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : state === 'done' ? (
                    <CheckCircle2 size={18} />
                  ) : state === 'error' ? (
                    <XCircle size={18} />
                  ) : (
                    <StepIcon size={18} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#1f1f1f]">{step.label}</p>
                  {step.count && (
                    <p className="text-xs text-[#8a8a8a]">{step.count} items</p>
                  )}
                  {status?.message && (
                    <p className={cn(
                      'text-xs',
                      state === 'error' ? 'text-[#f5222d]' : 'text-[#52c41a]',
                    )}>
                      {status.message}
                    </p>
                  )}
                </div>
                {state === 'running' && (
                  <ChevronRight size={16} className="animate-pulse text-[#c9a87c]" />
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="mb-8 flex items-center gap-3">
          {overallState === 'idle' || overallState === 'error' ? (
            <button
              onClick={runSetup}
              disabled={testState !== 'ok'}
              className={cn(
                'flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-bold transition-all',
                testState === 'ok'
                  ? 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95 active:scale-[0.98]'
                  : 'cursor-not-allowed bg-[#e5e0d5] text-[#8a8a8a]',
              )}
            >
              <Play size={18} />
              {overallState === 'error' ? 'Retry Setup' : 'Run Database Setup'}
            </button>
          ) : overallState === 'done' ? (
            <button
              onClick={() => navigate('/login')}
              className="flex items-center gap-2 rounded-lg bg-[#52c41a] px-6 py-3 text-sm font-bold text-white transition-all hover:brightness-95 active:scale-[0.98]"
            >
              <CheckCircle2 size={18} />
              Go to Login
            </button>
          ) : (
            <button
              disabled
              className="flex items-center gap-2 rounded-lg bg-[#e5e0d5] px-6 py-3 text-sm font-bold text-[#8a8a8a] cursor-not-allowed"
            >
              <Loader2 size={18} className="animate-spin" />
              Setting up...
            </button>
          )}

          {overallState === 'done' && (
            <button
              onClick={runSetup}
              className="flex items-center gap-2 rounded-lg border border-[#e5e0d5] bg-white px-4 py-3 text-sm font-medium text-[#595959] transition-all hover:bg-[#f5f0e8]"
            >
              <RotateCcw size={16} />
              Run Again
            </button>
          )}
        </div>

        {/* Log */}
        {log.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="rounded-xl border border-[#e5e0d5] bg-[#1f1f1f] p-4"
          >
            <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-[#8a8a8a]">
              Execution Log
            </h3>
            <div className="max-h-64 overflow-y-auto space-y-1 font-mono text-xs">
              {log.map((entry, i) => (
                <p
                  key={i}
                  className={cn(
                    'break-all',
                    entry.includes('ERROR') || entry.includes('FAIL')
                      ? 'text-[#f5222d]'
                      : entry.includes('OK') || entry.includes('success')
                      ? 'text-[#52c41a]'
                      : 'text-[#d4d4d4]',
                  )}
                >
                  {entry}
                </p>
              ))}
            </div>
          </motion.div>
        )}

        {/* Success banner */}
        {overallState === 'done' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-xl border border-[#52c41a] bg-[#f6ffed] p-4 text-center"
          >
            <CheckCircle2 size={24} className="mx-auto mb-2 text-[#52c41a]" />
            <p className="text-sm font-medium text-[#1f1f1f]">
              Database setup complete!
            </p>
            <p className="mt-1 text-xs text-[#595959]">
              {DEPARTMENTS.length} departments, {USERS.length} users, {TICKETS.length} tickets, and more have been seeded.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95"
            >
              Continue to Login
              <ChevronRight size={16} />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* Plug icon inline */
function PlugIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 16} height={size || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 22v-5"/><path d="M15 8V2"/><path d="M9 8V2"/><path d="M15 8a5 5 0 0 1-5 5 5 5 0 0 1-5-5h10Z"/></svg>
  );
}
