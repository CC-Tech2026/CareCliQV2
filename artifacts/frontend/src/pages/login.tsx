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
    <div className="min-h-screen flex bg-[#F7F8FC]">
      {/* Left decorative panel */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between p-12"
        style={{ background: "linear-gradient(160deg, #0D0D55 0%, #2d1b6e 60%, #1a1050 100%)" }}>
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #FA879F 0%, #5271FF 100%)" }}>
            <ShieldCheck size={22} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-bold text-white text-[15px] leading-tight">Clinical Companion</p>
            <p className="text-[9px] uppercase tracking-widest text-white/40 font-semibold">Healthcare</p>
          </div>
        </div>

        {/* Centre quote */}
        <div className="space-y-6">
          <div className="h-1 w-12 rounded-full bg-[#FA879F]" />
          <h2 className="text-3xl font-bold text-white leading-snug">
            Compassionate care,<br />
            <span style={{ color: "#FA879F" }}>beautifully documented.</span>
          </h2>
          <p className="text-white/50 text-sm leading-relaxed max-w-xs">
            Built for NDIS support workers and allied health professionals who care about their participants and their records.
          </p>
        </div>

        {/* Bottom feature pills */}
        <div className="flex flex-wrap gap-2">
          {["AI-powered notes", "NDIS compliance", "Instant audit packs", "Voice dictation"].map((f) => (
            <span key={f} className="text-xs px-3 py-1.5 rounded-full font-medium border border-white/15 text-white/60">
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #FA879F 0%, #5271FF 100%)" }}>
            <ShieldCheck size={22} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-bold text-[#0D0D55] text-[15px]">Clinical Companion</p>
            <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold">Healthcare</p>
          </div>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#0D0D55]">Sign in</h1>
            <p className="text-sm text-slate-500 mt-1">Access your session documentation</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-[#0D0D55]">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                required
                className="h-12 text-sm rounded-xl border-slate-200 bg-white focus-visible:ring-[#FA879F] focus-visible:border-[#FA879F]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium text-[#0D0D55]">Password</Label>
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
                  className="h-12 text-sm rounded-xl border-slate-200 bg-white focus-visible:ring-[#FA879F] focus-visible:border-[#FA879F] pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={busy || !email || !password}
              className="w-full h-12 text-sm font-bold rounded-xl mt-2 transition-all"
              style={{ background: "#0D0D55", color: "white" }}
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
            <div className="flex-1 border-t border-slate-100" />
            <span className="text-xs text-slate-400">or</span>
            <div className="flex-1 border-t border-slate-100" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-12 text-sm font-semibold rounded-xl border-slate-200 bg-white text-[#0D0D55] hover:bg-slate-50"
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
