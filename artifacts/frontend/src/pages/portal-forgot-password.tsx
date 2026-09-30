import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { PortalAuthLayout, portalButtonClass, portalInputClass } from "@/components/participant-portal/PortalAuthLayout";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const DANGER = "#B42318";

/** Participants Portal "forgot password" — the emailed reset link returns to
 * the portal sign-in (portal: true), not the staff one. */
export default function PortalForgotPasswordPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), portal: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "We couldn't send the email. Please try again.");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send the email. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalAuthLayout title="Reset password">
      {sent ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 size={40} className="mx-auto" style={{ color: PLUM }} />
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Check your email</h1>
          <p className="text-[14px]" style={{ color: MUTED }}>
            If {email.trim()} has a portal account, we've sent a link to reset the password.
          </p>
          <button className={portalButtonClass} style={{ background: PLUM }} onClick={() => navigate("/portal/login")}>
            Back to sign in
          </button>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Forgot your password?</h1>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>
              Enter the email address you sign in with and we'll send you a link to set a new one.
            </p>
          </div>
          <div>
            <label htmlFor="portal-reset-email" className="text-[13px] font-bold" style={{ color: TEXT }}>Email address</label>
            <input
              id="portal-reset-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={portalInputClass}
              style={{ borderColor: BORDER, color: TEXT, background: SURFACE }}
            />
          </div>
          {error && <p role="alert" className="text-[13px] font-semibold" style={{ color: DANGER }}>{error}</p>}
          <button type="submit" disabled={busy || !email.trim()} className={portalButtonClass} style={{ background: PLUM }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />} Send reset link
          </button>
          <button type="button" className="w-full text-center text-[14px] font-bold" style={{ color: PLUM }} onClick={() => navigate("/portal/login")}>
            Back to sign in
          </button>
        </form>
      )}
    </PortalAuthLayout>
  );
}
