import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { defaultHomePathForRole, resolvePostLoginPath } from "@/lib/auth-session";
import { clearViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { PortalAuthLayout, portalButtonClass, portalInputClass } from "@/components/participant-portal/PortalAuthLayout";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const DANGER = "#B42318";

/**
 * Participants Portal sign-in — separate from the staff /login. Sends
 * portal: "participant", so the backend refuses staff accounts here (and
 * the staff sign-in refuses participant accounts).
 */
export default function PortalLoginPage() {
  const [, navigate] = useLocation();
  const { login, completeMfaLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function goHome(user: { id: string; role: string }) {
    clearViewingParticipant(user.id);
    navigate(resolvePostLoginPath(user.id, defaultHomePathForRole(user.role)));
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await login(email.trim(), password, false, "participant");
      if (result.status === "mfa_required") {
        setMfaToken(result.challengeToken);
        return;
      }
      goHome(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect email or password.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      goHome(await completeMfaLogin(mfaToken, mfaCode.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle = { borderColor: BORDER, color: TEXT, background: SURFACE };

  return (
    <PortalAuthLayout title="Sign in">
      {mfaToken ? (
        <form className="space-y-5" onSubmit={handleMfa}>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Enter your code</h1>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Enter the code from your authenticator app.</p>
          </div>
          <input
            aria-label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            className={portalInputClass}
            style={fieldStyle}
          />
          {error && <p role="alert" className="text-[13px] font-semibold" style={{ color: DANGER }}>{error}</p>}
          <button type="submit" disabled={busy || mfaCode.trim().length < 6} className={portalButtonClass} style={{ background: PLUM }}>
            {busy && <Loader2 size={16} className="animate-spin" />} Continue
          </button>
        </form>
      ) : (
        <form className="space-y-5" onSubmit={handleSignIn}>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Welcome back</h1>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>
              Sign in to see your schedule, service agreement and invoices.
            </p>
          </div>
          <div>
            <label htmlFor="portal-email" className="text-[13px] font-bold" style={{ color: TEXT }}>Email address</label>
            <input
              id="portal-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={portalInputClass}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="portal-password" className="text-[13px] font-bold" style={{ color: TEXT }}>Password</label>
            <input
              id="portal-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={portalInputClass}
              style={fieldStyle}
            />
          </div>
          {error && <p role="alert" className="text-[13px] font-semibold" style={{ color: DANGER }}>{error}</p>}
          <button type="submit" disabled={busy} className={portalButtonClass} style={{ background: PLUM }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} Sign in
          </button>
          <div className="space-y-2 text-center text-[14px]">
            <button type="button" className="font-bold" style={{ color: PLUM }} onClick={() => navigate("/portal/forgot-password")}>
              Forgot your password?
            </button>
            <p style={{ color: MUTED }}>
              New here? Use the invitation link your care provider emailed you.
            </p>
          </div>
        </form>
      )}
    </PortalAuthLayout>
  );
}
