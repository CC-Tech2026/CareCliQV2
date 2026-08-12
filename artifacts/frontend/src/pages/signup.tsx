import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { CCQ_TOKEN_KEY } from "@/lib/storage-keys";
import { useAuth, type AccountType } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";

// ── Palette ───────────────────────────────────────────────────────────────────
const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "var(--auth-input-border)";
const BG = "var(--auth-input-bg)";

// ── Password Strength Indicator ───────────────────────────────────────────────
function PasswordStrengthBar({ password, t }: { password: string; t: (key: string) => string }) {
  const getScore = (pwd: string): number => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;
    return Math.min(score, 4);
  };

  const score = getScore(password);
  const colors = ["#EF4444", "#F97316", "#FBBF24", "#22C55E"];
  const labels = [
    t("auth.signup.passwordWeak"),
    t("auth.signup.passwordFair"),
    t("auth.signup.passwordGood"),
    t("auth.signup.passwordStrong"),
  ];

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex-1 h-1.5 rounded-full transition-all duration-300"
            style={{
              background: i < score ? colors[score - 1] : "#E5E7EB",
            }}
          />
        ))}
      </div>
      {password && (
        <p className="text-[11px] font-medium" style={{ color: colors[Math.max(score - 1, 0)] }}>
          {labels[Math.max(score - 1, 0)]}
        </p>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface FormData {
  account_type: AccountType | "";
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;

  ah_profession_type: string;
  ah_registration_status: string;
  ah_provider_number: string;
  ah_specialties: string;
  ah_clinic_name: string;

  sp_organisation_name: string;
  sp_provider_type: string;
  sp_registration_status: string;
  sp_team_size: string;
  sp_participant_volume: string;
  sp_contact_number: string;
}

const EMPTY: FormData = {
  account_type: "small_provider",
  full_name: "",
  email: "",
  password: "",
  confirm_password: "",

  ah_profession_type: "",
  ah_registration_status: "",
  ah_provider_number: "",
  ah_specialties: "",
  ah_clinic_name: "",

  sp_organisation_name: "",
  sp_provider_type: "",
  sp_registration_status: "",
  sp_team_size: "",
  sp_participant_volume: "",
  sp_contact_number: "",
};

// ── Input ─────────────────────────────────────────────────────────────────────
function StyledInput({
  name,
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
  autoComplete,
  error,
  required = true,
  showPasswordLabel,
  hidePasswordLabel,
}: {
  name?: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  error?: boolean;
  required?: boolean;
  showPasswordLabel?: string;
  hidePasswordLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className="relative">
      <input
        name={name}
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        required={required}
        spellCheck={false}
        className={`w-full h-11 px-4 rounded-xl text-[16px] md:text-[14px] font-medium outline-none transition-all duration-200${isPassword ? " pr-11" : ""}`}
        style={{
          background: BG,
          border: `1.5px solid ${error ? "#EF4444" : focused ? CORAL : BORDER}`,
          color: "var(--cc-text)",
          WebkitAppearance: "none",
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {isPassword ? (
        <button
          type="button"
          aria-label={showPassword ? hidePasswordLabel : showPasswordLabel}
          onClick={() => setShowPassword((value) => !value)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-cc-muted"
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      ) : null}
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────
function StyledSelect({
  name,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  required = true,
}: {
  name?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      required={required}
      className="w-full h-11 px-4 rounded-xl text-[16px] md:text-[14px] font-medium outline-none transition-all duration-200"
      style={{
        background: BG,
        border: `1.5px solid ${focused ? CORAL : BORDER}`,
        color: "var(--cc-text)",
        WebkitAppearance: "none",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {placeholder && (
        <option value="" disabled hidden>
          {placeholder}
        </option>
      )}

      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
      style={{ color: PLUM }}
    >
      {children}
    </p>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Signup() {
  const { login, updateUser, updateToken } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate: t, translateParams } = useAccessibility();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [emailVerify, setEmailVerify] = useState(false);

  const updateField = useCallback((f: keyof FormData, v: string) => {
    setForm((p) => ({
      ...p,
      [f]: v,
    }));
  }, []);

  const STEP_LABELS = [t("auth.signup.step.details"), t("auth.signup.step.organisation")];

  function step1Valid() {
    return (
      form.full_name.trim() !== "" &&
      form.email.trim() !== "" &&
      form.password.length >= 8 &&
      form.password === form.confirm_password
    );
  }

  function step2Valid() {
    return form.sp_organisation_name.trim() !== "";
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();

    if (!step2Valid() || busy) return;

    setBusy(true);

    try {
      const res = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          account_type: form.account_type,
        }),
      });

      if (!res.ok) {
        const errBody = await res
          .json()
          .catch(() => ({ detail: t("auth.signup.error.registrationFailed") }));
        throw new Error(errBody.detail || t("auth.signup.error.registrationFailed"));
      }

      let token: string | null = null;

      try {
        const result = await login(form.email, form.password);
        if (result.status === "authenticated") {
          token = localStorage.getItem(CCQ_TOKEN_KEY);
        }
      } catch (err) {
        setEmailVerify(true);
        setStep(3);
        return;
      }

      if (token) {
        try {
          const onboardingRes = await apiFetch(
            "/api/auth/complete-onboarding",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(buildPayload(form)),
            },
          );

          // complete-onboarding now returns a fresh JWT that already includes
          // organization_id — use it directly so no second login is needed.
          if (onboardingRes.ok) {
            const onboardingData = await onboardingRes.json().catch(() => ({}));
            if (onboardingData.access_token) {
              await updateToken(onboardingData.access_token);
            } else {
              updateUser({ onboarding_complete: true });
            }
            if (
              form.account_type === "small_provider" &&
              !onboardingData.org_created
            ) {
              toast({
                title: t("auth.signup.toast.migrationTitle"),
                description: t("auth.signup.toast.migrationDesc"),
                variant: "destructive",
              });
            }
          } else {
            updateUser({ onboarding_complete: true });
          }
        } catch {
          updateUser({ onboarding_complete: true });
        }
      }

      setStep(3);
    } catch (err) {
      toast({
        title: t("auth.signup.error.failed"),
        description: err instanceof Error ? err.message : t("auth.signup.error.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const mismatch =
    !!form.confirm_password && form.password !== form.confirm_password;

  const short = !!form.password && form.password.length < 8;

  return (
    <div
      className="relative h-screen w-screen flex overflow-hidden bg-[var(--auth-shell-bg)] text-cc-text"
      style={{ animation: "authPageEnter 0.3s ease-out" }}
    >
      <div className="absolute top-4 right-4 z-30 sm:top-5 sm:right-5">
        <AuthThemeToggle />
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes authPageEnter {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes stepSlideIn {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .step-content {
          animation: stepSlideIn 0.28s ease-out;
        }
      `,
        }}
      />
      {/* LEFT */}
      <div
        className="hidden md:flex md:w-1/2 relative h-full overflow-hidden flex-col justify-between p-12"
        style={{ background: "var(--auth-marketing-bg)" }}
      >
        {/* Subtle radial glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "var(--auth-marketing-glow)" }}
        />

        <div className="relative z-10 flex flex-col justify-between h-full">
          <div>
            <CareCliQLogo size={96} />
            <p className="mt-3 text-[11px] font-black tracking-[0.2em] uppercase" style={{ color: "var(--auth-marketing-muted)" }}>
              {t("auth.signup.marketing.tagline")}
            </p>
          </div>

          <div>
            <h1 className="text-[42px] font-black leading-[1.15] tracking-tight" style={{ color: "var(--auth-headline)" }}>
              {t("auth.signup.marketing.headline1")}
              <br />
              <span style={{ color: "var(--auth-accent)" }}>{t("auth.signup.marketing.headline2")}</span>
            </h1>
            <p className="mt-5 leading-relaxed max-w-[380px]" style={{ color: "var(--auth-marketing-body)" }}>
              {t("auth.signup.marketing.description")}
            </p>

            <div className="mt-10 flex items-center gap-6">
              <div>
                <p className="text-2xl font-black" style={{ color: "var(--auth-stat-value)" }}>24 hr</p>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: "var(--auth-marketing-muted)" }}>{t("auth.signup.marketing.noteDeadline")}</p>
              </div>
              <div className="h-10 w-px" style={{ background: "var(--auth-stat-card-border)" }} />
              <div>
                <p className="text-2xl font-black" style={{ color: "var(--auth-stat-value)" }}>100%</p>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: "var(--auth-marketing-muted)" }}>{t("auth.signup.marketing.complianceTracked")}</p>
              </div>
              <div className="h-10 w-px" style={{ background: "var(--auth-stat-card-border)" }} />
              <div>
                <p className="text-2xl font-black" style={{ color: "var(--auth-stat-value)" }}>AU</p>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: "var(--auth-marketing-muted)" }}>{t("auth.signup.marketing.ndisRegistered")}</p>
              </div>
            </div>

            {/* People / social proof */}
            <div className="mt-8 flex items-center gap-3">
              <div className="flex -space-x-2">
                {[
                  { initials: "SC", bg: "#3730A3" },
                  { initials: "OT", bg: "#0D7C66" },
                  { initials: "TL", bg: "#7B3F9E" },
                  { initials: "PM", bg: "#1A6FA8" },
                ].map((a) => (
                  <div
                    key={a.initials}
                    className="h-8 w-8 rounded-full border-2 flex items-center justify-center text-[10px] font-black text-white"
                    style={{ background: a.bg, borderColor: "var(--auth-form-bg)" }}
                  >
                    {a.initials}
                  </div>
                ))}
              </div>
              <p className="text-[13px] font-medium" style={{ color: "var(--auth-headline)" }}>
                {t("auth.signup.marketing.joinedBy")}
              </p>
            </div>
          </div>

          <div className="text-[11px] font-bold tracking-wider" style={{ color: "var(--auth-marketing-muted)" }}>
            {t("auth.signup.marketing.copyright")}
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-4 sm:p-8 md:p-12 lg:px-20">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 justify-center mb-5 px-4 py-2.5 rounded-2xl border bg-[var(--auth-form-bg)]" style={{ borderColor: "var(--auth-card-border)" }}>
            {STEP_LABELS.map((l, i) => (
              <div key={l} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="h-1 w-full rounded-full"
                  style={{
                    background: i + 1 <= step ? PLUM : "var(--cc-border)",
                  }}
                />

                <span
                  className="text-[9px] font-bold uppercase"
                  style={{
                    color: i + 1 <= step ? PLUM : "var(--cc-muted)",
                  }}
                >
                  {l.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>

          <div className="w-full min-h-0 pointer-events-auto rounded-[2rem] px-5 py-6 sm:p-8 shadow-[var(--cc-shadow-md)] border overflow-y-auto bg-[var(--auth-form-bg)]" style={{ borderColor: "var(--auth-card-border)" }}>
            {/* STEP 1 */}
            {step === 1 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();

                  if (step1Valid()) {
                    setStep(2);
                  }
                }}
                className="space-y-4 step-content"
              >
                <div>
                  <h2
                    className="text-[22px] font-black"
                    style={{ color: PLUM }}
                  >
                    {t("auth.signup.title")}
                  </h2>

                  <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
                    {t("auth.signup.subtitle")}
                  </p>
                </div>

                <div>
                  <Label>{t("auth.signup.fullName")}</Label>

                  <StyledInput
                    name="full_name"
                    value={form.full_name}
                    onChange={(v) => updateField("full_name", v)}
                    placeholder={t("auth.signup.namePlaceholder")}
                    autoComplete="name"
                  />
                </div>

                <div>
                  <Label>{t("auth.signup.email")}</Label>

                  <StyledInput
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={(v) => updateField("email", v)}
                    placeholder={t("auth.signup.emailPlaceholder")}
                    autoComplete="email"
                  />
                </div>

                <div>
                  <Label>{t("auth.signup.password")}</Label>
                  <StyledInput
                    name="password"
                    type="password"
                    value={form.password}
                    onChange={(v) => updateField("password", v)}
                    placeholder={t("auth.signup.passwordPlaceholder")}
                    autoComplete="new-password"
                    error={short}
                    showPasswordLabel={t("auth.signup.showPassword")}
                    hidePasswordLabel={t("auth.signup.hidePassword")}
                  />
                  {form.password && (
                    <div className="mt-2.5">
                      <PasswordStrengthBar password={form.password} t={t} />
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Label>{t("auth.signup.confirmPassword")}</Label>
                    {form.confirm_password && (
                      <span
                        className="text-[11px] font-bold"
                        style={{
                          color: mismatch ? "#EF4444" : "#22C55E",
                        }}
                      >
                        {mismatch ? t("auth.signup.passwordMismatch") : t("auth.signup.passwordMatch")}
                      </span>
                    )}
                  </div>

                  <StyledInput
                    name="confirm_password"
                    type="password"
                    value={form.confirm_password}
                    onChange={(v) => updateField("confirm_password", v)}
                    placeholder={t("auth.signup.confirmPlaceholder")}
                    error={mismatch}
                    showPasswordLabel={t("auth.signup.showPassword")}
                    hidePasswordLabel={t("auth.signup.hidePassword")}
                  />
                </div>

                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => navigate("/login")}
                    className="h-11 px-5 rounded-xl border font-black"
                    style={{
                      borderColor: BORDER,
                      color: PLUM,
                    }}
                  >
                    {t("auth.signup.back")}
                  </button>

                  <button
                    type="submit"
                    disabled={!step1Valid()}
                    className="flex-1 h-11 rounded-xl text-white font-black disabled:opacity-40"
                    style={{
                      background: PLUM,
                    }}
                  >
                    {t("auth.signup.continue")}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <form onSubmit={handleSubmit} className="space-y-4 step-content">

                {form.account_type === "small_provider" && (
                  <SmallProviderFields
                    form={form}
                    updateField={updateField}
                    disabled={busy}
                    t={t}
                  />
                )}

                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="h-11 px-5 rounded-xl border font-black"
                    style={{
                      borderColor: BORDER,
                      color: PLUM,
                    }}
                  >
                    {t("auth.signup.back")}
                  </button>

                  <button
                    type="submit"
                    disabled={!step2Valid() || busy}
                    className="flex-1 h-11 rounded-xl text-white font-black disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{
                      background: PLUM,
                    }}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="animate-spin" />
                        {t("auth.signup.settingUp")}
                      </>
                    ) : (
                      <>
                        {t("auth.signup.completeSetup")}
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <div className="text-center py-6 step-content">
                <CheckCircle2
                  size={70}
                  style={{
                    color: CORAL,
                    margin: "0 auto",
                  }}
                />

                <h2
                  className="text-[24px] font-black mt-5"
                  style={{ color: PLUM }}
                >
                  {emailVerify ? t("auth.signup.checkEmail") : t("auth.signup.allSet")}
                </h2>

                <p className="mt-2" style={{ color: "var(--cc-muted)" }}>
                  {emailVerify
                    ? translateParams("auth.signup.verificationSent", { email: form.email })
                    : t("auth.signup.accountReady")}
                </p>

                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      emailVerify
                        ? "/login"
                        : form.account_type === "small_provider"
                          ? "/getting-started"
                          : "/dashboard",
                    )
                  }
                  className="mt-6 w-full h-11 rounded-xl text-white font-black"
                  style={{
                    background: PLUM,
                  }}
                >
                  {emailVerify
                    ? t("auth.signup.goToLogin")
                    : form.account_type === "small_provider"
                      ? t("auth.signup.setupOrganisation")
                      : t("auth.signup.goToDashboard")}
                </button>
              </div>
            )}
          </div>

          {/* Sign-in nav — visible on all steps except the success screen */}
          {step < 3 && (
            <p
              className="text-center text-[13px] font-medium mt-5 pb-1"
              style={{ color: "var(--cc-muted)" }}
            >
              {t("auth.signup.hasAccount")}{" "}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="font-black transition-all duration-200 hover:opacity-75 focus:outline-none focus-visible:underline rounded"
                style={{ color: CORAL }}
              >
                {t("auth.signup.signIn")}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payload Builder ───────────────────────────────────────────────────────────
function buildPayload(form: FormData) {
  const base: Record<string, unknown> = {
    account_type: form.account_type,
  };

  if (form.account_type === "small_provider") {
    base.organization_name = form.sp_organisation_name;
    if (form.sp_provider_type) base.provider_type = form.sp_provider_type;
    if (form.sp_registration_status)
      base.registration_status = form.sp_registration_status;
    if (form.sp_team_size) base.team_size = form.sp_team_size;
    if (form.sp_participant_volume)
      base.participant_volume = form.sp_participant_volume;
    if (form.sp_contact_number) base.contact_number = form.sp_contact_number;
  } else if (form.account_type === "allied_health") {
    base.onboarding_data = {
      profession_type: form.ah_profession_type,
      registration_status: form.ah_registration_status,
      provider_number: form.ah_provider_number,
      specialties: form.ah_specialties,
      clinic_name: form.ah_clinic_name,
    };
  }

  return base;
}

// ── Small Provider ────────────────────────────────────────────────────────────
function SmallProviderFields({ form, updateField, disabled, t }: { form: FormData; updateField: (f: keyof FormData, v: string) => void; disabled?: boolean; t: (key: string) => string }) {
  return (
    <>
      <div>
        <Label>{t("auth.signup.field.organisationName")}</Label>

        <StyledInput
          name="sp_organisation_name"
          value={form.sp_organisation_name}
          onChange={(v) => updateField("sp_organisation_name", v)}
          placeholder={t("auth.signup.placeholder.organisation")}
          disabled={disabled}
        />
      </div>

      <div>
        <Label>{t("auth.signup.field.providerType")}</Label>

        <StyledSelect
          name="sp_provider_type"
          value={form.sp_provider_type}
          onChange={(v) => updateField("sp_provider_type", v)}
          placeholder={t("auth.signup.placeholder.selectType")}
          disabled={disabled}
          required={false}
          options={[
            { value: "registered_ndis", label: t("auth.signup.providerType.registeredNdis") },
            { value: "unregistered", label: t("auth.signup.providerType.unregistered") },
            { value: "plan_management", label: t("auth.signup.providerType.planManagement") },
            { value: "support_coord", label: t("auth.signup.providerType.supportCoord") },
          ]}
        />
      </div>

      <div>
        <Label>{t("auth.signup.field.registrationStatus")}</Label>

        <StyledSelect
          name="sp_registration_status"
          value={form.sp_registration_status}
          onChange={(v) => updateField("sp_registration_status", v)}
          placeholder={t("auth.signup.placeholder.selectStatus")}
          disabled={disabled}
          required={false}
          options={[
            { value: "registered", label: t("auth.signup.regStatus.registered") },
            { value: "unregistered", label: t("auth.signup.status.unregistered") },
            { value: "in_progress", label: t("auth.signup.regStatus.inProgress") },
          ]}
        />
      </div>

      <div>
        <Label>{t("auth.signup.field.teamSize")}</Label>

        <StyledSelect
          name="sp_team_size"
          value={form.sp_team_size}
          onChange={(v) => updateField("sp_team_size", v)}
          placeholder={t("auth.signup.placeholder.selectSize")}
          disabled={disabled}
          required={false}
          options={[
            { value: "1_5", label: t("auth.signup.teamSize.1_5") },
            { value: "5_20", label: t("auth.signup.teamSize.5_20") },
            { value: "20_plus", label: t("auth.signup.teamSize.20_plus") },
          ]}
        />
      </div>

      <div>
        <Label>{t("auth.signup.field.participantVolume")}</Label>

        <StyledSelect
          name="sp_participant_volume"
          value={form.sp_participant_volume}
          onChange={(v) => updateField("sp_participant_volume", v)}
          placeholder={t("auth.signup.placeholder.participantCount")}
          disabled={disabled}
          required={false}
          options={[
            { value: "1_10", label: t("auth.signup.participantVolume.1_10") },
            { value: "10_50", label: t("auth.signup.participantVolume.10_50") },
            { value: "50_plus", label: t("auth.signup.participantVolume.50_plus") },
          ]}
        />
      </div>

      <div>
        <Label>{t("auth.signup.field.contactNumber")}</Label>

        <StyledInput
          name="sp_contact_number"
          value={form.sp_contact_number}
          onChange={(v) => updateField("sp_contact_number", v)}
          placeholder={t("auth.signup.placeholder.contact")}
          disabled={disabled}
          required={false}
        />
      </div>
    </>
  );
}
