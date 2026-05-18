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
      <Route
        path="/dashboard"
        element={
          isAuthenticated ? (
            <Layout>
              <Dashboard />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/tickets"
        element={
          isAuthenticated ? (
            <Layout>
              <Tickets />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/tickets/:id"
        element={
          isAuthenticated ? (
            <Layout>
              <TicketDetail />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/users"
        element={
          isAuthenticated ? (
            <Layout>
              <Users />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/knowledge"
        element={
          isAuthenticated ? (
            <Layout>
              <KnowledgeBase />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/knowledge/:id"
        element={
          isAuthenticated ? (
            <Layout>
              <KnowledgeArticle />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/settings"
        element={
          isAuthenticated ? (
            <Layout>
              <Settings />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* RBAC Routes */}
      <Route
        path="/sla"
        element={
          isAuthenticated ? (
            <Layout>
              <SLADashboard />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/reports"
        element={
          isAuthenticated ? (
            <Layout>
              <ReportsDashboard />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/audit"
        element={
          isAuthenticated ? (
            <Layout>
              <AuditLogs />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/announcements"
        element={
          isAuthenticated ? (
            <Layout>
              <Announcements />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/departments"
        element={
          isAuthenticated ? (
            <Layout>
              <Departments />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/automation"
        element={
          isAuthenticated ? (
            <Layout>
              <AutomationRules />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/canned"
        element={
          isAuthenticated ? (
            <Layout>
              <CannedResponses />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/catalog"
        element={
          isAuthenticated ? (
            <Layout>
              <ServiceCatalog />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/csat"
        element={
          isAuthenticated ? (
            <Layout>
              <CSATDashboard />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/time-entries"
        element={
          isAuthenticated ? (
            <Layout>
              <TimeTracking />
            </Layout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
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
