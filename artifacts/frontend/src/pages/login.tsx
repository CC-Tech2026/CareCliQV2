import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

export default function Login() {
  const { login, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    try {
      const user = await login(email, password);
      if (user && !user.onboarding_complete) {
        navigate("/signup");
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      toast({
        title: "Sign in failed",
        description: err instanceof Error ? err.message : "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || isLoading;

  return (
    <div className="min-h-screen flex bg-white">
      {/* ── Left brand panel ── */}
      <div
        className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between p-12"
        style={{ background: "linear-gradient(160deg, #1A0D2E 0%, #2D1650 50%, #0D0D55 100%)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #E2457A 0%, #9B1D52 100%)" }}
          >
            <ShieldCheck size={22} color="white" strokeWidth={2.2} />
          </div>
          <div>
            <p className="font-bold text-white text-[15px] leading-tight">Clinical Companion</p>
            <p className="text-[9px] uppercase tracking-widest text-white/40 font-semibold mt-0.5">NDIS Healthcare</p>
          </div>
        </div>

        {/* Centre copy */}
        <div className="space-y-5">
          <div className="h-px w-12 rounded-full" style={{ background: "linear-gradient(90deg, #E2457A, transparent)" }} />
          <h2 className="text-[30px] font-bold text-white leading-snug">
            Compassionate care,{" "}
            <span style={{ color: "#E2457A" }}>beautifully documented.</span>
          </h2>
          <p className="text-white/50 text-sm leading-relaxed max-w-xs">
            Purpose-built for NDIS support workers and allied health professionals who put their participants first.
          </p>

          {/* Feature list */}
          <ul className="space-y-2.5 mt-2">
            {[
              "AI-powered clinical notes",
              "Real-time compliance checking",
              "Instant audit-ready reports",
              "Voice dictation & translation",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-white/60">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "#E2457A" }} />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom */}
        <p className="text-[11px] text-white/25">
          Secure, encrypted & NDIS-compliant
        </p>
      </div>

      {/* ── Right: form ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-[#FAFAFA]">
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #E2457A 0%, #9B1D52 100%)" }}
          >
            <ShieldCheck size={22} color="white" strokeWidth={2.2} />
          </div>
          <div>
            <p className="font-bold text-[#0D0D55] text-[15px]">Clinical Companion</p>
            <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold">NDIS Healthcare</p>
          </div>
        </div>

        <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm px-8 py-10">
          <div className="mb-7">
            <h1 className="text-[22px] font-bold text-[#0D0D55]">Sign in</h1>
            <p className="text-sm text-slate-500 mt-1">Access your clinical workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[13px] font-semibold text-[#0D0D55]">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                required
                className="h-11 text-[13.5px] rounded-xl border-slate-200 bg-white focus-visible:ring-[#E2457A]/20 focus-visible:border-[#E2457A]"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[13px] font-semibold text-[#0D0D55]">
                  Password
                </Label>
                <button
                  type="button"
                  className="text-[12px] font-medium hover:underline"
                  style={{ color: "#E2457A" }}
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  required
                  className="h-11 text-[13.5px] rounded-xl border-slate-200 bg-white focus-visible:ring-[#E2457A]/20 focus-visible:border-[#E2457A] pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={busy || !email || !password}
              className="w-full h-11 text-[13.5px] font-bold rounded-xl mt-1 border-0 text-white hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(135deg, #E2457A 0%, #C03068 100%)" }}
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={15} className="animate-spin" />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <div className="relative flex items-center gap-3 my-5">
            <div className="flex-1 border-t border-slate-100" />
            <span className="text-xs text-slate-400">or</span>
            <div className="flex-1 border-t border-slate-100" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-11 text-[13.5px] font-semibold rounded-xl border-slate-200 bg-white text-[#0D0D55] hover:bg-slate-50"
            onClick={() => navigate("/signup")}
          >
            Create a new account
          </Button>
        </div>

        <p className="mt-6 text-xs text-slate-400 text-center">
          Secure access for NDIS support workers and allied health professionals.
        </p>
      </div>
    </div>
  );
}
