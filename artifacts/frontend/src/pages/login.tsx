import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2, PenLine } from "lucide-react";

// CareScribe palette
const PLUM   = "#542269";
const CORAL  = "#F1738A";
const BLUSH  = "#F6B8C0";
const LILAC  = "#EFDCEF";
const PURPLE = "#DEB2E4";
const BORDER = "#E8D5E8";

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
    <div className="min-h-screen flex" style={{ background: LILAC }}>
      {/* ── Left brand panel ── */}
      <div
        className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between p-12"
        style={{ background: `linear-gradient(160deg, ${PLUM} 0%, #3D1855 55%, #2A1040 100%)` }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div
            className="h-11 w-11 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`, boxShadow: `0 4px 14px rgba(241,115,138,0.4)` }}
          >
            <PenLine size={20} color="white" strokeWidth={2.3} />
          </div>
          <div>
            <p className="font-bold text-white text-[16px] leading-tight tracking-tight">CareScribe</p>
            <p className="text-[9px] uppercase tracking-widest font-semibold mt-0.5" style={{ color: PURPLE }}>NDIS Clinical</p>
          </div>
        </div>

        {/* Centre copy */}
        <div className="space-y-6">
          <div className="h-px w-10 rounded-full" style={{ background: BLUSH }} />

          <h2 className="text-[30px] font-bold text-white leading-snug">
            Compassionate care,{" "}
            <span style={{ color: BLUSH }}>beautifully documented.</span>
          </h2>
          <p className="text-white/45 text-[14px] leading-relaxed max-w-xs">
            Purpose-built for NDIS support workers and allied health professionals.
          </p>

          <ul className="space-y-3 pt-1">
            {[
              "AI-powered clinical notes",
              "Real-time compliance checking",
              "Instant audit-ready reports",
              "Voice dictation & translation",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-[13.5px] text-white/55">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: BLUSH }} />
                {f}
              </li>
            ))}
          </ul>

          {/* Decorative pill */}
          <div className="inline-flex items-center gap-2 mt-2 px-3.5 py-2 rounded-full" style={{ background: "rgba(222,178,228,0.12)", border: "1px solid rgba(222,178,228,0.2)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CORAL }} />
            <span className="text-[11px] font-medium" style={{ color: PURPLE }}>Secure · Encrypted · NDIS-compliant</span>
          </div>
        </div>

        <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>© 2025 CareScribe</p>
      </div>

      {/* ── Right: form ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12" style={{ background: LILAC }}>
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
          >
            <PenLine size={19} color="white" strokeWidth={2.3} />
          </div>
          <div>
            <p className="font-bold text-[15px]" style={{ color: PLUM }}>CareScribe</p>
            <p className="text-[9px] uppercase tracking-widest font-semibold mt-0.5" style={{ color: "#9B6FAB" }}>NDIS Clinical</p>
          </div>
        </div>

        <div
          className="w-full max-w-sm bg-white rounded-2xl px-8 py-10"
          style={{ border: `1px solid ${BORDER}`, boxShadow: `0 4px 28px rgba(84,34,105,0.10)` }}
        >
          <div className="mb-7">
            <h1 className="text-[22px] font-bold" style={{ color: "#37352F" }}>Welcome back</h1>
            <p className="text-sm mt-1" style={{ color: "#7A5E7A" }}>Sign in to your CareScribe workspace</p>
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
                className="h-11 text-[13.5px] rounded-xl bg-white"
                style={{ borderColor: BORDER }}
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
                  style={{ color: CORAL }}
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
                  className="h-11 text-[13.5px] rounded-xl bg-white pr-11"
                  style={{ borderColor: BORDER }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: PURPLE }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={busy || !email || !password}
              className="w-full h-11 text-[13.5px] font-bold rounded-xl mt-1 border-0 text-white hover:opacity-90 transition-opacity"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
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
            <div className="flex-1 border-t" style={{ borderColor: BORDER }} />
            <span className="text-xs" style={{ color: PURPLE }}>or</span>
            <div className="flex-1 border-t" style={{ borderColor: BORDER }} />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-11 text-[13.5px] font-semibold rounded-xl bg-white"
            style={{ borderColor: BORDER, color: PLUM }}
            onMouseEnter={e => (e.currentTarget.style.background = "#FAF0FA")}
            onMouseLeave={e => (e.currentTarget.style.background = "white")}
            onClick={() => navigate("/signup")}
          >
            Create a new account
          </Button>
        </div>

        <p className="mt-6 text-xs text-center" style={{ color: "#9B6FAB" }}>
          Secure access for NDIS support workers and allied health professionals.
        </p>
      </div>
    </div>
  );
}
