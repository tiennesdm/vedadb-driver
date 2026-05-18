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
  '/csat':          { anyPerm: [Permission.CSAT_VIEW] },
  '/time-entries':  { anyPerm: [Permission.REPORT_VIEW_OWN, Permission.REPORT_VIEW_ALL] },
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
