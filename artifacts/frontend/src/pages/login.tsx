import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import { LoginGraphic } from "@/components/AuthGraphic";

// CareScribe palette
const PLUM  = "#542269";
const CORAL = "#F1738A";

export default function Login() {
  const { login, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

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
    /*
     * Full-screen mobile-first layout:
     *  – Top section: coral/plum gradient with wordmark (~38% height)
     *  – Bottom section: white card with form (~62% height), rounded top corners
     */
    <div className="min-h-screen flex flex-col" style={{ background: `linear-gradient(155deg, ${CORAL} 0%, ${PLUM} 100%)` }}>

      {/* ── Top: brand + animated graphic ── */}
      <div className="flex flex-col items-center justify-end flex-[0_0_46%] min-h-[260px] px-6 pb-4 pt-10 text-white text-center overflow-hidden">
        <h1 className="text-[32px] font-black tracking-tight leading-none">
          Care<span style={{ color: "#FBD0DA" }}>Scribe</span>
        </h1>
        <p className="text-[10px] uppercase tracking-[0.18em] font-semibold mt-1.5 opacity-50">
          NDIS Clinical
        </p>
        <LoginGraphic />
      </div>

      {/* ── Bottom: form card (slides up on mount) ── */}
      <div
        className="flex-1 bg-white px-6 pt-8 pb-10 flex flex-col"
        style={{
          borderRadius: "28px 28px 0 0",
          boxShadow: "0 -8px 40px rgba(84,34,105,0.18)",
          animation: "cs-slide-up 0.5s cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        <div className="w-full max-w-sm mx-auto flex flex-col flex-1">
          <div className="mb-7">
            <h2 className="text-[24px] font-black" style={{ color: PLUM }}>Welcome back</h2>
            <p className="text-[14px] mt-1" style={{ color: "#9B6FAB" }}>Sign in to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 flex-1">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-bold uppercase tracking-wider" style={{ color: PLUM }}>
                Email address
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                required
                className="w-full h-12 px-4 rounded-2xl text-[14px] outline-none transition-all"
                style={{
                  background: "#FAF5FA",
                  border: "1.5px solid #E8D5E8",
                  color: "#37352F",
                }}
                onFocus={e => (e.target.style.borderColor = CORAL)}
                onBlur={e => (e.target.style.borderColor = "#E8D5E8")}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-bold uppercase tracking-wider" style={{ color: PLUM }}>
                  Password
                </label>
                <button type="button" className="text-[12px] font-semibold" style={{ color: CORAL }}>
                  Forgot?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                  required
                  className="w-full h-12 pl-4 pr-12 rounded-2xl text-[14px] outline-none transition-all"
                  style={{
                    background: "#FAF5FA",
                    border: "1.5px solid #E8D5E8",
                    color: "#37352F",
                  }}
                  onFocus={e => (e.target.style.borderColor = CORAL)}
                  onBlur={e => (e.target.style.borderColor = "#E8D5E8")}
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
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>Sign in <ArrowRight size={16} /></>
              )}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px" style={{ background: "#E8D5E8" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#C4A8CC" }}>or</span>
              <div className="flex-1 h-px" style={{ background: "#E8D5E8" }} />
            </div>

            {/* Create account */}
            <button
              type="button"
              onClick={() => navigate("/signup")}
              className="w-full h-13 py-3.5 rounded-2xl text-[14px] font-bold border-2 transition-all hover:bg-[#FAF5FA]"
              style={{ borderColor: "#E8D5E8", color: PLUM }}
            >
              Create a new account
            </button>
          </form>

          <p className="text-center text-[11px] mt-6" style={{ color: "#C4A8CC" }}>
            Secure · Encrypted · NDIS-compliant
          </p>
        </div>
      </div>
    </div>
  );
}
