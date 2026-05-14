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
    <div className="min-h-screen flex bg-[#FFF9FB]">
      {/* ── Left panel ── */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: "linear-gradient(155deg, #0D0D55 0%, #3d1263 55%, #1a0840 100%)" }}>

        {/* Decorative lime blob top-right */}
        <div className="absolute -top-20 -right-20 w-56 h-56 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #D9F103 0%, transparent 70%)" }} />
        {/* Decorative pink blob bottom-left */}
        <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full opacity-25"
          style={{ background: "radial-gradient(circle, #FA879F 0%, transparent 70%)" }} />

        {/* Logo */}
        <div className="flex items-center gap-3 relative">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shadow-lg"
            style={{ background: "linear-gradient(135deg, #FA879F 0%, #D9F103 100%)" }}>
            <ShieldCheck size={22} color="#0D0D55" strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-bold text-white text-[15px] leading-tight">Clinical Companion</p>
            <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: "#D9F103" }}>Healthcare</p>
          </div>
        </div>

        {/* Centre copy */}
        <div className="space-y-6 relative">
          {/* Pink → lime gradient bar */}
          <div className="h-1 w-14 rounded-full"
            style={{ background: "linear-gradient(90deg, #FA879F 0%, #D9F103 100%)" }} />
          <h2 className="text-[32px] font-bold text-white leading-tight">
            Compassionate care,{" "}
            <span style={{ color: "#FA879F" }}>beautifully</span>{" "}
            <span style={{ color: "#D9F103" }}>documented.</span>
          </h2>
          <p className="text-white/50 text-sm leading-relaxed max-w-xs">
            Built for NDIS support workers and allied health professionals who care deeply about their participants and their records.
          </p>

          {/* Stat chips */}
          <div className="flex flex-wrap gap-3 mt-2">
            {[
              { label: "AI-powered notes", accent: "#FA879F" },
              { label: "NDIS compliance", accent: "#D9F103" },
              { label: "Instant audit packs", accent: "#FA879F" },
              { label: "Voice dictation", accent: "#D9F103" },
            ].map(({ label, accent }) => (
              <span key={label}
                className="text-xs px-3 py-1.5 rounded-full font-semibold border text-white/70"
                style={{ borderColor: `${accent}35`, background: `${accent}10` }}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom badge */}
        <div className="flex items-center gap-2 relative">
          <div className="h-2 w-2 rounded-full bg-[#D9F103] animate-pulse" />
          <p className="text-[11px] text-white/40">Secure, encrypted, NDIS-compliant platform</p>
        </div>
      </div>

      {/* ── Right: form ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shadow-sm"
            style={{ background: "linear-gradient(135deg, #FA879F 0%, #D9F103 100%)" }}>
            <ShieldCheck size={22} color="#0D0D55" strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-bold text-[#0D0D55] text-[15px]">Clinical Companion</p>
            <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: "#FA879F" }}>Healthcare</p>
          </div>
        </div>

        <div className="w-full max-w-sm">
          {/* Pink top accent bar */}
          <div className="h-1 w-10 rounded-full mb-6"
            style={{ background: "linear-gradient(90deg, #FA879F 0%, #D9F103 100%)" }} />

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#0D0D55]">Welcome back</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in to your clinical workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-semibold text-[#0D0D55]">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                required
                className="h-12 text-sm rounded-xl border-rose-100 bg-white focus-visible:ring-[#FA879F]/30 focus-visible:border-[#FA879F]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-semibold text-[#0D0D55]">Password</Label>
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
                  className="h-12 text-sm rounded-xl border-rose-100 bg-white focus-visible:ring-[#FA879F]/30 focus-visible:border-[#FA879F] pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#FA879F] transition-colors"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={busy || !email || !password}
              className="w-full h-12 text-sm font-bold rounded-xl mt-2 border-0 text-white transition-all hover:opacity-90 shadow-md"
              style={{ background: "linear-gradient(90deg, #FA879F 0%, #e0607a 100%)" }}
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <div className="relative flex items-center gap-3 my-5">
            <div className="flex-1 border-t border-rose-100" />
            <span className="text-xs text-slate-400">or</span>
            <div className="flex-1 border-t border-rose-100" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-12 text-sm font-semibold rounded-xl border-rose-100 bg-white text-[#0D0D55] hover:bg-rose-50/60"
            onClick={() => navigate("/signup")}
          >
            Create an account
          </Button>

          <p className="mt-8 text-xs text-slate-400 text-center">
            Secure access for NDIS support workers and allied health professionals.
          </p>
        </div>
      </div>
    </div>
  );
}
