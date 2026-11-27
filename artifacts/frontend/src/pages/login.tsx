import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Loader2, ArrowRight, ShieldCheck, ArrowLeft, Check } from "lucide-react";
import { PasswordNativeInput } from "@/components/PasswordInput";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { OtpInput } from "@/components/auth/OtpInput";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { validateLoginIdentifier } from "@/lib/auth-login-validation";
import {
  getRememberDevicePreference,
  resolvePostLoginPath,
  defaultHomePathForRole,
  setRememberDevicePreference,
} from "@/lib/auth-session";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const BORDER = "var(--auth-input-border)";
const INPUT_BG = "var(--auth-input-bg)";

const LOGIN_NETWORK_MAX_ATTEMPTS = 3;

function isNetworkLoginError(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err && (err as { status?: number }).status === 0) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /network request failed|failed to fetch|networkerror|network error|timed out|econnrefused|enotfound/i.test(msg);
}

async function withNetworkRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= LOGIN_NETWORK_MAX_ATTEMPTS; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (!isNetworkLoginError(err) || i >= LOGIN_NETWORK_MAX_ATTEMPTS) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * i));
    }
  }
  throw lastErr;
}

// -- Field wrapper -------------------------------------------------------------
function Field({
  label, right, error, valid, children, inputId,
}: {
  label: string;
  inputId?: string;
  right?: React.ReactNode;
  error?: string | null;
  valid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label
          htmlFor={inputId}
          className="text-[11px] font-black uppercase tracking-wider"
          style={{ color: "var(--cc-muted)" }}
        >
          {label}
        </label>
        {right}
      </div>
      <div
        className="relative transition-all duration-200"
        style={{ borderRadius: 12 }}
      >
        {children}
        {valid && !error && (
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex"
            style={{ color: "#22C55E" }}
          >
            <Check size={14} strokeWidth={3} aria-hidden="true" />
          </span>
        )}
      </div>
      {error && (
        <p
          className="mt-1.5 text-[12px] font-medium"
          style={{ color: CORAL, animation: "fieldShake 0.32s ease" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

export default function Login() {
  const { login, completeMfaLogin, completeMfaLoginNative } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate: t } = useAccessibility();
  const isMobile = useIsMobile();

  const [identifier, setIdentifier]           = useState("");
  const [password, setPassword]               = useState("");
  const [rememberDevice, setRememberDevice]   = useState(() => getRememberDevicePreference());
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [passwordError, setPasswordError]     = useState<string | null>(null);
  const [mfaCodeError, setMfaCodeError]       = useState<string | null>(null);
  const [busy, setBusy]                       = useState(false);
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode]                 = useState("");
  const [trustDevice, setTrustDevice]         = useState(true);
  // NEW Supabase-native MFA: when set, the code-entry step below submits to
  // completeMfaLoginNative (factor_id + code) instead of the OLD flow's
  // completeMfaLogin.
  const [mfaNative, setMfaNative]             = useState(false);
  const [mfaFactorId, setMfaFactorId]         = useState<string | null>(null);

  const mfaStep        = useMemo(() => Boolean(mfaChallengeToken), [mfaChallengeToken]);
  const identifierOk   = !validateLoginIdentifier(identifier) && identifier.trim().length > 0;
  const mfaComplete    = mfaCode.length === 6;

  useEffect(() => {
    if (isMobile && !getRememberDevicePreference()) setRememberDevice(true);
  }, [isMobile]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const valErr = validateLoginIdentifier(identifier);
    const pwdErr = !password.trim() ? t("auth.login.error.passwordRequired") : null;
    setIdentifierError(valErr);
    setPasswordError(pwdErr);
    if (valErr || pwdErr) return;

    setBusy(true);
    setPasswordError(null);
    try {
      setRememberDevicePreference(rememberDevice);
      const result = await withNetworkRetry(() =>
        login(identifier.trim(), password, rememberDevice, "staff"),
      );
      if (result.status === "mfa_required") {
        setMfaChallengeToken(result.challengeToken);
        setMfaCode("");
        setTrustDevice(true);
        setMfaNative(Boolean(result.native));
        setMfaFactorId(result.factorId || null);
        return;
      }
      toast({ title: t("auth.login.toast.welcome"), description: t("auth.login.toast.ready") });
      navigate(resolvePostLoginPath(result.user.id, defaultHomePathForRole(result.user.role)));
    } catch (err) {
      if (isNetworkLoginError(err)) {
        toast({
          title: t("auth.login.error.signInFailed"),
          description: t("auth.login.error.networkContactAdmin"),
          variant: "destructive",
        });
      } else {
        const msg = err instanceof Error ? err.message : t("auth.login.error.invalidCredentials");
        toast({ title: t("auth.login.error.signInFailed"), description: msg, variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaChallengeToken) return;
    if (!mfaCode.trim()) { setMfaCodeError(t("auth.login.error.mfaRequired")); return; }
    setBusy(true);
    try {
      const authUser = mfaNative && mfaFactorId
        ? await completeMfaLoginNative(mfaChallengeToken, mfaFactorId, mfaCode.trim(), trustDevice)
        : await completeMfaLogin(mfaChallengeToken, mfaCode.trim(), trustDevice);
      toast({ title: t("auth.login.toast.welcome"), description: t("auth.login.toast.ready") });
      navigate(resolvePostLoginPath(authUser.id, defaultHomePathForRole(authUser.role)));
    } catch (err) {
      setMfaCodeError(err instanceof Error ? err.message : t("auth.login.error.invalidMfa"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-[100dvh] w-full flex flex-col lg:h-[100dvh] lg:min-h-0 lg:flex-row lg:items-stretch lg:gap-6 lg:overflow-hidden lg:p-6 font-sans bg-[var(--auth-shell-bg)] lg:bg-[#7C3AED] text-cc-text">
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes authEnter    { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes fieldShake   { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-5px)} 40%,80%{transform:translateX(5px)} }
        @keyframes panelIn      { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        .login-input:focus { border-color: var(--cc-plum) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--cc-plum) 10%, transparent); }
        @keyframes headlineLineIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        .auth-headline-line { display: block; opacity: 0; animation: headlineLineIn 0.55s ease-out forwards; }
        @keyframes authGlowPulse { 0%,100% { opacity:0.75 } 50% { opacity:1 } }
        .auth-glow { animation: authGlowPulse 9s ease-in-out infinite; }
        @keyframes authHeroZoom { from { transform: scale(1) } to { transform: scale(1.045) } }
        .auth-hero-photo { animation: authHeroZoom 22s ease-in-out infinite alternate; }
        .auth-scroll-hide { scrollbar-width: none; -ms-overflow-style: none; }
        .auth-scroll-hide::-webkit-scrollbar { display: none; }

        /* Screen sizes:
           - phones (and any short screen, e.g. a phone held sideways): no
             photo; a small logo row, then the form straight away.
           - tablets (768-1023px wide, at least 640px tall): a short photo
             banner with the headline, the form panel tucked under it.
           - desktop (1024px+): form on the left, photo panel on the right. */
        .auth-banner { display: none; }
        .auth-compact-logo { display: flex; }
        @media (min-width: 768px) and (min-height: 640px) {
          .auth-banner { display: block; }
          .auth-compact-logo { display: none; }
          .auth-panel-overlap {
            margin-top: -20px;
            border-top-left-radius: 28px;
            border-top-right-radius: 28px;
            border: 1px solid var(--auth-card-border);
            box-shadow: var(--cc-shadow-lg);
          }
        }
        @media (min-width: 1024px) {
          .auth-banner { display: none; }
          .auth-compact-logo { display: none; }
          .auth-panel-overlap { margin-top: 0; }
        }
      ` }} />

      {/* -- Tablet banner (photo + headline) ------------------------------ */}
      <div className="auth-banner relative overflow-hidden">
        <img
          src="/auth-hero-login.jpg"
          alt=""
          aria-hidden="true"
          className="auth-hero-photo absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0" style={{ background: "rgba(26, 26, 46, 0.55)" }} />
        <div className="relative z-10 px-10 pt-10 pb-12">
          <CareCliQLogo size={80} />
          <h2 className="mt-4 text-[28px] font-black leading-[1.12] tracking-tight" style={{ color: "#FFFFFF" }}>
            <span className="auth-headline-line" style={{ animationDelay: "0ms" }}>{t("auth.login.marketing.headline1")}</span>
            <span className="auth-headline-line" style={{ animationDelay: "90ms", color: "#C4B5FD" }}>{t("auth.login.marketing.headline2")}</span>
          </h2>
        </div>
      </div>

      {/* -- Form panel (left, desktop) ------------------------------------ */}
      <div
        className="auth-panel-overlap flex flex-col justify-between flex-1 lg:flex-none lg:w-[600px] lg:min-h-0 lg:shrink-0 lg:rounded-[28px] lg:border lg:[border-color:var(--auth-card-border)] lg:shadow-[var(--cc-shadow-lg)] relative z-10 overflow-hidden bg-[var(--auth-form-bg)]"
        style={{ animation: "panelIn 0.38s ease-out" }}
      >
        <div className="absolute top-4 right-4 z-30 sm:top-5 sm:right-5">
          <AuthThemeToggle />
        </div>

        {/* Logo — phones and short screens (no banner above) */}
        <div className="auth-compact-logo items-center px-4 sm:px-8 pt-4">
          <CareCliQLogo size={72} />
        </div>

        {/* Logo — desktop only */}
        <div className="hidden lg:flex items-center px-12 pt-10 [@media(max-height:720px)]:pt-6">
          <CareCliQLogo size={120} />
        </div>

        {/* Form body */}
        <div className="auth-scroll-hide flex flex-1 items-start md:items-center justify-center overflow-y-auto px-4 sm:px-8 md:px-10 lg:px-12 pt-4 pb-6 md:py-8 lg:py-10 [@media(max-height:720px)]:lg:py-6">
          <div className="w-full max-w-[480px]">

            <div className="mb-7">
              <h1
                className="text-[22px] sm:text-[26px] font-black tracking-tight"
                style={{ color: "var(--cc-text)" }}
              >
                {mfaStep ? t("auth.login.mfaTitle") : t("auth.login.title")}
              </h1>
              <p className="mt-1.5 text-[14px] font-medium" style={{ color: "var(--cc-muted)" }}>
                {mfaStep
                  ? t("auth.login.mfaSubtitle")
                  : t("auth.login.subtitle")}
              </p>
            </div>

            {/* -- MFA step -- */}
            {mfaStep ? (
              <form onSubmit={handleMfaSubmit} className="space-y-5" noValidate key="mfa">
                <button
                  type="button"
                  onClick={() => { setMfaChallengeToken(null); setMfaCode(""); setMfaCodeError(null); }}
                  className="flex items-center gap-1.5 text-[13px] font-bold transition-opacity hover:opacity-75 active:opacity-50"
                  style={{ color: PLUM }}
                >
                  <ArrowLeft size={14} /> {t("auth.login.backToSignIn")}
                </button>

                <div
                  className="rounded-xl border p-4 flex items-start gap-3"
                  style={{ borderColor: BORDER, background: INPUT_BG }}
                >
                  <ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" style={{ color: PLUM }} />
                  <p className="text-[13px] leading-relaxed font-medium" style={{ color: "var(--cc-muted)" }}>
                    {t("auth.login.mfaInfo")}
                  </p>
                </div>

                <div>
                  <label
                    id="mfa-code-label"
                    className="text-[11px] font-black uppercase tracking-wider mb-3 block"
                    style={{ color: "var(--cc-muted)" }}
                  >
                    {t("auth.login.verificationCode")}
                  </label>
                  <OtpInput
                    ariaLabelledBy="mfa-code-label"
                    value={mfaCode}
                    onChange={(v) => { setMfaCode(v); if (mfaCodeError) setMfaCodeError(null); }}
                    disabled={busy}
                    error={!!mfaCodeError}
                  />
                  {mfaCodeError && (
                    <p
                      className="mt-2 text-[12px] font-medium"
                      style={{ color: CORAL, animation: "fieldShake 0.32s ease" }}
                    >
                      {mfaCodeError}
                    </p>
                  )}
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={trustDevice}
                    onChange={(e) => setTrustDevice(e.target.checked)}
                    disabled={busy}
                    className="h-4 w-4 rounded accent-cc-plum"
                    style={{ borderColor: BORDER }}
                  />
                  <span className="text-[13px] font-medium" style={{ color: "var(--cc-muted)" }}>
                    {t("auth.login.trustDevice")}
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={busy || !mfaComplete}
                  className="w-full h-12 rounded-xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                  style={{ background: "var(--cc-cta)" }}
                >
                  {busy
                    ? <><Loader2 size={16} className="animate-spin" /><span>{t("auth.login.verifying")}</span></>
                    : <><span>{t("auth.login.verify")}</span><ArrowRight size={16} strokeWidth={2.5} /></>
                  }
                </button>
              </form>
            ) : (
              /* -- Sign-in step -- */
              <form onSubmit={handleSignIn} className="space-y-5" noValidate key="signin">
                <Field
                  inputId="login-identifier"
                  label={t("auth.login.identifier")}
                  error={identifierError}
                  valid={identifierOk && !identifierError}
                >
                  <input
                    id="login-identifier"
                    type="text"
                    title={t("auth.login.identifierTitle")}
                    inputMode="email"
                    value={identifier}
                    onChange={(e) => { setIdentifier(e.target.value); if (identifierError) setIdentifierError(null); }}
                    placeholder={t("auth.login.identifierPlaceholder")}
                    disabled={busy}
                    autoComplete="username"
                    required
                    className="login-input w-full h-12 px-4 rounded-xl text-[14px] font-medium outline-none transition-all border"
                    style={{
                      background: INPUT_BG,
                      borderColor: identifierError ? CORAL : identifierOk ? "#22C55E" : BORDER,
                      color: "var(--cc-text)",
                      paddingRight: identifierOk && !identifierError ? 36 : undefined,
                    }}
                  />
                </Field>

                <Field
                  inputId="login-password"
                  label={t("auth.login.password")}
                  error={passwordError}
                  right={
                    <button
                      type="button"
                      onClick={() => navigate("/forgot-password")}
                      className="text-[12px] font-bold transition-opacity hover:opacity-75"
                      style={{ color: PLUM }}
                    >
                      {t("auth.login.forgotPassword")}
                    </button>
                  }
                >
                  <PasswordNativeInput
                    id="login-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (passwordError) setPasswordError(null); }}
                    placeholder="••••••••••••••"
                    disabled={busy}
                    autoComplete="current-password"
                    required
                    aria-invalid={!!passwordError}
                    className="login-input w-full h-12 px-4 rounded-xl text-[14px] font-medium outline-none transition-all border"
                    style={{
                      background: INPUT_BG,
                      borderColor: passwordError ? CORAL : BORDER,
                      color: "var(--cc-text)",
                    }}
                  />
                </Field>

                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    disabled={busy}
                    className="h-4 w-4 rounded accent-cc-plum"
                    style={{ borderColor: BORDER }}
                  />
                  <span className="text-[13px] font-medium" style={{ color: "var(--cc-muted)" }}>
                    {t("auth.login.rememberDevice")}
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 rounded-xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                  style={{ background: "var(--cc-cta)" }}
                >
                  {busy
                    ? <><Loader2 size={16} className="animate-spin" /><span>{t("auth.login.signingIn")}</span></>
                    : <><span>{t("auth.login.submit")}</span><ArrowRight size={16} strokeWidth={2.5} /></>
                  }
                </button>
              </form>
            )}

            {!mfaStep && (
              <p className="text-center text-[13px] font-medium mt-6" style={{ color: "var(--cc-muted)" }}>
                {t("auth.login.noAccount")}{" "}
                <button
                  onClick={() => navigate("/signup")}
                  className="font-black transition-opacity hover:opacity-75"
                  style={{ color: CORAL }}
                >
                  {t("auth.login.createAccount")}
                </button>
              </p>
            )}

            {!mfaStep && (
              <p className="text-center text-[13px] font-medium mt-3" style={{ color: "var(--cc-muted)" }}>
                {t("auth.login.providerPrompt")}{" "}
                <button
                  onClick={() => navigate("/get-started")}
                  className="font-black transition-opacity hover:opacity-75"
                  style={{ color: CORAL }}
                >
                  {t("auth.login.providerLink")}
                </button>
              </p>
            )}

            {!mfaStep && (
              <p className="text-center text-[13px] font-medium mt-3" style={{ color: "var(--cc-muted)" }}>
                {t("auth.login.participantPrompt")}{" "}
                <button
                  onClick={() => navigate("/portal/login")}
                  className="font-black transition-opacity hover:opacity-75"
                  style={{ color: CORAL }}
                >
                  {t("auth.login.participantLink")}
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-8 md:px-10 lg:px-12 pb-6 lg:pb-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <p className="text-[11px] font-medium" style={{ color: "var(--auth-footer)" }}>
            {t("auth.login.footer")}
          </p>
        </div>
      </div>

      {/* -- Product panel (photo, right, desktop only) --------------------- */}
      <div className="hidden lg:flex flex-1 lg:min-h-0 flex-col p-12 xl:p-16 overflow-hidden relative lg:rounded-[28px]">
        {/* Hero photo fills the panel. Text sits on a flat (non-gradient) dark
            scrim, so colours here are hardcoded light values instead of the
            theme-conditional --auth-* vars — the backdrop is always a dark
            photo now, regardless of light/dark mode. */}
        <img
          src="/auth-hero-login.jpg"
          alt=""
          aria-hidden="true"
          className="auth-hero-photo absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0" style={{ background: "rgba(26, 26, 46, 0.55)" }} />

        <div className="relative z-10 flex max-w-[460px] flex-col justify-between h-full">
          <p className="text-[11px] font-black uppercase tracking-[0.25em]" style={{ color: "rgba(255, 255, 255, 0.75)" }}>
            {t("auth.login.marketing.brandLine")}
          </p>

          <div>
            <h2 className="text-[38px] xl:text-[44px] [@media(max-height:720px)]:text-[32px] font-black leading-[1.1] tracking-tight" style={{ color: "#FFFFFF" }}>
              <span className="auth-headline-line" style={{ animationDelay: "0ms" }}>{t("auth.login.marketing.headline1")}</span>
              <span className="auth-headline-line" style={{ animationDelay: "90ms", color: "#C4B5FD" }}>{t("auth.login.marketing.headline2")}</span>
            </h2>
            <p className="mt-4 text-[14px] font-medium max-w-[400px] leading-relaxed" style={{ color: "rgba(255, 255, 255, 0.85)" }}>
              {t("auth.login.marketing.description")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
