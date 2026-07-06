import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Loader2, ArrowRight, ShieldCheck, ArrowLeft, Quote } from "lucide-react";
import { PasswordNativeInput } from "@/components/PasswordInput";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { validateLoginIdentifier } from "@/lib/auth-login-validation";
import {
  getRememberDevicePreference,
  resolvePostLoginPath,
  setRememberDevicePreference,
} from "@/lib/auth-session";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const BORDER = "var(--auth-input-border)";
const INPUT_BG = "var(--auth-input-bg)";

// Solid colors sampled from the CareCliQ logo mark — no gradients.
const LOGO_PINK = "#E94B8C";
const LOGO_PURPLE = "#6B3FA0";

// ── 6-box OTP input ───────────────────────────────────────────────────────────
function OtpInput({
  value, onChange, disabled, error,
}: {
  value: string; onChange: (v: string) => void; disabled: boolean; error?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const getDigit = (i: number) => value[i] ?? "";

  function focus(i: number) {
    (containerRef.current?.querySelectorAll("input")[i] as HTMLInputElement | undefined)?.focus();
  }

  function handleChange(i: number, raw: string) {
    const char = raw.replace(/\D/g, "").slice(-1);
    const arr = Array.from({ length: 6 }, (_, k) => getDigit(k));
    arr[i] = char;
    onChange(arr.join(""));
    if (char) focus(Math.min(i + 1, 5));
  }

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !getDigit(i) && i > 0) {
      const arr = Array.from({ length: 6 }, (_, k) => getDigit(k));
      arr[i - 1] = "";
      onChange(arr.join("").trimEnd());
      focus(i - 1);
    }
    if (e.key === "ArrowLeft"  && i > 0) focus(i - 1);
    if (e.key === "ArrowRight" && i < 5) focus(i + 1);
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(text);
    focus(Math.min(text.length, 5));
  }

  return (
    <div ref={containerRef} className="flex gap-2 sm:gap-3" onPaste={handlePaste}>
      {Array.from({ length: 6 }, (_, i) => {
        const filled = !!getDigit(i);
        return (
          <input
            key={i}
            type="text"
            title="Enter verification code"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={getDigit(i)}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKey(i, e)}
            onFocus={(e) => e.target.select()}
            disabled={disabled}
            className="flex-1 aspect-square max-w-[56px] text-center text-[22px] font-black rounded-xl border outline-none transition-all duration-150 focus:bg-cc-surface"
            style={{
              background: INPUT_BG,
              borderColor: error ? CORAL : filled ? PLUM : BORDER,
              boxShadow: filled && !error ? "0 0 0 3px color-mix(in srgb, var(--cc-plum) 10%, transparent)" : "none",
              color: "var(--cc-text)",
            }}
          />
        );
      })}
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────────
function Field({
  label, right, error, valid, children,
}: {
  label: string;
  right?: React.ReactNode;
  error?: string | null;
  valid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-black uppercase tracking-wider" style={{ color: "var(--cc-muted)" }}>
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
            className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[11px] font-black"
            style={{ color: "#22C55E" }}
          >
            ✓
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

const TRUST_AVATARS = [
  { i: "SM", bg: "#3730A3" }, { i: "AK", bg: "#0D7C66" },
  { i: "LP", bg: "#7B3F9E" }, { i: "JW", bg: "#C0392B" }, { i: "RN", bg: "#1A6FA8" },
];

export default function Login() {
  const { login, completeMfaLogin } = useAuth();
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
    try {
      setRememberDevicePreference(rememberDevice);
      const result = await login(identifier.trim(), password, rememberDevice);
      if (result.status === "mfa_required") {
        setMfaChallengeToken(result.challengeToken);
        setMfaCode("");
        setTrustDevice(true);
        return;
      }
      toast({ title: t("auth.login.toast.welcome"), description: t("auth.login.toast.ready") });
      navigate(resolvePostLoginPath(result.user.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("auth.login.error.invalidCredentials");
      toast({ title: t("auth.login.error.signInFailed"), description: msg, variant: "destructive" });
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
      const authUser = await completeMfaLogin(mfaChallengeToken, mfaCode.trim(), trustDevice);
      toast({ title: t("auth.login.toast.welcome"), description: t("auth.login.toast.ready") });
      navigate(resolvePostLoginPath(authUser.id));
    } catch (err) {
      setMfaCodeError(err instanceof Error ? err.message : t("auth.login.error.invalidMfa"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-[100dvh] w-full flex flex-col lg:flex-row font-sans bg-[var(--auth-shell-bg)] text-cc-text">
      <div className="absolute top-4 right-4 z-30 sm:top-5 sm:right-5">
        <AuthThemeToggle />
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes authEnter    { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes fieldShake   { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-5px)} 40%,80%{transform:translateX(5px)} }
        @keyframes panelIn      { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        .login-input:focus { border-color: var(--cc-plum) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--cc-plum) 10%, transparent); }
        @keyframes headlineLineIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        .auth-headline-line { display: block; opacity: 0; animation: headlineLineIn 0.55s ease-out forwards; }
        @keyframes authGlowPulse { 0%,100% { opacity:0.75 } 50% { opacity:1 } }
        .auth-glow { animation: authGlowPulse 9s ease-in-out infinite; }
      ` }} />

      {/* ── Mobile-only brand header ────────────────────────────────────── */}
      <div className="lg:hidden relative overflow-hidden" style={{ background: "var(--auth-marketing-bg)" }}>
        <div
          className="absolute inset-0 pointer-events-none auth-glow"
          style={{ background: "var(--auth-marketing-glow)" }}
        />
        <div className="absolute inset-0 pointer-events-none auth-motif" />
        <div className="relative z-10 px-6 pt-12 pb-9">
          {/* Logo row */}
          <CareCliQLogo size={96} />
          <p className="mt-2 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "var(--auth-marketing-muted)" }}>
            {t("auth.login.marketing.tagline")}
          </p>

          {/* Hero copy */}
          <h2 className="mt-5 text-[28px] font-black leading-[1.12] tracking-tight" style={{ color: "var(--auth-headline)" }}>
            <span className="auth-headline-line" style={{ animationDelay: "0ms" }}>{t("auth.login.marketing.headline1")}</span>
            <span className="auth-headline-line" style={{ animationDelay: "90ms" }}>{t("auth.login.marketing.headline2")}</span>
            <span className="auth-headline-line" style={{ animationDelay: "180ms", color: "var(--auth-accent)" }}>{t("auth.login.marketing.headline3")}</span>
          </h2>

          {/* Stats row */}
          <div className="mt-5 flex items-center gap-4">
            {[["2,400+", t("auth.login.marketing.statShifts")], ["97%", t("auth.login.marketing.statCompliance")], ["200+", t("auth.login.marketing.statProviders")]].map(([n, l], i) => (
              <div key={n} className="flex items-center gap-4">
                {i > 0 && <div className="h-6 w-px" style={{ background: "var(--auth-stat-card-border)" }} />}
                <div>
                  <p className="text-[16px] font-black" style={{ color: "var(--auth-stat-value)" }}>{n}</p>
                  <p className="text-[10px] font-medium" style={{ color: "var(--auth-marketing-muted)" }}>{l}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Testimonial */}
          <div
            className="mt-5 rounded-2xl p-4"
            style={{ background: "var(--auth-card-bg)", border: "1px solid var(--auth-card-border)" }}
          >
            <p className="text-[13px] font-medium leading-relaxed" style={{ color: "var(--auth-headline)" }}>
              “{t("auth.login.marketing.testimonialQuote")}”
            </p>
            <p className="mt-2 text-[11px] font-bold" style={{ color: LOGO_PURPLE }}>
              {t("auth.login.marketing.testimonialName")} · {t("auth.login.marketing.testimonialRole")}
            </p>
          </div>

          {/* Trust strip */}
          <div className="mt-5 flex items-center gap-3">
            <div className="flex -space-x-2">
              {TRUST_AVATARS.slice(0, 4).map((a) => (
                <div
                  key={a.i}
                  className="h-7 w-7 rounded-full border-2 flex items-center justify-center text-[9px] font-black text-white"
                  style={{ background: a.bg, borderColor: "var(--auth-form-bg)" }}
                >
                  {a.i}
                </div>
              ))}
            </div>
            <p className="text-[12px] font-bold" style={{ color: "var(--auth-headline)" }}>
              {t("auth.login.marketing.trustedBy")}
            </p>
          </div>
        </div>
      </div>

      {/* ── Form panel ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-col justify-between flex-1 lg:flex-none lg:w-[720px] lg:shrink-0 rounded-t-[28px] lg:rounded-none -mt-5 lg:mt-0 relative z-10 bg-[var(--auth-form-bg)]"
        style={{ borderRight: "1px solid var(--cc-border)", animation: "panelIn 0.38s ease-out" }}
      >
        {/* Logo — desktop only */}
        <div className="hidden lg:flex items-center px-12 pt-10">
          <CareCliQLogo size={120} />
        </div>

        {/* Mobile drag handle */}
        <div className="lg:hidden flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full" style={{ background: "var(--auth-drag-handle)" }} />
        </div>

        {/* Form body */}
        <div className="flex flex-1 items-center justify-center px-4 sm:px-8 md:px-10 lg:px-12 py-8 lg:py-10">
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

            {/* ── MFA step ── */}
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
                    className="text-[11px] font-black uppercase tracking-wider mb-3 block"
                    style={{ color: "var(--cc-muted)" }}
                  >
                    {t("auth.login.verificationCode")}
                  </label>
                  <OtpInput
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
                  style={{ background: PLUM }}
                >
                  {busy
                    ? <><Loader2 size={16} className="animate-spin" /><span>{t("auth.login.verifying")}</span></>
                    : <><span>{t("auth.login.verify")}</span><ArrowRight size={16} strokeWidth={2.5} /></>
                  }
                </button>
              </form>
            ) : (
              /* ── Sign-in step ── */
              <form onSubmit={handleSignIn} className="space-y-5" noValidate key="signin">
                <Field
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
                    placeholder="••••••••"
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
                  style={{ background: PLUM }}
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
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-8 md:px-10 lg:px-12 pb-6 lg:pb-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <p className="text-[11px] font-medium" style={{ color: "var(--auth-footer)" }}>
            {t("auth.login.footer")}
          </p>
        </div>
      </div>

      {/* ── Product panel (desktop only) ───────────────────────────────── */}
      <div
        className="hidden lg:flex flex-1 flex-col p-12 xl:p-16 overflow-hidden relative"
        style={{ background: "var(--auth-marketing-bg)" }}
      >
        <div
          className="absolute inset-0 pointer-events-none auth-glow"
          style={{ background: "var(--auth-marketing-glow)" }}
        />
        <div className="absolute inset-0 pointer-events-none auth-motif" />

        <div className="relative z-10 flex flex-col justify-between h-full">
        <p className="text-[11px] font-black uppercase tracking-[0.25em]" style={{ color: "var(--auth-marketing-muted)" }}>
          {t("auth.login.marketing.brandLine")}
        </p>

        <div>
          <h2 className="text-[38px] xl:text-[44px] font-black leading-[1.1] tracking-tight" style={{ color: "var(--auth-headline)" }}>
            <span className="auth-headline-line" style={{ animationDelay: "0ms" }}>{t("auth.login.marketing.headline1")}</span>
            <span className="auth-headline-line" style={{ animationDelay: "90ms" }}>{t("auth.login.marketing.headline2")}</span>
            <span className="auth-headline-line" style={{ animationDelay: "180ms", color: "var(--auth-accent)" }}>{t("auth.login.marketing.headline3")}</span>
          </h2>
          <p className="mt-4 text-[14px] font-medium max-w-[340px] leading-relaxed" style={{ color: "var(--auth-marketing-body)" }}>
            {t("auth.login.marketing.description")}
          </p>

          <div className="mt-6 flex items-center gap-5">
            {[["2,400+", t("auth.login.marketing.statShiftsLogged")], ["97%", t("auth.login.marketing.statNdisCompliance")], ["200+", t("auth.login.marketing.statNdisProviders")]].map(([n, l], i) => (
              <div key={n} className="flex items-center gap-5">
                {i > 0 && <div className="h-8 w-px" style={{ background: "var(--auth-stat-card-border)" }} />}
                <div>
                  <p className="text-[20px] font-black" style={{ color: "var(--auth-stat-value)" }}>{n}</p>
                  <p className="text-[11px] font-medium mt-0.5" style={{ color: "var(--auth-marketing-muted)" }}>{l}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 max-w-[400px] space-y-3">
            <div
              className="rounded-2xl p-5"
              style={{ background: "var(--auth-card-bg)", border: "1px solid var(--auth-card-border)" }}
            >
              <Quote size={18} style={{ color: LOGO_PINK }} />
              <p className="mt-3 text-[14px] font-medium leading-relaxed" style={{ color: "var(--auth-headline)" }}>
                {t("auth.login.marketing.testimonialQuote")}
              </p>
              <div className="mt-4 flex items-center gap-3">
                <div
                  className="h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-black text-white shrink-0"
                  style={{ background: LOGO_PURPLE }}
                >
                  {TRUST_AVATARS[0].i}
                </div>
                <div>
                  <p className="text-[13px] font-black" style={{ color: "var(--auth-headline)" }}>
                    {t("auth.login.marketing.testimonialName")}
                  </p>
                  <p className="text-[11px] font-medium" style={{ color: "var(--auth-marketing-muted)" }}>
                    {t("auth.login.marketing.testimonialRole")} · {t("auth.login.marketing.testimonialOrg")}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              {[[t("auth.login.marketing.compliance"),"94%", t("auth.login.marketing.ndisScore")], [t("auth.login.marketing.participants"),"38", t("auth.login.marketing.activePlans")]].map(([label, v, s]) => (
                <div
                  key={String(label)}
                  className="flex-1 rounded-2xl px-4 py-3"
                  style={{ background: "var(--auth-stat-card-bg)", border: "1px solid var(--auth-stat-card-border)" }}
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--auth-marketing-muted)" }}>{label}</p>
                  <p className="text-[24px] font-black mt-0.5" style={{ color: "var(--auth-stat-value)" }}>{v}</p>
                  <p className="text-[11px] font-medium" style={{ color: "var(--auth-marketing-muted)" }}>{s}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex -space-x-2.5">
            {TRUST_AVATARS.map((a) => (
              <div
                key={a.i}
                className="h-9 w-9 rounded-full border-2 flex items-center justify-center text-[11px] font-black text-white"
                style={{ background: a.bg, borderColor: "var(--auth-form-bg)" }}
              >
                {a.i}
              </div>
            ))}
          </div>
          <div>
            <p className="text-[14px] font-black" style={{ color: "var(--auth-headline)" }}>{t("auth.login.marketing.providersCount")}</p>
            <p className="text-[12px] font-medium" style={{ color: "var(--auth-marketing-muted)" }}>
              {t("auth.login.marketing.trustAustralia")}
            </p>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
