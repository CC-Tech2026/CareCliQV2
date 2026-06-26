import { useEffect, useMemo, useRef, useState } from "react";
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

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const BORDER = "#C7D2FE";

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
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={getDigit(i)}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKey(i, e)}
            onFocus={(e) => e.target.select()}
            disabled={disabled}
            className="flex-1 aspect-square max-w-[56px] text-center text-[22px] font-black rounded-xl border outline-none transition-all duration-150 bg-[#F8F8FE] focus:bg-white"
            style={{
              borderColor: error ? CORAL : filled ? PLUM : BORDER,
              boxShadow: filled && !error ? "0 0 0 3px rgba(55,48,163,0.10)" : "none",
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

const SHIFT_WORKERS = [
  { i: "SM", name: "Sarah M.",  role: "Community Access",  time: "7:00 – 3:00 PM",   color: "#3730A3" },
  { i: "JK", name: "James K.",  role: "Personal Care",     time: "9:00 – 5:00 PM",   color: "#0D7C66" },
  { i: "RP", name: "Rachel P.", role: "Skill Building",    time: "10:30 – 2:30 PM",  color: "#C0392B" },
];

export default function Login() {
  const { login, completeMfaLogin } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
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
    const pwdErr = !password.trim() ? "Enter your password" : null;
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
      toast({ title: "Welcome back!", description: "Your workspace is ready." });
      navigate(resolvePostLoginPath(result.user.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Incorrect email or password";
      toast({ title: "Sign-in failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaChallengeToken) return;
    if (!mfaCode.trim()) { setMfaCodeError("Enter your verification code"); return; }
    setBusy(true);
    try {
      const authUser = await completeMfaLogin(mfaChallengeToken, mfaCode.trim(), trustDevice);
      toast({ title: "Welcome back!", description: "Your workspace is ready." });
      navigate(resolvePostLoginPath(authUser.id));
    } catch (err) {
      setMfaCodeError(err instanceof Error ? err.message : "Invalid verification code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] w-full flex flex-col lg:flex-row font-sans bg-white">
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes authEnter    { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes fieldShake   { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-5px)} 40%,80%{transform:translateX(5px)} }
        @keyframes panelIn      { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        .login-input:focus { border-color: ${PLUM} !important; box-shadow: 0 0 0 3px rgba(55,48,163,0.10); }
      ` }} />

      {/* ── Mobile-only brand header ────────────────────────────────────── */}
      <div className="lg:hidden relative overflow-hidden" style={{ background: "linear-gradient(135deg, #F5F3FF 0%, #FFF9F0 100%)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 5% 110%, rgba(55,48,163,0.08) 0%, transparent 55%), " +
              "radial-gradient(ellipse at 95% -5%, rgba(190,24,93,0.06) 0%, transparent 45%)",
          }}
        />
        <div className="relative z-10 px-6 pt-12 pb-9">
          {/* Logo row */}
          <img src="/carecliQ_logo.png" alt="CareCliQ" className="h-8 w-auto" />
          <p className="mt-2 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "#6B5B95" }}>
            NDIS Care Software
          </p>

          {/* Hero copy */}
          <h2 className="mt-5 text-[28px] font-black leading-[1.12] tracking-tight" style={{ color: "#2D1B4E" }}>
            Every shift.<br />
            Every note.<br />
            <span style={{ color: "#3730A3" }}>Every claim.</span>
          </h2>

          {/* Stats row */}
          <div className="mt-5 flex items-center gap-4">
            {[["2,400+","shifts"],["97%","compliance"],["200+","providers"]].map(([n, l], i) => (
              <div key={n} className="flex items-center gap-4">
                {i > 0 && <div className="h-6 w-px" style={{ background: "rgba(55,48,163,0.12)" }} />}
                <div>
                  <p className="text-[16px] font-black" style={{ color: "#2D1B4E" }}>{n}</p>
                  <p className="text-[10px] font-medium" style={{ color: "#6B5B95" }}>{l}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Trust strip */}
          <div className="mt-5 flex items-center gap-3">
            <div className="flex -space-x-2">
              {TRUST_AVATARS.slice(0, 4).map((a) => (
                <div
                  key={a.i}
                  className="h-7 w-7 rounded-full border-2 flex items-center justify-center text-[9px] font-black text-white"
                  style={{ background: a.bg, borderColor: "#F5F3FF" }}
                >
                  {a.i}
                </div>
              ))}
            </div>
            <p className="text-[12px] font-bold" style={{ color: "#2D1B4E" }}>
              Trusted by 200+ NDIS providers
            </p>
          </div>
        </div>
      </div>

      {/* ── Form panel ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-col justify-between bg-white flex-1 lg:flex-none lg:w-[720px] lg:shrink-0 rounded-t-[28px] lg:rounded-none -mt-5 lg:mt-0 relative z-10"
        style={{ borderRight: "1px solid #E5E7EB", animation: "panelIn 0.38s ease-out" }}
      >
        {/* Logo — desktop only */}
        <div className="hidden lg:flex items-center px-12 pt-10">
          <img src="/carecliQ_logo.png" alt="CareCliQ" className="h-10 w-auto object-contain" />
        </div>

        {/* Mobile drag handle */}
        <div className="lg:hidden flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-gray-200" />
        </div>

        {/* Form body */}
        <div className="flex flex-1 items-center justify-center px-4 sm:px-8 md:px-10 lg:px-12 py-8 lg:py-10">
          <div className="w-full max-w-[480px]">

            <div className="mb-7">
              <h1
                className="text-[22px] sm:text-[26px] font-black tracking-tight"
                style={{ color: "var(--cc-text)" }}
              >
                {mfaStep ? "Verify your identity" : "Welcome back"}
              </h1>
              <p className="mt-1.5 text-[14px] font-medium" style={{ color: "var(--cc-muted)" }}>
                {mfaStep
                  ? "Enter the code from your authenticator app."
                  : "Sign in to your CareCliQ workspace."}
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
                  <ArrowLeft size={14} /> Back to sign in
                </button>

                <div
                  className="rounded-xl border bg-[#F8F8FE] p-4 flex items-start gap-3"
                  style={{ borderColor: BORDER }}
                >
                  <ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" style={{ color: PLUM }} />
                  <p className="text-[13px] leading-relaxed font-medium" style={{ color: "var(--cc-muted)" }}>
                    Two-factor authentication is active. Open your authenticator app to get your 6-digit code.
                  </p>
                </div>

                <div>
                  <label
                    className="text-[11px] font-black uppercase tracking-wider mb-3 block"
                    style={{ color: "var(--cc-muted)" }}
                  >
                    Verification code
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
                    className="h-4 w-4 rounded border-[#C7D2FE] accent-[#3730A3]"
                  />
                  <span className="text-[13px] font-medium" style={{ color: "var(--cc-muted)" }}>
                    Trust this device for 30 days
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={busy || !mfaComplete}
                  className="w-full h-12 rounded-xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                  style={{ background: PLUM }}
                >
                  {busy
                    ? <><Loader2 size={16} className="animate-spin" /><span>Verifying…</span></>
                    : <><span>Verify</span><ArrowRight size={16} strokeWidth={2.5} /></>
                  }
                </button>
              </form>
            ) : (
              /* ── Sign-in step ── */
              <form onSubmit={handleSignIn} className="space-y-5" noValidate key="signin">
                <Field
                  label="Email or mobile number"
                  error={identifierError}
                  valid={identifierOk && !identifierError}
                >
                  <input
                    id="login-identifier"
                    type="text"
                    inputMode="email"
                    value={identifier}
                    onChange={(e) => { setIdentifier(e.target.value); if (identifierError) setIdentifierError(null); }}
                    placeholder="you@example.com or 0412 345 678"
                    disabled={busy}
                    autoComplete="username"
                    required
                    aria-invalid={!!identifierError}
                    className="login-input w-full h-12 px-4 rounded-xl text-[14px] font-medium outline-none transition-all border bg-[#F8F8FE]"
                    style={{
                      borderColor: identifierError ? CORAL : identifierOk ? "#22C55E" : BORDER,
                      color: "var(--cc-text)",
                      paddingRight: identifierOk && !identifierError ? 36 : undefined,
                    }}
                  />
                </Field>

                <Field
                  label="Password"
                  error={passwordError}
                  right={
                    <button
                      type="button"
                      onClick={() => navigate("/forgot-password")}
                      className="text-[12px] font-bold transition-opacity hover:opacity-75"
                      style={{ color: PLUM }}
                    >
                      Forgot password?
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
                    className="login-input w-full h-12 px-4 rounded-xl text-[14px] font-medium outline-none transition-all border bg-[#F8F8FE]"
                    style={{
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
                    className="h-4 w-4 rounded border-[#C7D2FE] accent-[#3730A3]"
                  />
                  <span className="text-[13px] font-medium" style={{ color: "var(--cc-muted)" }}>
                    Remember this device
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 rounded-xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                  style={{ background: PLUM }}
                >
                  {busy
                    ? <><Loader2 size={16} className="animate-spin" /><span>Signing in…</span></>
                    : <><span>Sign In</span><ArrowRight size={16} strokeWidth={2.5} /></>
                  }
                </button>
              </form>
            )}

            {!mfaStep && (
              <p className="text-center text-[13px] font-medium mt-6" style={{ color: "var(--cc-muted)" }}>
                Don't have an account?{" "}
                <button
                  onClick={() => navigate("/signup")}
                  className="font-black transition-opacity hover:opacity-75"
                  style={{ color: CORAL }}
                >
                  Create account
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-8 md:px-10 lg:px-12 pb-6 lg:pb-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <p className="text-[11px] font-medium" style={{ color: "#94A3B8" }}>
            NDIS Practice Standards · AHPRA aligned · Australian built
          </p>
        </div>
      </div>

      {/* ── Product panel (desktop only) ───────────────────────────────── */}
      <div
        className="hidden lg:flex flex-1 flex-col justify-between p-12 xl:p-16 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #F5F3FF 0%, #FFF9F0 100%)" }}
      >
        <p className="text-[11px] font-black uppercase tracking-[0.25em]" style={{ color: "#6B5B95" }}>
          CareCliQ · NDIS Care Software
        </p>

        <div>
          <h2 className="text-[38px] xl:text-[44px] font-black leading-[1.1] tracking-tight" style={{ color: "#2D1B4E" }}>
            Every shift.<br />
            Every note.<br />
            <span style={{ color: "#3730A3" }}>Every claim.</span>
          </h2>
          <p className="mt-4 text-[14px] font-medium max-w-[340px] leading-relaxed" style={{ color: "#5A4A78" }}>
            Built for Australian NDIS providers — support coordinators, service managers, and disability support businesses.
          </p>

          <div className="mt-6 flex items-center gap-5">
            {[["2,400+","shifts logged"],["97%","NDIS compliance"],["200+","NDIS providers"]].map(([n, l], i) => (
              <div key={n} className="flex items-center gap-5">
                {i > 0 && <div className="h-8 w-px" style={{ background: "rgba(55,48,163,0.12)" }} />}
                <div>
                  <p className="text-[20px] font-black" style={{ color: "#2D1B4E" }}>{n}</p>
                  <p className="text-[11px] font-medium mt-0.5" style={{ color: "#6B5B95" }}>{l}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 max-w-[400px] space-y-3">
            <div
              className="rounded-2xl p-4"
              style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(55,48,163,0.15)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: "#5A4A78" }}>
                  Today's active shifts
                </p>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(55,48,163,0.12)", color: "#3730A3" }}
                >
                  4 live
                </span>
              </div>
              <div className="space-y-2.5">
                {SHIFT_WORKERS.map((w) => (
                  <div key={w.name} className="flex items-center gap-2.5">
                    <div
                      className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0"
                      style={{ background: w.color }}
                    >
                      {w.i}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold" style={{ color: "#2D1B4E" }}>{w.name}</p>
                      <p className="text-[11px]" style={{ color: "#6B5B95" }}>
                        {w.role} · {w.time}
                      </p>
                    </div>
                    <div className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "#4ADE80" }} />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              {[["Compliance","94%","NDIS score"],["Participants","38","active plans"]].map(([t, v, s]) => (
                <div
                  key={t}
                  className="flex-1 rounded-2xl px-4 py-3"
                  style={{ background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.30)" }}>{t}</p>
                  <p className="text-[24px] font-black text-white mt-0.5">{v}</p>
                  <p className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.30)" }}>{s}</p>
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
                style={{ background: a.bg, borderColor: "#0F172A" }}
              >
                {a.i}
              </div>
            ))}
          </div>
          <div>
            <p className="text-[14px] font-black text-white">200+ NDIS providers</p>
            <p className="text-[12px] font-medium" style={{ color: "rgba(255,255,255,0.36)" }}>
              trust CareCliQ across Australia
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
