import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2, ArrowRight, ShieldCheck } from "lucide-react";

const PLUM   = "#542269";
const TEXT   = "#111827";
const MUTED  = "#6B7280";
const BORDER = "#E5E7EB";

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
      style={{ background: "#F9FAFB" }}
    >
      <div className="w-full max-w-sm">

        {/* Wordmark */}
        <div className="text-center mb-8">
          <h1 className="text-[24px] font-bold tracking-tight" style={{ color: PLUM }}>
            Care<span style={{ color: TEXT }}>Scribe</span>
          </h1>
          <p className="text-[13px] mt-1" style={{ color: MUTED }}>
            Clinical documentation for NDIS providers
          </p>
        </div>

        {/* Form card */}
        <div
          className="bg-white rounded-2xl px-8 py-8"
          style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.05), 0 0 0 1px #E5E7EB" }}
        >
          <h2 className="text-[18px] font-semibold mb-6" style={{ color: TEXT }}>
            Sign in to your account
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-[12px] font-semibold uppercase tracking-wide"
                style={{ color: MUTED }}
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
                className="w-full h-10 px-3 rounded-lg text-[14px] outline-none transition-all"
                style={{
                  background: "white",
                  border: `1px solid ${BORDER}`,
                  color: TEXT,
                }}
                onFocus={e => (e.target.style.borderColor = PLUM)}
                onBlur={e => (e.target.style.borderColor = BORDER)}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-[12px] font-semibold uppercase tracking-wide"
                  style={{ color: MUTED }}
                >
                  Password
                </label>
                <button type="button" className="text-[12px] font-medium" style={{ color: PLUM }}>
                  Forgot password?
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
                  className="w-full h-10 pl-3 pr-10 rounded-lg text-[14px] outline-none transition-all"
                  style={{
                    background: "white",
                    border: `1px solid ${BORDER}`,
                    color: TEXT,
                  }}
                  onFocus={e => (e.target.style.borderColor = PLUM)}
                  onBlur={e => (e.target.style.borderColor = BORDER)}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: MUTED }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Sign in button */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-10 rounded-lg text-white text-[14px] font-semibold flex items-center justify-center gap-2 mt-2 transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: PLUM }}
            >
              {loading
                ? <Loader2 size={16} className="animate-spin" />
                : <><span>Sign in</span><ArrowRight size={15} /></>}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px" style={{ background: BORDER }} />
            <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: MUTED }}>or</span>
            <div className="flex-1 h-px" style={{ background: BORDER }} />
          </div>

          {/* Create account */}
          <button
            type="button"
            onClick={() => navigate("/signup")}
            className="w-full h-10 rounded-lg text-[14px] font-semibold border transition-colors hover:bg-gray-50"
            style={{ borderColor: BORDER, color: TEXT }}
          >
            Create a new account
          </button>
        </div>

        {/* Trust line */}
        <div className="flex items-center justify-center gap-1.5 mt-6">
          <ShieldCheck size={13} style={{ color: MUTED }} />
          <p className="text-[11.5px]" style={{ color: MUTED }}>
            Encrypted · NDIS-compliant · SOC 2 ready
          </p>
        </div>

      </div>
    </div>
  );
}
