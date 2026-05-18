/**
 * VedaDesk Login + VedaDB Connection Setup
 * First-time setup flow: Connect to VedaDB → Login
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Database, Globe, KeyRound, CheckCircle2, XCircle, ArrowRight,
  Server, Loader2, CircleDot,
  AlertTriangle, ChevronRight, Lock, Plug
} from 'lucide-react';
import useAppStore from '@/lib/vedadb-store';
import {
  vedaTestConnection,
  setApiBase,
  getApiBase,
  getApiKey,
  getConnectionStatus,
} from '@/lib/vedadb-api';
import RoleBadge from '@/components/RoleBadge';
import { Role } from '@/lib/rbac';

const SEEDED_USERS = [
  { email: 'sarah.chen@company.com', role: Role.SUPER_ADMIN, label: 'Sarah Chen', dept: 'IT Support' },
  { email: 'marcus.j@company.com', role: Role.ADMIN, label: 'Marcus Johnson', dept: 'IT Support' },
  { email: 'aisha.patel@company.com', role: Role.MANAGER, label: 'Aisha Patel', dept: 'HR' },
  { email: 'david.kim@company.com', role: Role.AGENT, label: 'David Kim', dept: 'IT Support' },
  { email: 'emily.r@company.com', role: Role.CUSTOMER, label: 'Emily Rodriguez', dept: 'Sales' },
];

type Step = 'connect' | 'login' | 'setup-db';

export default function Login() {
  const navigate = useNavigate();
  const storeLogin = useAppStore((s) => s.login);
  const initDB = useAppStore((s) => s.initDB);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [step, setStep] = useState<Step>('connect');
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [apiKey, setApiKey] = useState(getApiKey());
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [selectedEmail, setSelectedEmail] = useState(SEEDED_USERS[0].email);
  const [loggingIn, setLoggingIn] = useState(false);

  // Check if already connected
  useEffect(() => {
    const status = getConnectionStatus();
    if (status.connected) {
      setConnected(true);
      setStep('login');
    }
  }, []);

  // Redirect if authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const handleTestConnection = async () => {
    setTesting(true);
    setError('');
    setConnected(false);
    try {
      setApiBase(apiUrl.trim());
      if (apiKey.trim()) setApiKey(apiKey.trim());
      const ok = await vedaTestConnection();
      if (ok) {
        setConnected(true);
        setStep('login');
        await initDB();
      } else {
        setError('Could not connect to VedaDB. Please check the server URL and make sure the server is running.');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed. Is the VedaDB server running?');
    }
    setTesting(false);
  };

  const handleLogin = async () => {
    setLoggingIn(true);
    try {
      const ok = await storeLogin(selectedEmail, '');
      if (ok) {
        navigate('/dashboard');
      } else {
        setError('Login failed. User not found in database. You may need to set up the database first.');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
    setLoggingIn(false);
  };

  return (
    <div className="min-h-screen bg-[#fbf9f4] flex">
      {/* Left Panel — Connection Info */}
      <div className="hidden lg:flex lg:w-[45%] bg-[#1f1f1f] flex-col justify-center px-12 relative overflow-hidden">
        {/* Animated gradient orbs */}
        <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] rounded-full bg-[#c9a87c]/10 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[400px] h-[400px] rounded-full bg-[#c9a87c]/5 blur-[100px] animate-pulse" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative z-10"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-[#c9a87c]/20 flex items-center justify-center">
              <Database size={28} className="text-[#c9a87c]" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">VedaDesk</h1>
          </div>

          <h2 className="text-2xl font-semibold text-white/90 mb-4">
            Connect to Your VedaDB Server
          </h2>
          <p className="text-white/60 text-sm leading-relaxed mb-8 max-w-md">
            VedaDesk is a Service Desk Portal powered by VedaDB. Before you can use the portal, you need to connect to your VedaDB database server. The server runs locally or on your infrastructure.
          </p>

          {/* How It Works */}
          <div className="space-y-4 max-w-md">
            <InfoCard
              icon={<Server size={18} />}
              title="1. VedaDB Server Runs Locally"
              desc="Your database server runs on localhost:9090 by default. Make sure it's started."
            />
            <InfoCard
              icon={<Plug size={18} />}
              title="2. Connect This Portal"
              desc="Enter your VedaDB server URL and API key to establish connection."
            />
            <InfoCard
              icon={<Database size={18} />}
              title="3. Initialize Database"
              desc="Create tables and seed initial data on first connection."
            />
            <InfoCard
              icon={<Lock size={18} />}
              title="4. Login & Start Working"
              desc="Choose a user role and start managing tickets."
            />
          </div>

          {/* Server start instructions */}
          <div className="mt-8 p-4 bg-white/5 rounded-xl border border-white/10 max-w-md">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-[#faad14]" />
              <span className="text-sm font-medium text-[#faad14]">Haven't started VedaDB yet?</span>
            </div>
            <code className="block text-xs font-mono text-white/70 bg-black/30 rounded-lg p-3 mt-2">
              # Start VedaDB Server<br />
              cd vedadb-server<br />
              go run ./cmd/vedadb-workbench/main.go<br />
              <br />
              # Server will start on port 9090<br />
              # Workbench URL: http://localhost:9090
            </code>
          </div>
        </motion.div>
      </div>

      {/* Right Panel — Connection Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="w-full max-w-md"
        >
          {/* Mobile header */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <Database size={28} className="text-[#c9a87c]" />
            <h1 className="text-2xl font-bold text-[#1f1f1f]">VedaDesk</h1>
          </div>

          {/* Connection Status Banner */}
          {connected && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 p-4 bg-[#f6ffed] border border-[#b7eb8f] rounded-xl flex items-center gap-3"
            >
              <CheckCircle2 size={20} className="text-[#52c41a] shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#389e0d]">Connected to VedaDB</p>
                <p className="text-xs text-[#389e0d]/70">{getApiBase()}</p>
              </div>
            </motion.div>
          )}

          {/* Error Banner */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-[#fff1f0] border border-[#ffa39e] rounded-xl flex items-start gap-3"
            >
              <XCircle size={18} className="text-[#f5222d] shrink-0 mt-0.5" />
              <p className="text-sm text-[#cf1322]">{error}</p>
            </motion.div>
          )}

          {step === 'connect' ? (
            /* Step 1: Connect to VedaDB */
            <>
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-[#1f1f1f]">Connect to VedaDB</h2>
                <p className="text-sm text-[#595959] mt-1">
                  Enter your VedaDB server details to get started
                </p>
              </div>

              <div className="space-y-4">
                {/* API URL */}
                <div>
                  <label className="block text-xs font-medium text-[#595959] uppercase tracking-wider mb-1.5">
                    Server URL
                  </label>
                  <div className="relative">
                    <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                    <input
                      type="text"
                      value={apiUrl}
                      onChange={(e) => { setApiUrl(e.target.value); setError(''); }}
                      placeholder="http://localhost:9090"
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#e5e0d5] bg-white text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c] focus:ring-2 focus:ring-[#c9a87c]/20 transition-all font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-[#8a8a8a] mt-1">
                    Default: http://localhost:9090 (VedaDB Workbench)
                  </p>
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-xs font-medium text-[#595959] uppercase tracking-wider mb-1.5">
                    API Key <span className="normal-case text-[#8a8a8a] font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter API key if required"
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#e5e0d5] bg-white text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c] focus:ring-2 focus:ring-[#c9a87c]/20 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Quick URLs */}
                <div className="flex flex-wrap gap-2">
                  {['http://localhost:9090', 'http://127.0.0.1:9090', 'http://localhost:8080'].map((url) => (
                    <button
                      key={url}
                      onClick={() => setApiUrl(url)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-[#f5f0e8] text-[#595959] hover:bg-[#ede7db] hover:text-[#1f1f1f] transition-colors"
                    >
                      {url}
                    </button>
                  ))}
                </div>

                {/* Test Connection Button */}
                <button
                  onClick={handleTestConnection}
                  disabled={testing || !apiUrl.trim()}
                  className="w-full h-12 rounded-xl bg-[#c9a87c] hover:bg-[#b8976b] disabled:bg-[#e5e0d5] disabled:cursor-not-allowed text-white font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] mt-2"
                >
                  {testing ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Plug size={18} />
                      Connect to VedaDB
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>

                {/* DB Setup Link */}
                <div className="text-center">
                  <button
                    onClick={() => navigate('/db-setup')}
                    className="text-xs text-[#c9a87c] hover:text-[#b8976b] hover:underline"
                  >
                    First time? Set up database →
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Step 2: Login */
            <>
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-[#1f1f1f]">Select User</h2>
                <p className="text-sm text-[#595959] mt-1">
                  Choose a pre-configured user to login as
                </p>
              </div>

              {/* User List */}
              <div className="space-y-2 mb-6">
                {SEEDED_USERS.map((user) => (
                  <button
                    key={user.email}
                    onClick={() => setSelectedEmail(user.email)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      selectedEmail === user.email
                        ? 'border-[#c9a87c] bg-[#faf5ed] ring-1 ring-[#c9a87c]/30'
                        : 'border-[#e5e0d5] bg-white hover:border-[#c9a87c]/50 hover:bg-[#faf8f4]'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-[#f5f0e8] flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-[#c9a87c]">
                        {user.label.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1f1f1f] truncate">{user.label}</p>
                      <p className="text-xs text-[#8a8a8a] truncate">{user.email}</p>
                    </div>
                    <RoleBadge role={user.role} />
                    {selectedEmail === user.email && (
                      <CircleDot size={18} className="text-[#c9a87c] shrink-0" />
                    )}
                  </button>
                ))}
              </div>

              {/* Login Button */}
              <button
                onClick={handleLogin}
                disabled={loggingIn}
                className="w-full h-12 rounded-xl bg-[#c9a87c] hover:bg-[#b8976b] disabled:bg-[#e5e0d5] disabled:cursor-not-allowed text-white font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                {loggingIn ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Logging in...
                  </>
                ) : (
                  <>
                    <Lock size={18} />
                    Login as {SEEDED_USERS.find(u => u.email === selectedEmail)?.label}
                    <ChevronRight size={16} />
                  </>
                )}
              </button>

              {/* Back to Connection */}
              <div className="text-center mt-4">
                <button
                  onClick={() => { setStep('connect'); setConnected(false); setError(''); }}
                  className="text-xs text-[#8a8a8a] hover:text-[#595959] transition-colors"
                >
                  ← Change connection
                </button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

function InfoCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5 text-[#c9a87c]">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-white/80">{title}</p>
        <p className="text-xs text-white/50 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// End of file
