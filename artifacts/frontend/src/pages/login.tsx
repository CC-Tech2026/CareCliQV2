import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2 } from "lucide-react";

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
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0D0D55] px-4 py-12">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg bg-[#D9F103]">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="10" height="10" rx="2" fill="#0D0D55" />
            <rect x="15" y="3" width="10" height="10" rx="2" fill="#0D0D55" opacity="0.5" />
            <rect x="3" y="15" width="10" height="10" rx="2" fill="#0D0D55" opacity="0.5" />
            <rect x="15" y="15" width="10" height="10" rx="2" fill="#0D0D55" />
          </svg>
        </div>
        <span className="text-2xl font-bold text-white tracking-tight">CareScribe</span>
        <span className="text-sm text-white/50">NDIS Clinical Documentation</span>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sign in</h1>
          <p className="text-sm text-gray-500 mt-0.5">Access your session documentation</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium text-gray-700">
              Email
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
              className="h-12 text-base rounded-xl border-gray-200 focus:border-[#5271FF] focus:ring-[#5271FF]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-medium text-gray-700">
              Password
            </Label>
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
                className="h-12 text-base rounded-xl border-gray-200 focus:border-[#5271FF] focus:ring-[#5271FF] pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full h-12 text-base font-semibold rounded-xl"
            style={{ background: "#5271FF", color: "white" }}
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </span>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <div className="relative flex items-center gap-3">
          <div className="flex-1 border-t border-gray-100" />
          <span className="text-xs text-gray-400">or</span>
          <div className="flex-1 border-t border-gray-100" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full h-12 text-base font-semibold rounded-xl border-gray-200"
          onClick={() => navigate("/signup")}
        >
          Create an account
        </Button>
      </div>

      <p className="mt-8 text-xs text-white/25 text-center max-w-xs">
        Secure access for NDIS support workers and allied health professionals.
      </p>
    </div>
  );
}
