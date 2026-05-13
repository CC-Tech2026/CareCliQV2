import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const { login, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      toast({
        title: "Login failed",
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
      {/* Logo mark */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
          style={{ background: "#D9F103" }}
        >
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
              onChange={e => setEmail(e.target.value)}
              disabled={busy}
              required
              className="h-12 text-base rounded-xl border-gray-200 focus:border-[#5271FF] focus:ring-[#5271FF]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-medium text-gray-700">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={busy}
              required
              className="h-12 text-base rounded-xl border-gray-200 focus:border-[#5271FF] focus:ring-[#5271FF]"
            />
          </div>

          <Button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full h-12 text-base font-semibold rounded-xl"
            style={{ background: "#5271FF", color: "white" }}
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Signing in…
              </span>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <div className="text-center">
          <button
            type="button"
            className="text-sm text-[#5271FF] hover:underline"
            onClick={() =>
              toast({
                title: "Password reset",
                description: "Contact your administrator to reset your password.",
              })
            }
          >
            Forgot password?
          </button>
        </div>
      </div>

      {/* Role info */}
      <p className="mt-8 text-xs text-white/30 text-center max-w-xs">
        Secure access for NDIS support workers and allied health professionals.
        Contact your administrator for account access.
      </p>
    </div>
  );
}
