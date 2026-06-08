import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const BORDER = "#D8D0F0";

function readRecoveryParams(): { access_token: string; token_hash: string } {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return {
    access_token: hash.get("access_token") || query.get("access_token") || "",
    token_hash: hash.get("token_hash") || query.get("token_hash") || "",
  };
}

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const recovery = useMemo(readRecoveryParams, []);
  const hasRecoveryToken = !!(recovery.access_token || recovery.token_hash);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!hasRecoveryToken) {
      toast({ title: "Reset link expired", description: "Request a new reset link.", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: recovery.access_token, token_hash: recovery.token_hash, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Could not update password.");
      }
      setComplete(true);
      toast({ title: "Password updated", description: "You can now sign in." });
    } catch (error) {
      toast({
        title: "Password reset failed",
        description: error instanceof Error ? error.message : "Please request a new link.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F5F3FC]">
      <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-10 md:p-12 bg-white">
        <div className="flex items-center gap-3">
          <img src="/carecliQ_logo.png" alt="CareCliQ" className="h-9 w-auto object-contain" />
          <div className="h-4 w-[1px] bg-gray-200" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7A6A9E]">Workspace</span>
        </div>

        <div className="w-full max-w-sm mx-auto my-auto py-8">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold mb-6"
            style={{ color: PLUM }}
          >
            <ArrowLeft className="h-4 w-4" /> Back to login
          </button>

          <div className="mb-8">
            <h1 className="text-[26px] font-black tracking-tight" style={{ color: PLUM }}>
              Create new password
            </h1>
            <p className="text-[14px] font-medium mt-1" style={{ color: "#7A6A9E" }}>
              Choose a new password for your CareCliQ workspace.
            </p>
          </div>

          {complete ? (
            <div className="rounded-2xl border p-5" style={{ borderColor: BORDER, background: "#F5F3FC" }}>
              <CheckCircle2 className="h-8 w-8 mb-3" style={{ color: PLUM }} />
              <p className="text-[15px] font-bold" style={{ color: "#1E1640" }}>Password updated</p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-4 h-11 px-5 rounded-2xl text-white font-bold"
                style={{ background: PLUM }}
              >
                Sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {!hasRecoveryToken && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  This reset link is missing its recovery token. Request a new password reset link.
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: PLUM }}>
                  New password
                </label>
                <div className="relative">
                  <LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#7A6A9E]" />
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    disabled={busy}
                    className="w-full h-12 pl-11 pr-12 rounded-2xl text-[14px] font-medium outline-none border bg-[#F5F3FC]"
                    style={{ borderColor: BORDER, color: "#1E1640" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7A6A9E]"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: PLUM }}>
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  required
                  disabled={busy}
                  className="w-full h-12 px-4 rounded-2xl text-[14px] font-medium outline-none border bg-[#F5F3FC]"
                  style={{ borderColor: BORDER, color: "#1E1640" }}
                />
              </div>
              <button
                type="submit"
                disabled={busy || !hasRecoveryToken || password.length < 8 || password !== confirm}
                className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Update password
              </button>
            </form>
          )}
        </div>

        <p className="text-[11px] font-medium text-gray-400">
          Reset tokens are short-lived and verified by Supabase Auth.
        </p>
      </div>

      <div className="hidden lg:flex lg:col-span-7 items-center justify-center p-12 bg-gradient-to-br from-[#F03060] via-[#9B5DE5] to-[#5533CC]">
        <img src="/login_welcome.jpg" alt="CareCliQ workspace" className="max-w-xl w-full rounded-[2rem] shadow-2xl" />
      </div>
    </div>
  );
}
