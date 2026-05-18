/**
 * Login Page — Split-screen layout with Canvas 2D particle background
 * Updated with VedaDB connection setup and seeded user login
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Eye,
  EyeOff,
  Loader2,
  Globe,
  KeyRound,
  CheckCircle2,
  XCircle,
  Database,
  ChevronDown,
  LogIn,
  Plug,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAppStore from '@/lib/vedadb-store';
import { vedaTestConnection, setApiBase, setApiKey as setVedaApiKey } from '@/lib/vedadb-api';
import RoleBadge from '@/components/RoleBadge';
import { Role } from '@/lib/rbac';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Seeded users for demo                                              */
/* ------------------------------------------------------------------ */

const SEEDED_USERS = [
  { email: 'sarah.chen@company.com', role: Role.SUPER_ADMIN, label: 'Sarah Chen', dept: 'IT Support' },
  { email: 'marcus.j@company.com', role: Role.ADMIN, label: 'Marcus Johnson', dept: 'IT Support' },
  { email: 'aisha.patel@company.com', role: Role.MANAGER, label: 'Aisha Patel', dept: 'HR' },
  { email: 'david.kim@company.com', role: Role.AGENT, label: 'David Kim', dept: 'IT Support' },
  { email: 'emily.r@company.com', role: Role.CUSTOMER, label: 'Emily Rodriguez', dept: 'Sales' },
  { email: 'james.w@company.com', role: Role.AGENT, label: 'James Wilson', dept: 'IT Support' },
  { email: 'olivia.m@company.com', role: Role.MANAGER, label: 'Olivia Martinez', dept: 'Finance' },
  { email: 'noah.g@company.com', role: Role.ADMIN, label: 'Noah Garcia', dept: 'HR' },
  { email: 'isabella.b@company.com', role: Role.AGENT, label: 'Isabella Brown', dept: 'Finance' },
  { email: 'sophia.lee@company.com', role: Role.CUSTOMER, label: 'Sophia Lee', dept: 'Sales' },
  { email: 'liam.t@company.com', role: Role.AGENT, label: 'Liam Thompson', dept: 'Facilities' },
  { email: 'ethan.d@company.com', role: Role.CUSTOMER, label: 'Ethan Davis', dept: 'Facilities' },
];

/* ------------------------------------------------------------------ */
/*  Particle Canvas                                                    */
/* ------------------------------------------------------------------ */
const ParticleCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let w = 0;
    let h = 0;

    const PARTICLE_COUNT = 80;
    const CONNECTION_DIST = 100;
    const MOUSE_REPEL_RADIUS = 150;
    const MOUSE_FORCE = 0.5;

    interface Particle {
      x: number;
      y: number;
      baseX: number;
      baseY: number;
      size: number;
      speed: number;
      angle: number;
      phase: number;
    }

    const particles: Particle[] = [];
    const mouse = { x: -999, y: -999 };

    function resize() {
      const rect = canvas!.parentElement?.getBoundingClientRect();
      w = rect?.width || window.innerWidth;
      h = rect?.height || window.innerHeight;
      canvas!.width = w * window.devicePixelRatio;
      canvas!.height = h * window.devicePixelRatio;
      ctx!.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    function initParticles() {
      particles.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const size = 1 + Math.random() * 3;
        particles.push({
          x,
          y,
          baseX: x,
          baseY: y,
          size,
          speed: 0.2 + size * 0.15,
          angle: Math.random() * Math.PI * 2,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    function animate() {
      ctx!.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.phase += 0.005 * p.speed;
        p.baseX += p.speed * 0.3;

        if (p.baseX > w + 10) p.baseX = -10;

        const sineOffset = Math.sin(p.phase + p.angle) * 20;
        p.x = p.baseX;
        p.y = p.baseY + sineOffset;

        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_REPEL_RADIUS && dist > 0) {
          const force = (MOUSE_REPEL_RADIUS - dist) / MOUSE_REPEL_RADIUS * MOUSE_FORCE;
          p.x += (dx / dist) * force * 5;
          p.y += (dy / dist) * force * 5;
        }

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(201, 168, 124, ${0.3 + p.size * 0.15})`;
        ctx!.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < CONNECTION_DIST) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(201, 168, 124, ${0.1 * (1 - d / CONNECTION_DIST)})`;
            ctx!.lineWidth = 1;
            ctx!.stroke();
          }
        }
      }

      animId = requestAnimationFrame(animate);
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouse.x = -999;
      mouse.y = -999;
    };

    resize();
    initParticles();
    animate();

    window.addEventListener('resize', () => { resize(); initParticles(); });
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }}
    />
  );
};

/* ------------------------------------------------------------------ */
/*  Login Page                                                         */
/* ------------------------------------------------------------------ */

export default function Login() {
  const navigate = useNavigate();
  const login = useAppStore((s) => s.login);
  const initDB = useAppStore((s) => s.initDB);

  // Connection
  const [apiUrl, setApiUrl] = useState(() => {
    try { return localStorage.getItem('vedadb_api_url') || 'http://localhost:9090'; }
    catch { return 'http://localhost:9090'; }
  });
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem('vedadb_api_key') || ''; }
    catch { return ''; }
  });
  const [connectionState, setConnectionState] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');

  // Login form
  const [selectedEmail, setSelectedEmail] = useState('');
  const [password, setPassword] = useState('password');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const inputClasses =
    'h-10 w-full rounded-lg border border-[#e5e0d5] bg-white px-4 text-sm text-[#1f1f1f] outline-none transition-all placeholder:text-[#8a8a8a] focus:border-[#c9a87c] focus:shadow-[0_0_0_3px_rgba(201,168,124,0.15)]';

  useEffect(() => {
    initDB();
  }, [initDB]);

  const handleTestConnection = async () => {
    setConnectionState('testing');
    setApiBase(apiUrl);
    setVedaApiKey(apiKey);
    try {
      const ok = await vedaTestConnection();
      if (ok) {
        setConnectionState('connected');
      } else {
        setConnectionState('failed');
      }
    } catch {
      setConnectionState('failed');
    }
  };

  const handleLogin = async () => {
    if (!selectedEmail) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    const success = await login(selectedEmail, password);
    setLoading(false);

    if (success) {
      navigate('/dashboard');
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  const isConnectionReady = connectionState === 'connected';

  return (
    <div className="flex min-h-[100dvh]">
      {/* LEFT PANEL — Login Form */}
      <motion.div
        initial={{ x: -30, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number], delay: 0.3 }}
        className="flex w-full flex-col justify-center bg-white px-6 md:w-1/2 md:px-12 lg:px-20 xl:w-[520px] xl:px-16 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-sm py-8">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            className="mb-8 flex items-center gap-2"
          >
            <img src="./logo-icon.svg" alt="VedaDesk" className="h-10 w-10" />
            <img src="./logo-wordmark.svg" alt="VedaDesk" className="h-7" />
          </motion.div>

          {/* Welcome text */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="mb-6"
          >
            <h2 className="font-playfair text-2xl font-bold text-[#1f1f1f] md:text-3xl">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-[#595959]">
              Sign in to your VedaDesk portal
            </p>
          </motion.div>

          {/* Connection Setup */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.4 }}
            className="mb-5 rounded-xl border border-[#e5e0d5] bg-[#fbf9f4] p-4"
          >
            <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.1em] text-[#595959]">
              VedaDB Connection
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#595959]">API URL</label>
                <div className="relative">
                  <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="http://localhost:9090"
                    className={inputClasses + ' pl-9'}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#595959]">API Key (optional)</label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Optional"
                    className={inputClasses + ' pl-9'}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTestConnection}
                  disabled={connectionState === 'testing'}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                    connectionState === 'idle' && 'bg-[#c9a87c] text-[#1f1f1f] hover:brightness-95',
                    connectionState === 'testing' && 'bg-[#e5e0d5] text-[#8a8a8a] cursor-not-allowed',
                    connectionState === 'connected' && 'bg-[#52c41a] text-white',
                    connectionState === 'failed' && 'bg-[#f5222d] text-white',
                  )}
                >
                  {connectionState === 'idle' && <Plug size={14} />}
                  {connectionState === 'testing' && <Loader2 size={14} className="animate-spin" />}
                  {connectionState === 'connected' && <CheckCircle2 size={14} />}
                  {connectionState === 'failed' && <XCircle size={14} />}
                  {connectionState === 'idle' && 'Test Connection'}
                  {connectionState === 'testing' && 'Testing...'}
                  {connectionState === 'connected' && 'Connected'}
                  {connectionState === 'failed' && 'Failed'}
                </button>

                {connectionState === 'connected' && (
                  <span className="text-xs text-[#52c41a]">VedaDB is ready</span>
                )}
                {connectionState === 'failed' && (
                  <span className="text-xs text-[#f5222d]">
                    <button
                      onClick={() => navigate('/db-setup')}
                      className="underline hover:no-underline"
                    >
                      Setup Database
                    </button>
                  </span>
                )}
              </div>
            </div>
          </motion.div>

          {/* Login Form - Only show after connection */}
          {isConnectionReady && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-4"
            >
              {/* Email dropdown */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-[#595959]">
                  Select User
                </label>
                <div className="relative">
                  <select
                    value={selectedEmail}
                    onChange={(e) => setSelectedEmail(e.target.value)}
                    className={inputClasses + ' appearance-none pr-10'}
                  >
                    <option value="">Choose a user...</option>
                    {SEEDED_USERS.map((u) => (
                      <option key={u.email} value={u.email}>
                        {u.label} ({u.dept})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-[#595959]">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className={inputClasses + ' pr-10'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a8a8a] transition-colors hover:text-[#595959]"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Login Button */}
              <motion.div
                animate={{ scale: shake ? [1, 0.95, 1.02, 0.98, 1] : 1 }}
                transition={{ duration: 0.5 }}
              >
                <button
                  onClick={handleLogin}
                  disabled={loading || !selectedEmail}
                  className={cn(
                    'flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold transition-all',
                    selectedEmail
                      ? 'bg-[#c9a87c] text-[#1f1f1f] hover:scale-[1.02] hover:brightness-90 active:scale-[0.98]'
                      : 'cursor-not-allowed bg-[#e5e0d5] text-[#8a8a8a]',
                  )}
                >
                  {loading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <>
                      <LogIn size={18} />
                      Sign In
                    </>
                  )}
                </button>
                {shake && (
                  <p className="mt-2 text-center text-xs text-[#f5222d]">
                    Login failed. Make sure the database is set up with seeded users.
                  </p>
                )}
              </motion.div>

              {/* Quick login buttons */}
              <div className="mt-4 rounded-lg bg-[#f5f0e8] p-3">
                <p className="mb-2 text-xs font-medium text-[#1f1f1f]">Quick login:</p>
                <div className="flex flex-wrap gap-2">
                  {SEEDED_USERS.slice(0, 5).map((u) => (
                    <button
                      key={u.email}
                      type="button"
                      onClick={() => {
                        setSelectedEmail(u.email);
                        setTimeout(() => handleLogin(), 100);
                      }}
                      className="flex items-center gap-1.5 rounded-md border border-[#e5e0d5] bg-white px-2.5 py-1.5 text-xs transition-all hover:border-[#c9a87c] hover:shadow-sm"
                    >
                      <RoleBadge role={u.role} />
                      <span className="text-[#595959]">{u.label.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Setup DB link */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.4 }}
            className="mt-6 text-center"
          >
            <button
              onClick={() => navigate('/db-setup')}
              className="inline-flex items-center gap-1.5 text-xs text-[#595959] transition-colors hover:text-[#c9a87c]"
            >
              <Database size={14} />
              Setup Database
            </button>
            <p className="mt-1 text-[11px] text-[#8a8a8a]">
              Create tables and seed demo data
            </p>
          </motion.div>
        </div>
      </motion.div>

      {/* RIGHT PANEL — Cinematic Hero */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        className="relative hidden flex-1 overflow-hidden bg-[#0f0f0f] md:block"
      >
        <div
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(120, 119, 198, 0.3), transparent)',
          }}
        />

        <img
          src="./login-illustration.jpg"
          alt=""
          className="pointer-events-none absolute inset-0 z-[3] h-full w-full object-cover opacity-40 mix-blend-overlay"
          style={{ maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 80%)' }}
        />

        <ParticleCanvas />

        <img
          src="./hero-particles.png"
          alt=""
          className="pointer-events-none absolute inset-0 z-[4] h-full w-full object-cover opacity-30"
        />

        <div className="absolute bottom-0 left-0 z-[5] p-8 lg:p-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.5 }}
          >
            <h3 className="font-playfair text-2xl font-bold text-[#f5f5f5] lg:text-3xl">
              Powered by VedaDB
            </h3>
            <p className="mt-3 max-w-[400px] text-sm font-light leading-relaxed text-[rgba(245,245,245,0.7)]">
              Multi-Model Database Engine — SQL, Document Store, Key-Value Cache &amp; Full-Text Search unified in one high-performance platform.
            </p>
            <div className="mt-6 flex gap-8">
              <div>
                <p className="text-2xl font-bold text-[#c9a87c] lg:text-3xl">10,000+</p>
                <p className="mt-1 text-xs uppercase tracking-[0.1em] text-[rgba(245,245,245,0.5)]">
                  Tickets Managed
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#c9a87c] lg:text-3xl">&lt; 5ms</p>
                <p className="mt-1 text-xs uppercase tracking-[0.1em] text-[rgba(245,245,245,0.5)]">
                  Query Latency
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
