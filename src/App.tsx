import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import useAppStore from '@/lib/vedadb-store';
import { useEffect } from 'react';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Tickets from '@/pages/Tickets';
import TicketDetail from '@/pages/TicketDetail';
import Users from '@/pages/Users';
import KnowledgeBase from '@/pages/KnowledgeBase';
import KnowledgeArticle from '@/pages/KnowledgeArticle';
import Settings from '@/pages/Settings';
import DBSetup from '@/pages/DBSetup';
import { Role, Permission, hasAnyPermission, hasRoleLevel } from '@/lib/rbac';

/* RBAC feature pages */
import SLADashboard from '@/pages/rbac/SLADashboard';
import ReportsDashboard from '@/pages/rbac/ReportsDashboard';
import AuditLogs from '@/pages/rbac/AuditLogs';
import Announcements from '@/pages/rbac/Announcements';
import Departments from '@/pages/rbac/Departments';
import AutomationRules from '@/pages/rbac/AutomationRules';
import CannedResponses from '@/pages/rbac/CannedResponses';
import ServiceCatalog from '@/pages/rbac/ServiceCatalog';
import CSATDashboard from '@/pages/rbac/CSATDashboard';
import TimeTracking from '@/pages/rbac/TimeTracking';

/* Advanced Ticket Management */
import TicketTemplates from '@/pages/advanced/TicketTemplates';
import TicketLinks from '@/pages/advanced/TicketLinks';
import TicketWatchers from '@/pages/advanced/TicketWatchers';
import EscalationPaths from '@/pages/advanced/EscalationPaths';
import RecurringTickets from '@/pages/advanced/RecurringTickets';

/* Asset + Change + Problem Management */
import AssetInventory from '@/pages/advanced/AssetInventory';
import AssetDetail from '@/pages/advanced/AssetDetail';
import SoftwareLicenses from '@/pages/advanced/SoftwareLicenses';
import ChangeDashboard from '@/pages/advanced/ChangeDashboard';
import KEDB from '@/pages/advanced/KEDB';
import ProblemManagement from '@/pages/advanced/ProblemManagement';
import MajorIncidents from '@/pages/advanced/MajorIncidents';

/* Communication + Collaboration */
import EmailTemplates from '@/pages/advanced/EmailTemplates';
import SMSSettings from '@/pages/advanced/SMSSettings';
import Integrations from '@/pages/advanced/Integrations';
import NotificationPrefs from '@/pages/advanced/NotificationPrefs';
import CommunicationHistory from '@/pages/advanced/CommunicationHistory';

/* Advanced RBAC + Security + Portal Admin */
import CustomRoles from '@/pages/advanced/CustomRoles';
import SSOConfig from '@/pages/advanced/SSOConfig';
import MFASetup from '@/pages/advanced/MFASetup';
import IPRestrictions from '@/pages/advanced/IPRestrictions';
import BrandingEditor from '@/pages/advanced/BrandingEditor';
import APIManagement from '@/pages/advanced/APIManagement';
import PortalAdmin from '@/pages/advanced/PortalAdmin';

/* Workflow + Reporting + Integrations */
import WorkflowBuilder from '@/pages/advanced/WorkflowBuilder';
import ApprovalChains from '@/pages/advanced/ApprovalChains';
import WebhookConfig from '@/pages/advanced/WebhookConfig';
import ReportBuilder from '@/pages/advanced/ReportBuilder';
import ScheduledReports from '@/pages/advanced/ScheduledReports';
import APIDocs from '@/pages/advanced/APIDocs';
import AppMarketplace from '@/pages/advanced/AppMarketplace';

/* Self-Service Portal + AI Features */
import CustomerPortal from '@/pages/advanced/CustomerPortal';
import LiveChat from '@/pages/advanced/LiveChat';
import ChatbotConfig from '@/pages/advanced/ChatbotConfig';
import MultiLanguage from '@/pages/advanced/MultiLanguage';
import AIDashboard from '@/pages/advanced/AIDashboard';
import SentimentDashboard from '@/pages/advanced/SentimentDashboard';
import SmartRouting from '@/pages/advanced/SmartRouting';

/* ------------------------------------------------------------------ */
/*  Route-level RBAC protection                                       */
/* ------------------------------------------------------------------ */

const ROUTE_ACCESS: Record<string, { minRole?: Role; anyPerm?: Permission[] }> = {
  '/dashboard':     { minRole: Role.AGENT },
  '/tickets':       {},
  '/users':         { minRole: Role.AGENT },
  '/knowledge':     {},
  '/settings':      { anyPerm: [Permission.SETTINGS_MANAGE] },
  '/sla':           { anyPerm: [Permission.SLA_VIEW, Permission.SLA_MANAGE] },
  '/reports':       { anyPerm: [Permission.REPORT_VIEW_ALL, Permission.REPORT_VIEW_OWN] },
  '/audit':         { anyPerm: [Permission.AUDIT_VIEW] },
  '/announcements': { anyPerm: [Permission.ANNOUNCEMENT_MANAGE] },
  '/departments':   { anyPerm: [Permission.DEPARTMENT_MANAGE] },
  '/automation':    { anyPerm: [Permission.AUTOMATION_MANAGE] },
  '/canned':        { anyPerm: [Permission.CANNED_MANAGE] },
  '/catalog':       {},
  '/csat':                { anyPerm: [Permission.CSAT_VIEW] },
  '/time-entries':        { anyPerm: [Permission.REPORT_VIEW_OWN, Permission.REPORT_VIEW_ALL] },
  /* Advanced Ticket Management */
  '/ticket-templates':    { minRole: Role.AGENT },
  '/ticket-links':        { minRole: Role.AGENT },
  '/ticket-watchers':     { minRole: Role.AGENT },
  '/escalation-paths':    { minRole: Role.MANAGER },
  '/recurring-tickets':   { minRole: Role.MANAGER },
  /* Asset + Change + Problem */
  '/assets':              { minRole: Role.AGENT },
  '/software-licenses':   { minRole: Role.AGENT },
  '/changes':             { minRole: Role.MANAGER },
  '/kedb':                { minRole: Role.AGENT },
  '/problems':            { minRole: Role.MANAGER },
  '/major-incidents':     { minRole: Role.MANAGER },
  /* Communication */
  '/email-templates':     { minRole: Role.ADMIN },
  '/sms-settings':        { minRole: Role.ADMIN },
  '/integrations':        { minRole: Role.ADMIN },
  '/notification-preferences': {},
  '/communication-history': { minRole: Role.AGENT },
  /* RBAC + Security + Portal Admin */
  '/custom-roles':        { minRole: Role.ADMIN },
  '/sso-config':          { minRole: Role.ADMIN },
  '/mfa-setup':           { minRole: Role.ADMIN },
  '/ip-restrictions':     { minRole: Role.ADMIN },
  '/branding':            { minRole: Role.ADMIN },
  '/api-management':      { minRole: Role.ADMIN },
  '/portal-admin':        { minRole: Role.ADMIN },
  /* Workflow + Reporting */
  '/workflow-builder':    { minRole: Role.MANAGER },
  '/approval-chains':     { minRole: Role.MANAGER },
  '/webhooks':            { minRole: Role.ADMIN },
  '/report-builder':      { minRole: Role.AGENT },
  '/scheduled-reports':   { minRole: Role.MANAGER },
  '/api-docs':            {},
  '/marketplace':         { minRole: Role.ADMIN },
  /* Self-Service + AI */
  '/customer-portal':     {},
  '/live-chat':           { minRole: Role.AGENT },
  '/chatbot':             { minRole: Role.ADMIN },
  '/languages':           { minRole: Role.ADMIN },
  '/ai-dashboard':        { minRole: Role.MANAGER },
  '/sentiment':           { minRole: Role.MANAGER },
  '/smart-routing':       { minRole: Role.MANAGER },
};

function canAccessRoute(path: string, role: string | undefined): boolean {
  if (!role) return false;
  const cfg = ROUTE_ACCESS[path];
  if (!cfg) return true;
  if (cfg.minRole && !hasRoleLevel(role as Role, cfg.minRole)) return false;
  if (cfg.anyPerm && !hasAnyPermission(role as Role, cfg.anyPerm)) return false;
  return true;
}

function ProtectedRoute({
  routePath,
  children,
}: {
  routePath: string;
  children: React.ReactNode;
}) {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const role = useAppStore((s) => s.currentUser?.role);
  const dbStatus = useAppStore((s) => s.dbStatus);

  if (dbStatus === 'connecting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf9f4]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[#e5e0d5] border-t-[#c9a87c]" />
          <p className="text-sm text-[#595959]">Connecting to VedaDB...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!canAccessRoute(routePath, role)) {
    return <Navigate to={role === Role.CUSTOMER ? '/tickets' : '/dashboard'} replace />;
  }
  return <Layout>{children}</Layout>;
}

/* ------------------------------------------------------------------ */
/*  Routes                                                            */
/* ------------------------------------------------------------------ */

function AppRoutes() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const initDB = useAppStore((s) => s.initDB);

  useEffect(() => {
    initDB();
  }, [initDB]);

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />
        }
      />
      {/* DB Setup — public route, no auth required */}
      <Route path="/db-setup" element={<DBSetup />} />
      <Route path="/dashboard"     element={<ProtectedRoute routePath="/dashboard"><Dashboard /></ProtectedRoute>} />
      <Route path="/tickets"       element={<ProtectedRoute routePath="/tickets"><Tickets /></ProtectedRoute>} />
      <Route path="/tickets/:id"   element={<ProtectedRoute routePath="/tickets"><TicketDetail /></ProtectedRoute>} />
      <Route path="/users"         element={<ProtectedRoute routePath="/users"><Users /></ProtectedRoute>} />
      <Route path="/knowledge"     element={<ProtectedRoute routePath="/knowledge"><KnowledgeBase /></ProtectedRoute>} />
      <Route path="/knowledge/:id" element={<ProtectedRoute routePath="/knowledge"><KnowledgeArticle /></ProtectedRoute>} />
      <Route path="/settings"      element={<ProtectedRoute routePath="/settings"><Settings /></ProtectedRoute>} />
      <Route path="/sla"           element={<ProtectedRoute routePath="/sla"><SLADashboard /></ProtectedRoute>} />
      <Route path="/reports"       element={<ProtectedRoute routePath="/reports"><ReportsDashboard /></ProtectedRoute>} />
      <Route path="/audit"         element={<ProtectedRoute routePath="/audit"><AuditLogs /></ProtectedRoute>} />
      <Route path="/announcements" element={<ProtectedRoute routePath="/announcements"><Announcements /></ProtectedRoute>} />
      <Route path="/departments"   element={<ProtectedRoute routePath="/departments"><Departments /></ProtectedRoute>} />
      <Route path="/automation"    element={<ProtectedRoute routePath="/automation"><AutomationRules /></ProtectedRoute>} />
      <Route path="/canned"        element={<ProtectedRoute routePath="/canned"><CannedResponses /></ProtectedRoute>} />
      <Route path="/catalog"       element={<ProtectedRoute routePath="/catalog"><ServiceCatalog /></ProtectedRoute>} />
      <Route path="/csat"          element={<ProtectedRoute routePath="/csat"><CSATDashboard /></ProtectedRoute>} />
      <Route path="/time-entries"  element={<ProtectedRoute routePath="/time-entries"><TimeTracking /></ProtectedRoute>} />
      {/* Advanced Ticket Management */}
      <Route path="/ticket-templates"  element={<ProtectedRoute routePath="/ticket-templates"><TicketTemplates /></ProtectedRoute>} />
      <Route path="/ticket-links"      element={<ProtectedRoute routePath="/ticket-links"><TicketLinks /></ProtectedRoute>} />
      <Route path="/ticket-watchers"   element={<ProtectedRoute routePath="/ticket-watchers"><TicketWatchers /></ProtectedRoute>} />
      <Route path="/escalation-paths"  element={<ProtectedRoute routePath="/escalation-paths"><EscalationPaths /></ProtectedRoute>} />
      <Route path="/recurring-tickets" element={<ProtectedRoute routePath="/recurring-tickets"><RecurringTickets /></ProtectedRoute>} />
      {/* Asset + Change + Problem */}
      <Route path="/assets"            element={<ProtectedRoute routePath="/assets"><AssetInventory /></ProtectedRoute>} />
      <Route path="/assets/:id"        element={<ProtectedRoute routePath="/assets"><AssetDetail /></ProtectedRoute>} />
      <Route path="/software-licenses" element={<ProtectedRoute routePath="/software-licenses"><SoftwareLicenses /></ProtectedRoute>} />
      <Route path="/changes"           element={<ProtectedRoute routePath="/changes"><ChangeDashboard /></ProtectedRoute>} />
      <Route path="/kedb"              element={<ProtectedRoute routePath="/kedb"><KEDB /></ProtectedRoute>} />
      <Route path="/problems"          element={<ProtectedRoute routePath="/problems"><ProblemManagement /></ProtectedRoute>} />
      <Route path="/major-incidents"   element={<ProtectedRoute routePath="/major-incidents"><MajorIncidents /></ProtectedRoute>} />
      {/* Communication */}
      <Route path="/email-templates"        element={<ProtectedRoute routePath="/email-templates"><EmailTemplates /></ProtectedRoute>} />
      <Route path="/sms-settings"           element={<ProtectedRoute routePath="/sms-settings"><SMSSettings /></ProtectedRoute>} />
      <Route path="/integrations"           element={<ProtectedRoute routePath="/integrations"><Integrations /></ProtectedRoute>} />
      <Route path="/notification-preferences" element={<ProtectedRoute routePath="/notification-preferences"><NotificationPrefs /></ProtectedRoute>} />
      <Route path="/communication-history"  element={<ProtectedRoute routePath="/communication-history"><CommunicationHistory /></ProtectedRoute>} />
      {/* RBAC + Security + Portal Admin */}
      <Route path="/custom-roles"      element={<ProtectedRoute routePath="/custom-roles"><CustomRoles /></ProtectedRoute>} />
      <Route path="/sso-config"        element={<ProtectedRoute routePath="/sso-config"><SSOConfig /></ProtectedRoute>} />
      <Route path="/mfa-setup"         element={<ProtectedRoute routePath="/mfa-setup"><MFASetup /></ProtectedRoute>} />
      <Route path="/ip-restrictions"  element={<ProtectedRoute routePath="/ip-restrictions"><IPRestrictions /></ProtectedRoute>} />
      <Route path="/branding"          element={<ProtectedRoute routePath="/branding"><BrandingEditor /></ProtectedRoute>} />
      <Route path="/api-management"   element={<ProtectedRoute routePath="/api-management"><APIManagement /></ProtectedRoute>} />
      <Route path="/portal-admin"     element={<ProtectedRoute routePath="/portal-admin"><PortalAdmin /></ProtectedRoute>} />
      {/* Workflow + Reporting */}
      <Route path="/workflow-builder"   element={<ProtectedRoute routePath="/workflow-builder"><WorkflowBuilder /></ProtectedRoute>} />
      <Route path="/approval-chains"    element={<ProtectedRoute routePath="/approval-chains"><ApprovalChains /></ProtectedRoute>} />
      <Route path="/webhooks"           element={<ProtectedRoute routePath="/webhooks"><WebhookConfig /></ProtectedRoute>} />
      <Route path="/report-builder"     element={<ProtectedRoute routePath="/report-builder"><ReportBuilder /></ProtectedRoute>} />
      <Route path="/scheduled-reports"  element={<ProtectedRoute routePath="/scheduled-reports"><ScheduledReports /></ProtectedRoute>} />
      <Route path="/api-docs"           element={<ProtectedRoute routePath="/api-docs"><APIDocs /></ProtectedRoute>} />
      <Route path="/marketplace"        element={<ProtectedRoute routePath="/marketplace"><AppMarketplace /></ProtectedRoute>} />
      {/* Self-Service + AI */}
      <Route path="/customer-portal"  element={<ProtectedRoute routePath="/customer-portal"><CustomerPortal /></ProtectedRoute>} />
      <Route path="/live-chat"        element={<ProtectedRoute routePath="/live-chat"><LiveChat /></ProtectedRoute>} />
      <Route path="/chatbot"          element={<ProtectedRoute routePath="/chatbot"><ChatbotConfig /></ProtectedRoute>} />
      <Route path="/languages"        element={<ProtectedRoute routePath="/languages"><MultiLanguage /></ProtectedRoute>} />
      <Route path="/ai-dashboard"     element={<ProtectedRoute routePath="/ai-dashboard"><AIDashboard /></ProtectedRoute>} />
      <Route path="/sentiment"        element={<ProtectedRoute routePath="/sentiment"><SentimentDashboard /></ProtectedRoute>} />
      <Route path="/smart-routing"    element={<ProtectedRoute routePath="/smart-routing"><SmartRouting /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}
