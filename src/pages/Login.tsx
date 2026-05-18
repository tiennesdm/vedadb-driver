/**
 * Login Page — Split-screen layout with Canvas 2D particle background
 */
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAppStore from '@/lib/vedadb-store';
import VedaDBStatus from '@/components/VedaDBStatus';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  rememberMe: z.boolean().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;

/* ------------------------------------------------------------------ */
/*  Particle Canvas — isolated in a dedicated component               */
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

      // Update & draw particles
      for (const p of particles) {
        p.phase += 0.005 * p.speed;
        p.baseX += p.speed * 0.3;

        // Wrap around horizontally
        if (p.baseX > w + 10) p.baseX = -10;

        // Sine wave motion
        const sineOffset = Math.sin(p.phase + p.angle) * 20;
        p.x = p.baseX;
        p.y = p.baseY + sineOffset;

        // Mouse repel
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_REPEL_RADIUS && dist > 0) {
          const force = (MOUSE_REPEL_RADIUS - dist) / MOUSE_REPEL_RADIUS * MOUSE_FORCE;
          p.x += (dx / dist) * force * 5;
          p.y += (dy / dist) * force * 5;
        }

        // Draw particle
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(201, 168, 124, ${0.3 + p.size * 0.15})`;
        ctx!.fill();
      }

      // Connection lines
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

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { rememberMe: false },
  });

  // Init DB on mount
  useEffect(() => {
    initDB();
  }, [initDB]);

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    // Simulate brief network delay
    await new Promise((r) => setTimeout(r, 800));
    const success = await login(data.email, data.password);
    setLoading(false);

    if (success) {
      navigate('/dashboard');
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  const inputClasses =
    'h-10 w-full rounded-lg border border-[#e5e0d5] bg-white px-4 text-sm text-[#1f1f1f] outline-none transition-all placeholder:text-[#8a8a8a] focus:border-[#c9a87c] focus:shadow-[0_0_0_3px_rgba(201,168,124,0.15)]';
  const errorClasses = 'mt-1 text-xs text-[#f5222d]';

  return (
    <div className="flex min-h-[100dvh]">
      {/* LEFT PANEL — Login Form */}
      <motion.div
        initial={{ x: -30, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number], delay: 0.3 }}
        className="flex w-full flex-col justify-center bg-white px-6 md:w-1/2 md:px-12 lg:px-20 xl:w-[480px] xl:px-16"
      >
        <div className="mx-auto w-full max-w-sm">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            className="mb-10 flex items-center gap-2"
          >
            <img src="./logo-icon.svg" alt="VedaDesk" className="h-10 w-10" />
            <img src="./logo-wordmark.svg" alt="VedaDesk" className="h-7" />
          </motion.div>

          {/* Welcome text */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="mb-8"
          >
            <h2 className="font-playfair text-2xl font-bold text-[#1f1f1f] md:text-3xl">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-[#595959]">
              Sign in to your VedaDesk portal
            </p>
          </motion.div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Email */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.4 }}
            >
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-[#595959]">
                Email address
              </label>
              <input
                type="email"
                placeholder="agent@company.com"
                className={inputClasses}
                {...register('email')}
              />
              {errors.email && <p className={errorClasses}>{errors.email.message}</p>}
            </motion.div>

            {/* Password */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.4 }}
            >
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-[#595959]">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  className={inputClasses + ' pr-10'}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a8a8a] transition-colors hover:text-[#595959]"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className={errorClasses}>{errors.password.message}</p>}
            </motion.div>

            {/* Remember me */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.4 }}
              className="flex items-center gap-2"
            >
              <input
                type="checkbox"
                id="remember"
                className="h-[18px] w-[18px] rounded border-[#e5e0d5] accent-[#c9a87c]"
                {...register('rememberMe')}
              />
              <label htmlFor="remember" className="text-sm text-[#595959]">
                Remember me for 30 days
              </label>
            </motion.div>

            {/* Submit button */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: shake ? [1, 0.95, 1.02, 0.98, 1] : 1 }}
              transition={{
                opacity: { delay: 1.0, duration: 0.3 },
                scale: shake
                  ? { duration: 0.5 }
                  : { delay: 1.0, duration: 0.3, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] },
              }}
            >
              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center rounded-lg bg-[#c9a87c] text-sm font-bold text-[#1f1f1f] transition-all hover:scale-[1.02] hover:brightness-90 active:scale-[0.98] disabled:opacity-80 md:h-12"
              >
                {loading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  'Sign In'
                )}
              </button>
              {shake && (
                <p className="mt-2 text-center text-xs text-[#f5222d]">
                  Invalid email or password. Try any user email from the database.
                </p>
              )}
            </motion.div>
          </form>

          {/* Demo hint */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.4 }}
            className="mt-6 rounded-lg bg-[#f5f0e8] p-3 text-xs text-[#595959]"
          >
            <p className="font-medium text-[#1f1f1f]">Demo credentials:</p>
            <p className="mt-1">Use any email from the seeded users (e.g., sarah.chen@company.com)</p>
            <p>Any password with 6+ characters works.</p>
          </motion.div>

          {/* VedaDB Connection Status */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.3 }}
            className="mt-8 flex items-center justify-center"
          >
            <VedaDBStatus />
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
        {/* Hero gradient overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(120, 119, 198, 0.3), transparent)',
          }}
        />

        {/* Illustration overlay */}
        <img
          src="./login-illustration.jpg"
          alt=""
          className="pointer-events-none absolute inset-0 z-[3] h-full w-full object-cover opacity-40 mix-blend-overlay"
          style={{ maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 80%)' }}
        />

        {/* Particle canvas */}
        <ParticleCanvas />

        {/* Particle texture overlay */}
        <img
          src="./hero-particles.png"
          alt=""
          className="pointer-events-none absolute inset-0 z-[4] h-full w-full object-cover opacity-30"
        />

        {/* Feature text */}
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
