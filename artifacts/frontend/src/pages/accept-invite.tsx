import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, CheckCircle2, AlertTriangle } from "lucide-react";

const PLUM  = "#5533CC";
const CORAL = "#F03060";
const BORDER = "#D8D0F0";

const ROLE_LABELS: Record<string, string> = {
  support_worker:      "Support Worker",
  allied_health:       "Allied Health Professional",
  support_coordinator: "Support Coordinator",
};

interface InviteInfo {
  email: string;
  role: string;
  organization_name: string | null;
  expires_at: string;
}

export default function AcceptInvite() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { updateToken } = useAuth();

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [step, setStep] = useState<"loading" | "error" | "form" | "done">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  const [fullName, setFullName]       = useState("");
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [showPass, setShowPass]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy]               = useState(false);

  // Validate the token on mount
  useEffect(() => {
    if (!token) {
      setErrorMsg("No invitation token found in the link. Please check the URL.");
      setStep("error");
      return;
    }
    fetch(`/api/invitations/validate/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Invalid or expired invitation");
        }
        return r.json();
      })
      .then((data: InviteInfo) => {
        setInvite(data);
        setStep("form");
      })
      .catch((e: Error) => {
        setErrorMsg(e.message);
        setStep("error");
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim())     { toast({ title: "Name required", variant: "destructive" }); return; }
    if (password.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return; }
    if (password !== confirm) { toast({ title: "Passwords do not match", variant: "destructive" }); return; }

    setBusy(true);
    try {
      const res = await apiFetch(`/api/invitations/accept/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim(), password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to accept invitation");
      }
      const data = await res.json();

      // Store the token + user directly via login-equivalent
      // (we call login with credentials so AuthContext does the full persist)
      if (data.access_token) {
        // Persist the token and user directly into AuthContext storage
        localStorage.setItem("carescribe_token", data.access_token);
        localStorage.setItem("carescribe_user", JSON.stringify({
          id: data.user.id,
          email: data.user.email,
          full_name: data.user.full_name,
          role: data.user.role,
          account_type: data.user.account_type,
          organization_id: data.user.organization_id,
          organizationId: data.user.organization_id,
          onboarding_complete: true,
        }));
        await updateToken(data.access_token);
      }

      setStep("done");
      toast({ title: "Welcome to CareScribe!", description: "Your account has been activated." });
      const destination = data.user?.role === "support_worker" ? "/worker-onboarding" : "/dashboard";
      setTimeout(() => navigate(destination), 1800);
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed to activate account", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #F5F3FC 0%, #EDE9FF 60%, #FCE9EF 100%)" }}
    >
      <div
        className="w-full max-w-md rounded-3xl p-8 shadow-xl"
        style={{ background: "rgba(255,255,255,0.96)", border: `1px solid ${BORDER}` }}
      >
        {/* Logo mark */}
        <div className="flex justify-center mb-6">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-sm"
            style={{ background: `linear-gradient(135deg, ${PLUM} 0%, ${CORAL} 100%)` }}
          >
            C
          </div>
        </div>

        {step === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="animate-spin" style={{ color: PLUM }} size={32} />
            <p className="text-sm" style={{ color: "#7A6A9E" }}>Validating your invitation…</p>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <AlertTriangle size={40} style={{ color: CORAL }} />
            <h2 className="text-xl font-bold" style={{ color: "#1E1640" }}>Invitation Issue</h2>
            <p className="text-sm leading-relaxed" style={{ color: "#7A6A9E" }}>{errorMsg}</p>
            <a
              href="/login"
              className="text-sm font-medium underline underline-offset-2"
              style={{ color: PLUM }}
            >
              Go to Sign In
            </a>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 size={48} style={{ color: "#22c55e" }} />
            <h2 className="text-xl font-bold" style={{ color: "#1E1640" }}>Account Activated!</h2>
            <p className="text-sm" style={{ color: "#7A6A9E" }}>Taking you to your dashboard…</p>
          </div>
        )}

        {step === "form" && invite && (
          <>
            <h1 className="text-2xl font-bold text-center mb-1" style={{ color: "#1E1640" }}>
              You've been invited
            </h1>
            <p className="text-sm text-center mb-6" style={{ color: "#7A6A9E" }}>
              {invite.organization_name
                ? <><strong style={{ color: "#1E1640" }}>{invite.organization_name}</strong> has invited you as a{" "}</>
                : "You've been invited as a "}
              <span
                className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{ background: "rgba(85,51,204,0.1)", color: PLUM }}
              >
                {ROLE_LABELS[invite.role] || invite.role}
              </span>
            </p>

            {/* Pre-filled email (read-only) */}
            <div className="mb-4 rounded-xl px-4 py-3 flex items-center gap-2"
              style={{ background: "rgba(85,51,204,0.04)", border: `1px solid ${BORDER}` }}>
              <span className="text-xs font-medium" style={{ color: "#7A6A9E" }}>Email</span>
              <span className="ml-auto text-sm font-medium" style={{ color: "#1E1640" }}>{invite.email}</span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Full name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium" style={{ color: "#4A3D5A" }}>Your Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Jordan Smith"
                  required
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                  style={{ border: `1.5px solid ${BORDER}`, color: "#1E1640" }}
                  onFocus={(e) => (e.target.style.borderColor = PLUM)}
                  onBlur={(e) => (e.target.style.borderColor = BORDER)}
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium" style={{ color: "#4A3D5A" }}>Create Password</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    required
                    className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none transition-all"
                    style={{ border: `1.5px solid ${BORDER}`, color: "#1E1640" }}
                    onFocus={(e) => (e.target.style.borderColor = PLUM)}
                    onBlur={(e) => (e.target.style.borderColor = BORDER)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "#7A6A9E" }}
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium" style={{ color: "#4A3D5A" }}>Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    required
                    className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none transition-all"
                    style={{ border: `1.5px solid ${confirm && confirm !== password ? CORAL : BORDER}`, color: "#1E1640" }}
                    onFocus={(e) => (e.target.style.borderColor = confirm !== password ? CORAL : PLUM)}
                    onBlur={(e) => (e.target.style.borderColor = confirm && confirm !== password ? CORAL : BORDER)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "#7A6A9E" }}
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {confirm && confirm !== password && (
                  <p className="text-xs" style={{ color: CORAL }}>Passwords do not match</p>
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
                style={{
                  background: `linear-gradient(135deg, ${PLUM} 0%, ${CORAL} 100%)`,
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Activate My Account
              </button>
            </form>

            <p className="text-center text-xs mt-5" style={{ color: "#7A6A9E" }}>
              Already have an account?{" "}
              <a href="/login" className="font-medium underline underline-offset-2" style={{ color: PLUM }}>
                Sign in
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
