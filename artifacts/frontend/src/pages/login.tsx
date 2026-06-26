import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Loader2, ArrowRight, ShieldCheck, ArrowLeft } from "lucide-react";
import { PasswordNativeInput } from "@/components/PasswordInput";
import { validateLoginIdentifier } from "@/lib/auth-login-validation";
import {
  getRememberDevicePreference,
  resolvePostLoginPath,
  setRememberDevicePreference,
} from "@/lib/auth-session";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "#D8D0F0";

export default function Login() {
  const { login, completeMfaLogin } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(() => getRememberDevicePreference());
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [mfaCodeError, setMfaCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);

  const mfaStep = useMemo(() => Boolean(mfaChallengeToken), [mfaChallengeToken]);

  useEffect(() => {
    if (isMobile && !getRememberDevicePreference()) {
      setRememberDevice(true);
    }
  }, [isMobile]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateLoginIdentifier(identifier);
    const nextPasswordError = !password.trim() ? "Enter your password" : null;

    setIdentifierError(validationError);
    setPasswordError(nextPasswordError);

    if (validationError || nextPasswordError) return;

    setBusy(true);
    try {
      setRememberDevicePreference(rememberDevice);
      const result = await login(identifier.trim(), password, rememberDevice);
      if (result.status === "mfa_required") {
        setMfaChallengeToken(result.challengeToken);
        setMfaCode("");
        setTrustDevice(true);
        return;
      }
      toast({
        title: "Welcome back!",
        description: "Your workspace is ready.",
      });
      navigate(resolvePostLoginPath(result.user.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Incorrect email or password";
      toast({
        title: "Sign-in failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaChallengeToken) return;

    const nextMfaError = !mfaCode.trim()
      ? "Enter your verification code"
      : null;
    setMfaCodeError(nextMfaError);
    if (nextMfaError) return;

    setBusy(true);
    try {
      const authUser = await completeMfaLogin(mfaChallengeToken, mfaCode.trim(), trustDevice);
      toast({
        title: "Welcome back!",
        description: "Your workspace is ready.",
      });
      navigate(resolvePostLoginPath(authUser.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid verification code";
      setMfaCodeError(message);
    } finally {
      setBusy(false);
    }
  }

  function resetMfaStep() {
    setMfaChallengeToken(null);
    setMfaCode("");
    setMfaCodeError(null);
  }

  return (
    <div
      className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-12 font-sans selection:bg-cc-plum/20 relative overflow-hidden"
      style={{ animation: "authPageEnter 0.3s ease-out" }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes fluidMesh {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            @keyframes softFloat {
              0%, 100% { transform: translateY(0px) scale(1); }
              50% { transform: translateY(-12px) scale(1.02); }
            }
            @keyframes softFloatDelayed {
              0%, 100% { transform: translateY(0px) scale(1); }
              50% { transform: translateY(12px) scale(0.98); }
            }
            @keyframes softFloatAlt {
              0%, 100% { transform: translateY(0px) translateX(0px); }
              50% { transform: translateY(-8px) translateX(6px); }
            }
            @keyframes softFloatDrift {
              0%, 100% { transform: translateY(0px) translateX(0px) rotate(0deg); }
              50% { transform: translateY(10px) translateX(-8px) rotate(3deg); }
            }
            @keyframes authPageEnter {
              from { opacity: 0; transform: translateY(6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            .animate-fluid-bg {
              background: linear-gradient(-45deg, #F03060, #FF5E7E, #5533CC, #9B5DE5);
              background-size: 400% 400%;
              animation: fluidMesh 12s ease infinite;
            }
            .animate-float-card { animation: softFloat 6s ease-in-out infinite; }
            .animate-shape-1 { animation: softFloat 7s ease-in-out infinite; }
            .animate-shape-2 { animation: softFloatDelayed 9s ease-in-out infinite; }
            .animate-shape-3 { animation: softFloatAlt 8s ease-in-out infinite; }
            .animate-shape-4 { animation: softFloatDrift 10s ease-in-out infinite; }
          `,
        }}
      />

      <div className="absolute inset-0 z-0 animate-fluid-bg" />
      <div
        className="absolute inset-0 z-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-10 md:p-12 bg-cc-surface/95 backdrop-blur-md relative z-10 shadow-[8px_0_32px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-3">
          <img src="/carecliQ_logo.png" alt="CareCliQ" className="h-13 w-auto object-contain transition-transform duration-300 hover:scale-[1.02]" />
          <div className="h-4 w-[1px] bg-gray-200" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cc-muted">Workspace</span>
        </div>

        <div className="w-full max-w-sm mx-auto my-auto py-8 transition-transform duration-500 ease-out">
          <div className="mb-8">
            <h1 className="text-[26px] font-black tracking-tight" style={{ color: PLUM }}>
              {mfaStep ? "Verify your identity" : "Welcome back"}
            </h1>
            <p className="text-[14px] font-medium mt-1" style={{ color: 'var(--cc-muted)' }}>
              {mfaStep
                ? "Enter the 6-digit code from your authenticator app or a recovery code."
                : "Sign in to your clinical note workspace."}
            </p>
          </div>

          {mfaStep ? (
            <form onSubmit={handleMfaSubmit} className="space-y-5" noValidate>
              <button
                type="button"
                onClick={resetMfaStep}
                className="flex items-center gap-1.5 text-[13px] font-bold transition-opacity hover:opacity-80"
                style={{ color: PLUM }}
              >
                <ArrowLeft size={14} />
                Back to sign in
              </button>

              <div className="rounded-2xl border bg-cc-bg p-4 flex items-start gap-3" style={{ borderColor: BORDER }}>
                <ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" style={{ color: PLUM }} />
                <p className="text-[13px] leading-relaxed font-medium" style={{ color: 'var(--cc-muted)' }}>
                  Two-factor authentication is enabled on this account. Open your authenticator app to get your code.
                </p>
              </div>

              <div className="group relative">
                <label
                  htmlFor="login-mfa-code"
                  className="text-[11px] font-bold uppercase tracking-wider mb-1.5 block transition-colors duration-200 group-focus-within:text-cc-coral"
                  style={{ color: PLUM }}
                >
                  Verification code
                </label>
                <input
                  id="login-mfa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(e) => {
                    setMfaCode(e.target.value);
                    if (mfaCodeError) setMfaCodeError(null);
                  }}
                  placeholder="000000 or recovery code"
                  disabled={busy}
                  required
                  aria-invalid={!!mfaCodeError}
                  aria-describedby={mfaCodeError ? "login-mfa-code-error" : undefined}
                  className="w-full h-12 px-4 rounded-2xl text-[14px] font-medium tracking-widest outline-none transition-all duration-200 border border-solid focus:shadow-[0_0_0_4px_rgba(240,48,96,0.12)] bg-cc-bg"
                  style={{ borderColor: mfaCodeError ? CORAL : BORDER, color: 'var(--cc-text)' }}
                />
                {mfaCodeError ? (
                  <p id="login-mfa-code-error" className="mt-1.5 text-[12px] font-medium" style={{ color: CORAL }}>
                    {mfaCodeError}
                  </p>
                ) : null}
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => setTrustDevice(e.target.checked)}
                  disabled={busy}
                  className="h-4 w-4 rounded border-cc-border text-cc-plum focus:ring-[#5533CC]"
                />
                <span className="text-[13px] font-medium" style={{ color: 'var(--cc-muted)' }}>
                  Trust this device for 30 days
                </span>
              </label>

              <button
                type="submit"
                disabled={busy}
                className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 mt-2 transition-all duration-300 hover:opacity-95 shadow-[0_8px_24px_-6px_rgba(240,48,96,0.3)] hover:shadow-[0_12px_28px_-4px_rgba(240,48,96,0.4)] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Verifying…</span>
                  </>
                ) : (
                  <>
                    <span>Continue</span>
                    <ArrowRight size={16} strokeWidth={2.5} />
                  </>
                )}
              </button>
            </form>
          ) : (
          <form onSubmit={handleSignIn} className="space-y-5" noValidate>
            <div className="group relative">
              <label
                htmlFor="login-identifier"
                className="text-[11px] font-bold uppercase tracking-wider mb-1.5 block transition-colors duration-200 group-focus-within:text-cc-coral"
                style={{ color: PLUM }}
              >
                Email or mobile number
              </label>
              <input
                id="login-identifier"
                type="text"
                inputMode="email"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (identifierError) setIdentifierError(null);
                }}
                placeholder="you@example.com or 0412 345 678"
                disabled={busy}
                autoComplete="username"
                required
                aria-invalid={!!identifierError}
                aria-describedby={identifierError ? "login-identifier-error" : undefined}
                className="w-full h-12 px-4 rounded-2xl text-[14px] font-medium outline-none transition-all duration-200 border border-solid focus:shadow-[0_0_0_4px_rgba(240,48,96,0.12)] bg-cc-bg"
                style={{
                  borderColor: identifierError ? CORAL : BORDER,
                  color: 'var(--cc-text)',
                }}
              />
              {identifierError ? (
                <p id="login-identifier-error" className="mt-1.5 text-[12px] font-medium" style={{ color: CORAL }}>
                  {identifierError}
                </p>
              ) : null}
            </div>

            <div className="group relative">
              <div className="flex justify-between items-center mb-1.5">
                <label
                  htmlFor="login-password"
                  className="text-[11px] font-bold uppercase tracking-wider transition-colors duration-200 group-focus-within:text-cc-coral"
                  style={{ color: PLUM }}
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="text-[12px] font-bold transition-opacity hover:opacity-80"
                  style={{ color: CORAL }}
                >
                  Forgot?
                </button>
              </div>
              <PasswordNativeInput
                id="login-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                placeholder="••••••••"
                disabled={busy}
                autoComplete="current-password"
                required
                aria-invalid={!!passwordError}
                aria-describedby={passwordError ? "login-password-error" : undefined}
                className="w-full h-12 px-4 rounded-2xl text-[14px] font-medium outline-none transition-all duration-200 border border-solid focus:shadow-[0_0_0_4px_rgba(240,48,96,0.12)] bg-cc-bg"
                style={{ borderColor: passwordError ? CORAL : BORDER, color: 'var(--cc-text)' }}
              />
              {passwordError ? (
                <p id="login-password-error" className="mt-1.5 text-[12px] font-medium" style={{ color: CORAL }}>
                  {passwordError}
                </p>
              ) : null}
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 rounded border-cc-border text-cc-plum focus:ring-[#5533CC]"
              />
              <span className="text-[13px] font-medium" style={{ color: 'var(--cc-muted)' }}>
                Remember this device
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 mt-2 transition-all duration-300 hover:opacity-95 shadow-[0_8px_24px_-6px_rgba(240,48,96,0.3)] hover:shadow-[0_12px_28px_-4px_rgba(240,48,96,0.4)] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Securing Session…</span>
                </>
              ) : (
                <>
                  <span>Sign In to Environment</span>
                  <ArrowRight size={16} strokeWidth={2.5} />
                </>
              )}
            </button>
          </form>
          )}

          {!mfaStep ? (
          <p className="text-center text-[13px] font-medium mt-6" style={{ color: 'var(--cc-muted)' }}>
            Don't have an account?{" "}
            <button
              onClick={() => navigate("/signup")}
              className="font-black transition-all duration-200 hover:opacity-75 focus:outline-none focus-visible:underline rounded"
              style={{ color: CORAL }}
            >
              Create an account
            </button>
          </p>
          ) : null}
        </div>

        <p className="text-[11px] font-medium text-center lg:text-left text-gray-400">
          Secure end-to-end encrypted instance. Aligned with NDIS & AHPRA compliance guidelines.
        </p>
      </div>

      <div className="hidden lg:col-span-7 lg:flex flex-col items-center justify-center p-12 relative overflow-hidden z-10">
        <div className="absolute inset-0 z-0 pointer-events-none select-none opacity-85">
          <img src="/shape1_login.png" alt="" className="absolute top-[-8%] left-[-5%] w-[65%] h-auto max-w-[400px] object-contain animate-shape-1" />
          <img src="/shape3_login.png" alt="" className="absolute top-[-10%] right-[-5%] w-[90%] h-auto max-w-[420px] object-contain mix-blend-screen animate-shape-3" />
          <img src="/shape4_login.png" alt="" className="absolute bottom-[-1%] left-[-1%] w-[55%] h-auto max-w-[300px] object-contain mix-blend-lighten opacity-90 animate-shape-4" />
          <img src="/shape2_login.png" alt="" className="absolute bottom-[-6%] right-[-5%] w-[75%] h-auto max-w-[400px] object-contain animate-shape-2" />
        </div>
        <div className="w-full max-w-xl flex flex-col items-center relative z-10 animate-float-card">
          <div className="w-full aspect-[4/3] bg-cc-surface/40 backdrop-blur-md rounded-[2.5rem] p-4 border border-solid border-white/20 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.15)] relative overflow-hidden flex items-center justify-center group">
            <img
              src="/login_welcome.jpg"
              alt="CareCliQ Connections Workspace Overview"
              className="w-full h-full object-cover rounded-[1.75rem] transition-transform duration-700 ease-out group-hover:scale-[1.01]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
