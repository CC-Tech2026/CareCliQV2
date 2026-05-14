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
    <div className="min-h-screen flex" style={{ background: "#F4F2FB" }}>
      {/* ── Left brand panel ── */}
      <div
        className="hidden lg:flex w-[400px] shrink-0 flex-col justify-between p-12"
        style={{ background: "linear-gradient(155deg, #2E2A5C 0%, #3D3580 50%, #4A4A9C 100%)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #F4C3D9 0%, #7B8FD4 100%)" }}
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
          {/* Blush accent line */}
          <div className="h-px w-10 rounded-full" style={{ background: "#F4C3D9" }} />

          <h2 className="text-[28px] font-bold text-white leading-snug">
            Compassionate care,{" "}
            <span style={{ color: "#F4C3D9" }}>beautifully documented.</span>
          </h2>
          <p className="text-white/50 text-sm leading-relaxed max-w-xs">
            Purpose-built for NDIS support workers and allied health professionals who put their participants first.
          </p>

          <ul className="space-y-2.5 pt-1">
            {[
              "AI-powered clinical notes",
              "Real-time compliance checking",
              "Instant audit-ready reports",
              "Voice dictation & translation",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-white/60">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "#F4C3D9" }} />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-white/25">Secure, encrypted & NDIS-compliant</p>
      </div>

      {/* ── Right: form ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12" style={{ background: "#F4F2FB" }}>
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #F4C3D9, #7B8FD4)" }}
          >
            <ShieldCheck size={22} color="white" strokeWidth={2.2} />
          </div>
          <div>
            <p className="font-bold text-[15px]" style={{ color: "#37352F" }}>Clinical Companion</p>
            <p className="text-[9px] uppercase tracking-widest font-semibold mt-0.5" style={{ color: "#718096" }}>
              NDIS Healthcare
            </p>
          </div>
        </div>

        <div
          className="w-full max-w-sm bg-white rounded-2xl px-8 py-10"
          style={{ border: "1px solid #E8E4F0", boxShadow: "0 4px 24px rgba(123,143,212,0.08)" }}
        >
          <div className="mb-7">
            <h1 className="text-[22px] font-bold" style={{ color: "#37352F" }}>Welcome back</h1>
            <p className="text-sm mt-1" style={{ color: "#718096" }}>Sign in to your clinical workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[13px] font-semibold" style={{ color: "#37352F" }}>
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
                className="h-11 text-[13.5px] rounded-xl bg-white focus-visible:ring-[#7B8FD4]/25 focus-visible:border-[#7B8FD4]"
                style={{ borderColor: "#E8E4F0" }}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[13px] font-semibold" style={{ color: "#37352F" }}>
                  Password
                </Label>
                <button
                  type="button"
                  className="text-[12px] font-medium hover:underline"
                  style={{ color: "#7B8FD4" }}
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
                  className="h-11 text-[13.5px] rounded-xl bg-white focus-visible:ring-[#7B8FD4]/25 focus-visible:border-[#7B8FD4] pr-11"
                  style={{ borderColor: "#E8E4F0" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: "#A0AEC0" }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={busy || !email || !password}
              className="w-full h-11 text-[13.5px] font-bold rounded-xl mt-1 border-0 text-white hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(135deg, #8B9FE8 0%, #6B7FD4 100%)" }}
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
            <div className="flex-1 border-t" style={{ borderColor: "#E8E4F0" }} />
            <span className="text-xs" style={{ color: "#A0AEC0" }}>or</span>
            <div className="flex-1 border-t" style={{ borderColor: "#E8E4F0" }} />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-11 text-[13.5px] font-semibold rounded-xl bg-white hover:bg-[#F8F6FC]"
            style={{ borderColor: "#E8E4F0", color: "#37352F" }}
            onClick={() => navigate("/signup")}
          >
            Create a new account
          </Button>
        </div>

        <p className="mt-6 text-xs text-center" style={{ color: "#A0AEC0" }}>
          Secure access for NDIS support workers and allied health professionals.
        </p>
      </div>
    </div>
  );
}
