import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Database, Globe, KeyRound, CheckCircle2, XCircle, ArrowRight,
  Loader2, CircleDot, AlertTriangle, ChevronRight, Lock, Plug,
  Terminal, Copy, Check
} from 'lucide-react';
import useAppStore from '@/lib/vedadb-store';
import {
  vedaTestConnection,
  setApiBase,
  getApiBase,
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

const START_COMMANDS = [
  '# 1. Clone VedaDB server repository',
  'git clone https://github.com/tiennesdm/vedadb-server.git',
  'cd vedadb-server',
  '',
  '# 2. Install Go dependencies',
  'go mod tidy',
  '',
  '# 3. Start the Workbench server',
  'go run ./cmd/vedadb-workbench/main.go',
  '',
  '# Server will start on port 9090',
  '# API available at: http://localhost:9090',
];

type Step = 'connect' | 'login';

export default function Login() {
  const navigate = useNavigate();
  const storeLogin = useAppStore((s) => s.login);
  const initDB = useAppStore((s) => s.initDB);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [step, setStep] = useState<Step>('connect');
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [selectedEmail, setSelectedEmail] = useState(SEEDED_USERS[0].email);
  const [loggingIn, setLoggingIn] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  useEffect(() => {
    const status = getConnectionStatus();
    if (status.connected) {
      setConnected(true);
      setStep('login');
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard');
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
        setError('Cannot connect to VedaDB. Make sure the server is running at the URL above.');
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
      if (ok) navigate('/dashboard');
      else setError('Login failed. User not found — initialize the database first in Settings → DB Setup.');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
    setLoggingIn(false);
  };

  const copyCommands = () => {
    navigator.clipboard.writeText(START_COMMANDS.join('\n'));
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#fbf9f4] flex">
      {/* Left Panel — How to Start VedaDB */}
      <div className="hidden lg:flex lg:w-[48%] bg-[#1f1f1f] flex-col px-10 py-8 relative overflow-hidden">
        <div className="absolute top-[-15%] left-[-15%] w-[500px] h-[500px] rounded-full bg-[#c9a87c]/10 blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-15%] w-[400px] h-[400px] rounded-full bg-[#c9a87c]/5 blur-[100px]" />

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#c9a87c]/20 flex items-center justify-center">
              <Database size={24} className="text-[#c9a87c]" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">VedaDesk</h1>
          </div>

          {/* What is this */}
          <div className="mb-6 p-4 bg-white/5 rounded-xl border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <InfoIcon />
              <span className="text-sm font-medium text-[#faad14]">Why do I need to start a server?</span>
            </div>
            <p className="text-xs text-white/50 leading-relaxed">
              VedaDesk is a frontend portal. Your data lives in the <strong className="text-white/70">VedaDB database server</strong> which runs separately on your machine (or server). This portal connects to it via HTTP API.
            </p>
          </div>

          {/* Step 1: Start Server */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-[#c9a87c] text-[#1f1f1f] flex items-center justify-center text-xs font-bold">1</div>
              <span className="text-sm font-semibold text-white/90">Start VedaDB Server on Your Machine</span>
            </div>
            <div className="ml-8 relative">
              <div className="bg-black/40 rounded-xl border border-white/10 p-3 font-mono text-[11px] text-white/60 leading-relaxed overflow-x-auto">
                <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                  <span className="text-[10px] text-white/40">Terminal</span>
                  <button onClick={copyCommands} className="text-[10px] text-[#c9a87c] hover:text-[#b8976b] flex items-center gap-1">
                    {copiedCmd ? <Check size={10} /> : <Copy size={10} />}
                    {copiedCmd ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                {START_COMMANDS.map((line, i) => (
                  <div key={i} className={line.startsWith('#') ? 'text-[#8a8a8a] italic mt-1' : line === '' ? 'h-2' : 'text-green-400/80'}>
                    {line || ' '}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Step 2: Connect */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-full bg-[#c9a87c] text-[#1f1f1f] flex items-center justify-center text-xs font-bold">2</div>
              <span className="text-sm font-semibold text-white/90">This Portal Connects to It</span>
            </div>
            <p className="ml-8 text-xs text-white/50">
              Once the server is running at <code className="text-[#c9a87c]">http://localhost:9090</code>, enter that URL on the right panel and click "Connect".
            </p>
          </div>

          {/* Step 3: Login */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-full bg-[#c9a87c] text-[#1f1f1f] flex items-center justify-center text-xs font-bold">3</div>
              <span className="text-sm font-semibold text-white/90">Login & Start Using</span>
            </div>
            <p className="ml-8 text-xs text-white/50">
              Select a demo user and login. First time? Go to <strong className="text-white/70">Settings → DB Setup</strong> to create tables and seed data.
            </p>
          </div>

          {/* Requirements */}
          <div className="p-3 bg-white/5 rounded-lg border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <Terminal size={12} className="text-[#8a8a8a]" />
              <span className="text-xs font-medium text-white/60">Prerequisites</span>
            </div>
            <ul className="text-[11px] text-white/40 space-y-0.5 ml-5 list-disc">
              <li>Go 1.22+ installed (<a href="https://go.dev/dl" target="_blank" rel="noreferrer" className="text-[#c9a87c] hover:underline">download</a>)</li>
              <li>VedaDB server repository cloned</li>
              <li>Port 9090 available on your machine</li>
            </ul>
          </div>
        </motion.div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-10 overflow-y-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }} className="w-full max-w-md">
          {/* Mobile header */}
          <div className="lg:hidden flex items-center gap-3 mb-6 justify-center">
            <Database size={24} className="text-[#c9a87c]" />
            <h1 className="text-xl font-bold text-[#1f1f1f]">VedaDesk</h1>
          </div>

          {connected && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mb-5 p-3 bg-[#f6ffed] border border-[#b7eb8f] rounded-xl flex items-center gap-3">
              <CheckCircle2 size={18} className="text-[#52c41a] shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#389e0d]">Connected to VedaDB</p>
                <p className="text-[11px] text-[#389e0d]/70 font-mono">{getApiBase()}</p>
              </div>
            </motion.div>
          )}

          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-5 p-3 bg-[#fff1f0] border border-[#ffa39e] rounded-xl flex items-start gap-3">
              <XCircle size={16} className="text-[#f5222d] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-[#cf1322]">{error}</p>
                <p className="text-[11px] text-[#cf1322]/70 mt-1">
                  Make sure VedaDB server is running. Check the instructions on the left panel.
                </p>
              </div>
            </motion.div>
          )}

          {step === 'connect' ? (
            <>
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-[#1f1f1f]">Connect to VedaDB</h2>
                <p className="text-sm text-[#595959] mt-1">Enter your VedaDB server endpoint below</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#595959] uppercase tracking-wider mb-1.5">Server URL</label>
                  <div className="relative">
                    <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                    <input type="text" value={apiUrl} onChange={(e) => { setApiUrl(e.target.value); setError(''); }}
                      placeholder="http://localhost:9090"
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#e5e0d5] bg-white text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c] focus:ring-2 focus:ring-[#c9a87c]/20 transition-all font-mono" />
                  </div>
                  <p className="text-[11px] text-[#8a8a8a] mt-1">Default: http://localhost:9090 (VedaDB Workbench)</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#595959] uppercase tracking-wider mb-1.5">
                    API Key <span className="normal-case text-[#8a8a8a] font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter API key if required"
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#e5e0d5] bg-white text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c] focus:ring-2 focus:ring-[#c9a87c]/20 transition-all font-mono" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {['http://localhost:9090', 'http://127.0.0.1:9090', 'http://localhost:8080'].map((url) => (
                    <button key={url} onClick={() => setApiUrl(url)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-[#f5f0e8] text-[#595959] hover:bg-[#ede7db] transition-colors">{url}</button>
                  ))}
                </div>

                <button onClick={handleTestConnection} disabled={testing || !apiUrl.trim()}
                  className={`w-full h-12 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] mt-2 ${testing || !apiUrl.trim() ? 'bg-[#e5e0d5] cursor-not-allowed' : 'bg-[#c9a87c] hover:bg-[#b8976b]'}`}>
                  {testing ? <><Loader2 size={18} className="animate-spin" /> Connecting...</> : <><Plug size={18} /> Connect to VedaDB <ArrowRight size={16} /></>}
                </button>

                <div className="text-center">
                  <button onClick={() => navigate('/db-setup')} className="text-xs text-[#c9a87c] hover:text-[#b8976b] hover:underline">First time? Set up database tables →</button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-[#1f1f1f]">Select User</h2>
                <p className="text-sm text-[#595959] mt-1">Choose a demo user to login as</p>
              </div>

              <div className="space-y-2 mb-5">
                {SEEDED_USERS.map((user) => (
                  <button key={user.email} onClick={() => setSelectedEmail(user.email)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${selectedEmail === user.email ? 'border-[#c9a87c] bg-[#faf5ed] ring-1 ring-[#c9a87c]/30' : 'border-[#e5e0d5] bg-white hover:border-[#c9a87c]/50'}`}>
                    <div className="w-10 h-10 rounded-full bg-[#f5f0e8] flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-[#c9a87c]">{user.label.split(' ').map(n => n[0]).join('')}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1f1f1f] truncate">{user.label}</p>
                      <p className="text-xs text-[#8a8a8a] truncate">{user.email}</p>
                    </div>
                    <RoleBadge role={user.role} />
                    {selectedEmail === user.email && <CircleDot size={18} className="text-[#c9a87c] shrink-0" />}
                  </button>
                ))}
              </div>

              <button onClick={handleLogin} disabled={loggingIn}
                className={`w-full h-12 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${loggingIn ? 'bg-[#e5e0d5] cursor-wait' : 'bg-[#c9a87c] hover:bg-[#b8976b]'}`}>
                {loggingIn ? <><Loader2 size={18} className="animate-spin" /> Logging in...</> : <><Lock size={18} /> Login <ChevronRight size={16} /></>}
              </button>

              <div className="text-center mt-4">
                <button onClick={() => { setStep('connect'); setConnected(false); setError(''); }} className="text-xs text-[#8a8a8a] hover:text-[#595959]">← Change connection</button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function InfoIcon() {
  return <AlertTriangle size={14} className="text-[#faad14] shrink-0" />;
}
