import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2, ArrowRight, ShieldCheck } from "lucide-react";

const PLUM   = "#542269";
const CORAL  = "#F1738A";
const TEXT   = "#1C1626";
const MUTED  = "#7A6A8A";
const BORDER = "#E8D5E8";
const BG     = "#FAF5FA";

export default function Login() {
  const { login, isLoading } = useAuth();
  const [, navigate]         = useLocation();
  const { toast }            = useToast();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy]         = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    try {
      const u = await login(email, password);
      navigate(u && !u.onboarding_complete ? "/signup" : "/dashboard");
    } catch (err) {
      toast({
        title: "Sign in failed",
        description: err instanceof Error ? err.message : "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const loading = busy || isLoading;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "#FAF5FF" }}
    >
      <div className="w-full max-w-sm">

        {/* Wordmark */}
        <div className="text-center mb-8">
          <h1 className="text-[26px] font-black tracking-tight">
            <span style={{ color: TEXT }}>Care</span>
            <span style={{ color: CORAL }}>Scribe</span>
          </h1>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] mt-1" style={{ color: MUTED }}>
            NDIS Clinical Workspace
          </p>
        </div>

        {/* Form card */}
        <div
          className="bg-white rounded-3xl px-8 py-8"
          style={{ boxShadow: "0 4px 24px rgba(84,34,105,0.10), 0 0 0 1px rgba(232,213,232,0.5)" }}
        >
          <h2 className="text-[20px] font-black mb-6" style={{ color: PLUM }}>
            Welcome back
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-[11px] font-bold uppercase tracking-wider"
                style={{ color: PLUM }}
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                required
                className="w-full h-12 px-4 rounded-2xl text-[14px] outline-none transition-all"
                style={{ background: BG, border: `1.5px solid ${BORDER}`, color: TEXT }}
                onFocus={e => (e.target.style.borderColor = CORAL)}
                onBlur={e => (e.target.style.borderColor = BORDER)}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: PLUM }}
                >
                  Password
                </label>
                <button type="button" className="text-[12px] font-semibold" style={{ color: CORAL }}>
                  Forgot?
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                  required
                  className="w-full h-12 pl-4 pr-12 rounded-2xl text-[14px] outline-none transition-all"
                  style={{ background: BG, border: `1.5px solid ${BORDER}`, color: TEXT }}
                  onFocus={e => (e.target.style.borderColor = CORAL)}
                  onBlur={e => (e.target.style.borderColor = BORDER)}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                  style={{ color: "#DEB2E4" }}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Sign in button */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 mt-2 transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              {loading
                ? <Loader2 size={18} className="animate-spin" />
                : <><span>Sign in</span> <ArrowRight size={16} /></>}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px" style={{ background: BORDER }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#C4A8CC" }}>or</span>
            <div className="flex-1 h-px" style={{ background: BORDER }} />
          </div>

          {/* Create account */}
          <button
            type="button"
            onClick={() => navigate("/signup")}
            className="w-full h-13 py-3.5 rounded-2xl text-[14px] font-bold border-2 transition-all hover:bg-[#FAF5FA]"
            style={{ borderColor: BORDER, color: PLUM }}
          >
            Create a new account
          </button>
        </div>

        {/* Trust line */}
        <div className="flex items-center justify-center gap-1.5 mt-6">
          <ShieldCheck size={13} style={{ color: MUTED }} />
          <p className="text-[11.5px]" style={{ color: MUTED }}>
            Secure · Encrypted · NDIS-compliant
          </p>
        </div>

      </div>
    </div>
  );
}
