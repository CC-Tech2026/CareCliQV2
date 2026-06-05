import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, ArrowRight } from "lucide-react";

// ── Palette Alignment ────────────────────────────────────────────────────────
const PLUM = "#5533CC"; // Brand Purple
const CORAL = "#F03060"; // Brand Coral
const BORDER = "#D8D0F0"; // Indigo-tinted border

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setBusy(true);
    try {
      await login(email, password);
      toast({
        title: "Welcome back!",
        description: "Your terminal instance has safely initialized.",
      });
      navigate("/dashboard");
    } catch (err) {
      toast({
        title: "Authentication Failed",
        description:
          err instanceof Error ? err.message : "Invalid email or password.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-12 font-sans selection:bg-[#5533CC]/20 relative overflow-hidden" style={{ animation: "authPageEnter 0.3s ease-out" }}>
      {/* ── Injection of Fluid Animation Keyframes ────────────────────────── */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes fluidMesh {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            @keyframes softFloat {
              0%, 100% { transform: translateY(0px) scale(1); }
              50% { transform: translateY(-12px) scale(1.02); }
            }
            @keyframes softFloatDelayed {
              0%, 100% { transform: translateY(0px) scale(1); }
              50% { transform: translateY(12px) scale(0.98); }
            }
            @keyframes softFloatAlt {
              0%, 100% { transform: translateY(0px) translateX(0px); }
              50% { transform: translateY(-8px) translateX(6px); }
            }
            @keyframes softFloatDrift {
              0%, 100% { transform: translateY(0px) translateX(0px) rotate(0deg); }
              50% { transform: translateY(10px) translateX(-8px) rotate(3deg); }
            }
            @keyframes authPageEnter {
              from { opacity: 0; transform: translateY(6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            .animate-fluid-bg {
              background: linear-gradient(-45deg, #F03060, #FF5E7E, #5533CC, #9B5DE5);
              background-size: 400% 400%;
              animation: fluidMesh 12s ease infinite;
            }
            .animate-float-card {
              animation: softFloat 6s ease-in-out infinite;
            }
            .animate-shape-1 {
              animation: softFloat 7s ease-in-out infinite;
            }
            .animate-shape-2 {
              animation: softFloatDelayed 9s ease-in-out infinite;
            }
            .animate-shape-3 {
              animation: softFloatAlt 8s ease-in-out infinite;
            }
            .animate-shape-4 {
              animation: softFloatDrift 10s ease-in-out infinite;
            }
          `,
        }}
      />

      {/* ── SaaS Animated Bright Canvas Backdrop ──────────────────────────── */}
      <div className="absolute inset-0 z-0 animate-fluid-bg" />

      {/* Subtle overlay grid to add premium texture to the bright canvas */}
      <div
        className="absolute inset-0 z-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      {/* ── LEFT PANEL: Form & Workspace Entry (5 Columns) ────────────────────── */}
      <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-10 md:p-12 bg-white/95 backdrop-blur-md relative z-10 shadow-[8px_0_32px_rgba(0,0,0,0.08)]">
        {/* Top brand header utilizing logo.png */}
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="CareCliQ"
            className="h-16 w-auto object-contain transition-transform duration-300 hover:scale-[1.02]"
          />
          <div className="h-4 w-[1px] bg-gray-200" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7A6A9E]">
            Workspace
          </span>
        </div>

        {/* Central Card Form */}
        <div className="w-full max-w-sm mx-auto my-auto py-8 transition-transform duration-500 ease-out">
          <div className="mb-8">
            <h1
              className="text-[26px] font-black tracking-tight"
              style={{ color: PLUM }}
            >
              Welcome back
            </h1>
            <p
              className="text-[14px] font-medium mt-1"
              style={{ color: "#7A6A9E" }}
            >
              Sign in to your clinical note workspace.
            </p>
          </div>

          <form onSubmit={handleSignIn} className="space-y-5">
            {/* Email Address */}
            <div className="group relative">
              <label
                className="text-[11px] font-bold uppercase tracking-wider mb-1.5 block transition-colors duration-200 group-focus-within:text-[#F03060]"
                style={{ color: PLUM }}
              >
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={busy}
                autoComplete="email"
                required
                className="w-full h-12 px-4 rounded-2xl text-[14px] font-medium outline-none transition-all duration-200 border border-solid focus:shadow-[0_0_0_4px_rgba(240,48,96,0.12)] bg-[#F5F3FC]"
                style={{
                  borderColor: BORDER,
                  color: "#1E1640",
                }}
              />
            </div>

            {/* Password */}
            <div className="group relative">
              <div className="flex justify-between items-center mb-1.5">
                <label
                  className="text-[11px] font-bold uppercase tracking-wider transition-colors duration-200 group-focus-within:text-[#F03060]"
                  style={{ color: PLUM }}
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="text-[12px] font-bold transition-opacity hover:opacity-80"
                  style={{ color: CORAL }}
                >
                  Forgot?
                </button>
              </div>
              <div className="relative w-full">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={busy}
                  autoComplete="current-password"
                  required
                  className="w-full h-12 px-4 pr-12 rounded-2xl text-[14px] font-medium outline-none transition-all duration-200 border border-solid focus:shadow-[0_0_0_4px_rgba(240,48,96,0.12)] bg-[#F5F3FC]"
                  style={{
                    borderColor: BORDER,
                    color: "#1E1640",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#DEB2E4] hover:bg-black/5 transition-colors"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Interactive Sign-In Button */}
            <button
              type="submit"
              disabled={busy || !email.trim() || !password}
              className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 mt-2 transition-all duration-300 hover:opacity-95 shadow-[0_8px_24px_-6px_rgba(240,48,96,0.3)] hover:shadow-[0_12px_28px_-4px_rgba(240,48,96,0.4)] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none"
              style={{
                background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
              }}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Securing Session…</span>
                </>
              ) : (
                <>
                  <span>Sign In to Environment</span>
                  <ArrowRight size={16} strokeWidth={2.5} />
                </>
              )}
            </button>
          </form>

          {/* Footer Navigation */}
          <p
            className="text-center text-[13px] font-medium mt-6"
            style={{ color: "#7A6A9E" }}
          >
            Don't have an account?{" "}
            <button
              onClick={() => navigate("/signup")}
              className="font-black transition-all duration-200 hover:opacity-75 focus:outline-none focus-visible:underline rounded"
              style={{ color: CORAL }}
            >
              Create an account
            </button>
          </p>
        </div>

        {/* Compliance anchor */}
        <p className="text-[11px] font-medium text-center lg:text-left text-gray-400">
          Secure end-to-end encrypted instance. Aligned with NDIS & AHPRA
          compliance guidelines.
        </p>
      </div>

      {/* ── RIGHT PANEL: Unified Welcome Graphics Showcase (7 Columns) ────────── */}
      <div className="hidden lg:col-span-7 lg:flex flex-col items-center justify-center p-12 relative overflow-hidden z-10">
        {/* ── Custom Background Brand Shapes ────────────────────────────────── */}
        <div className="absolute inset-0 z-0 pointer-events-none select-none opacity-85">
          {/* Top Left Background Shape Asset */}
          <img
            src="/shape1_login.png"
            alt=""
            className="absolute top-[-8%] left-[-5%] w-[65%] h-auto max-w-[400px] object-contain animate-shape-1"
          />

          {/* Center Right Accent Background Shape Asset */}
          <img
            src="/shape3_login.png"
            alt=""
            className="absolute top-[-10%] right-[-5%] w-[90%] h-auto max-w-[420px] object-contain mix-blend-screen animate-shape-3"
          />

          {/* Bottom Left Accent Background Shape Asset */}
          <img
            src="/shape4_login.png"
            alt=""
            className="absolute bottom-[-1%] left-[-1%] w-[55%] h-auto max-w-[300px] object-contain mix-blend-lighten opacity-90 animate-shape-4"
          />

          {/* Bottom Right Background Shape Asset */}
          <img
            src="/shape2_login.png"
            alt=""
            className="absolute bottom-[-6%] right-[-5%] w-[75%] h-auto max-w-[400px] object-contain animate-shape-2"
          />
        </div>

        {/* Dynamic Graphic Container */}
        <div className="w-full max-w-xl flex flex-col items-center relative z-10 animate-float-card">
          {/* Main Visual Display hosting your welcome asset */}
          <div className="w-full aspect-[4/3] bg-white/40 backdrop-blur-md rounded-[2.5rem] p-4 border border-solid border-white/20 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.15)] relative overflow-hidden flex items-center justify-center group">
            <img
              src="/login_welcome.jpg"
              alt="CareCliQ Connections Workspace Overview"
              className="w-full h-full object-cover rounded-[1.75rem] transition-transform duration-700 ease-out group-hover:scale-[1.01]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
