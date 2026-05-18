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
