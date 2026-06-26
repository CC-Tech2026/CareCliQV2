import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth, type AccountType } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";

// ── Palette ───────────────────────────────────────────────────────────────────
const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "#C7D2FE";
const BG = "#F8F8FE";

// ── Password Strength Indicator ───────────────────────────────────────────────
function PasswordStrengthBar({ password }: { password: string }) {
  const getScore = (pwd: string): number => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;
    return Math.min(score, 4); // Max 4 levels
  };

  const score = getScore(password);
  const colors = ["#EF4444", "#F97316", "#FBBF24", "#22C55E"];
  const labels = ["Weak", "Fair", "Good", "Strong"];

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
          aria-label={showPassword ? "Hide password" : "Show password"}
          onClick={() => setShowPassword((value) => !value)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280]"
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

  const STEP_LABELS = ["Your Details", "Organisation"];

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
          .catch(() => ({ detail: "Registration failed" }));
        throw new Error(errBody.detail || "Registration failed");
      }

      let token: string | null = null;

      try {
        const result = await login(form.email, form.password);
        if (result.status === "authenticated") {
          token = localStorage.getItem("carescribe_token");
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
                title: "Database migration required",
                description:
                  "Your account is ready but organisation setup needs the database migration. " +
                  "Run supabase_setup.sql in your Supabase SQL editor to activate multi-tenant features.",
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
        title: "Sign up failed",
        description: err instanceof Error ? err.message : "Please try again.",
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
      className="h-screen w-screen flex bg-[#F8F8FE] overflow-hidden"
      style={{ animation: "authPageEnter 0.3s ease-out" }}
    >
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
        style={{ background: "linear-gradient(135deg, #F5F3FF 0%, #FFF9F0 100%)" }}
      >
        {/* Subtle radial glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 0% 100%, rgba(55,48,163,0.08) 0%, transparent 60%), radial-gradient(ellipse at 100% 0%, rgba(190,24,93,0.06) 0%, transparent 50%)",
          }}
        />

        <div className="relative z-10 flex flex-col justify-between h-full">
          <div>
            <img
              src="/carecliQ_logo.png"
              alt="CareCliQ"
              className="max-w-[200px]"
            />
            <p className="mt-3 text-[11px] font-black tracking-[0.2em] uppercase" style={{ color: "#6B5B95" }}>
              NDIS Compliance Made Easy
            </p>
          </div>

          <div>
            <h1 className="text-[42px] font-black leading-[1.15] tracking-tight" style={{ color: "#2D1B4E" }}>
              Write better notes,
              <br />
              <span style={{ color: "#3730A3" }}>faster than ever.</span>
            </h1>
            <p className="mt-5 leading-relaxed max-w-[380px]" style={{ color: "#5A4A78" }}>
              Manage your participants, support workers, compliance, and NDIS
              documentation — all in one place built for Australian disability
              support businesses.
            </p>

            <div className="mt-10 flex items-center gap-6">
              <div>
                <p className="text-2xl font-black" style={{ color: "#2D1B4E" }}>24 hr</p>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: "#6B5B95" }}>NDIS note deadline</p>
              </div>
              <div className="h-10 w-px" style={{ background: "rgba(55,48,163,0.12)" }} />
              <div>
                <p className="text-2xl font-black" style={{ color: "#2D1B4E" }}>100%</p>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: "#6B5B95" }}>compliance tracked</p>
              </div>
              <div className="h-10 w-px" style={{ background: "rgba(55,48,163,0.12)" }} />
              <div>
                <p className="text-2xl font-black" style={{ color: "#2D1B4E" }}>AU</p>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: "#6B5B95" }}>NDIS registered</p>
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
                    style={{ background: a.bg, borderColor: "#F5F3FF" }}
                  >
                    {a.initials}
                  </div>
                ))}
              </div>
              <p className="text-[13px] font-medium" style={{ color: "#2D1B4E" }}>
                Joined by 200+ NDIS providers
              </p>
            </div>
          </div>

          <div className="text-[11px] font-bold tracking-wider" style={{ color: "#6B5B95" }}>
            © 2026 CareCliQ · Built for Australian disability support
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-4 sm:p-8 md:p-12 lg:px-20">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 justify-center mb-5 bg-white px-4 py-2.5 rounded-2xl border border-[#C7D2FE]/60">
            {STEP_LABELS.map((l, i) => (
              <div key={l} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="h-1 w-full rounded-full"
                  style={{
                    background: i + 1 <= step ? PLUM : "#E5E7EB",
                  }}
                />

                <span
                  className="text-[9px] font-bold uppercase"
                  style={{
                    color: i + 1 <= step ? PLUM : "#9CA3AF",
                  }}
                >
                  {l.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>

          <div className="w-full min-h-0 pointer-events-auto bg-white rounded-[2rem] px-5 py-6 sm:p-8 shadow-[0_16px_48px_-12px_rgba(55,48,163,0.08)] border border-[#E8D5E8]/50 overflow-y-auto">
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
                    Create account
                  </h2>

                  <p className="text-sm text-[#6B7280]">
                    You'll use these to sign in
                  </p>
                </div>

                <div>
                  <Label>Full name</Label>

                  <StyledInput
                    name="full_name"
                    value={form.full_name}
                    onChange={(v) => updateField("full_name", v)}
                    placeholder="Jane Smith"
                    autoComplete="name"
                  />
                </div>

                <div>
                  <Label>Email</Label>

                  <StyledInput
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={(v) => updateField("email", v)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <Label>Password</Label>
                  <StyledInput
                    name="password"
                    type="password"
                    value={form.password}
                    onChange={(v) => updateField("password", v)}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                    error={short}
                  />
                  {form.password && (
                    <div className="mt-2.5">
                      <PasswordStrengthBar password={form.password} />
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Label>Confirm password</Label>
                    {form.confirm_password && (
                      <span
                        className="text-[11px] font-bold"
                        style={{
                          color: mismatch ? "#EF4444" : "#22C55E",
                        }}
                      >
                        {mismatch ? "✗ Doesn't match" : "✓ Matches"}
                      </span>
                    )}
                  </div>

                  <StyledInput
                    name="confirm_password"
                    type="password"
                    value={form.confirm_password}
                    onChange={(v) => updateField("confirm_password", v)}
                    placeholder="Repeat password"
                    error={mismatch}
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
                    Back
                  </button>

                  <button
                    type="submit"
                    disabled={!step1Valid()}
                    className="flex-1 h-11 rounded-xl text-white font-black disabled:opacity-40"
                    style={{
                      background: PLUM,
                    }}
                  >
                    Continue
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <form onSubmit={handleSubmit} className="space-y-4 step-content">
                {form.account_type === "allied_health" && (
                  <AlliedHealthFields
                    form={form}
                    updateField={updateField}
                    disabled={busy}
                  />
                )}

                {form.account_type === "small_provider" && (
                  <SmallProviderFields
                    form={form}
                    updateField={updateField}
                    disabled={busy}
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
                    Back
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
                        Setting up...
                      </>
                    ) : (
                      <>
                        Complete Setup
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
                  {emailVerify ? "Check your email" : "You're all set!"}
                </h2>

                <p className="text-[#6B7280] mt-2">
                  {emailVerify
                    ? `We sent a verification email to ${form.email}`
                    : "Your account is ready."}
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
                    ? "Go to Login"
                    : form.account_type === "small_provider"
                      ? "Set Up Your Organisation"
                      : "Go to Dashboard"}
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
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="font-black transition-all duration-200 hover:opacity-75 focus:outline-none focus-visible:underline rounded"
                style={{ color: CORAL }}
              >
                Sign In
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

// ── Allied Health ─────────────────────────────────────────────────────────────
function AlliedHealthFields({ form, updateField, disabled }: any) {
  return (
    <>
      <div>
        <Label>Profession</Label>

        <StyledSelect
          name="ah_profession_type"
          value={form.ah_profession_type}
          onChange={(v) => updateField("ah_profession_type", v)}
          placeholder="Select profession..."
          disabled={disabled}
          options={[
            {
              value: "occupational_therapist",
              label: "Occupational Therapist",
            },
            { value: "speech_pathologist", label: "Speech Pathologist" },
            { value: "physiotherapist", label: "Physiotherapist" },
            {
              value: "behaviour_support",
              label: "Behaviour Support Practitioner",
            },
            { value: "social_worker", label: "Social Worker" },
            { value: "psychologist", label: "Psychologist" },
          ]}
        />
      </div>

      <div>
        <Label>Registration status</Label>

        <StyledSelect
          name="ah_registration_status"
          value={form.ah_registration_status}
          onChange={(v) => updateField("ah_registration_status", v)}
          placeholder="Select status..."
          disabled={disabled}
          options={[
            { value: "ahpra_registered", label: "AHPRA Registered" },
            { value: "ndis_registered", label: "NDIS Registered Provider" },
            { value: "unregistered", label: "Unregistered" },
          ]}
        />
      </div>

      <div>
        <Label>AHPRA / Provider number</Label>

        <StyledInput
          name="ah_provider_number"
          value={form.ah_provider_number}
          onChange={(v) => updateField("ah_provider_number", v)}
          placeholder="e.g. OCC0001234"
          disabled={disabled}
          required={false}
        />
      </div>

      <div>
        <Label>Specialties</Label>

        <StyledInput
          name="ah_specialties"
          value={form.ah_specialties}
          onChange={(v) => updateField("ah_specialties", v)}
          placeholder="e.g. Autism, acquired brain injury"
          disabled={disabled}
          required={false}
        />
      </div>

      <div>
        <Label>Clinic / Employer name</Label>

        <StyledInput
          name="ah_clinic_name"
          value={form.ah_clinic_name}
          onChange={(v) => updateField("ah_clinic_name", v)}
          placeholder="Clinic or employer"
          disabled={disabled}
          required={false}
        />
      </div>
    </>
  );
}

// ── Small Provider ────────────────────────────────────────────────────────────
function SmallProviderFields({ form, updateField, disabled }: any) {
  return (
    <>
      <div>
        <Label>Organisation Name</Label>

        <StyledInput
          name="sp_organisation_name"
          value={form.sp_organisation_name}
          onChange={(v) => updateField("sp_organisation_name", v)}
          placeholder="Care Partners Ltd"
          disabled={disabled}
        />
      </div>

      <div>
        <Label>Provider type</Label>

        <StyledSelect
          name="sp_provider_type"
          value={form.sp_provider_type}
          onChange={(v) => updateField("sp_provider_type", v)}
          placeholder="Select type..."
          disabled={disabled}
          required={false}
          options={[
            { value: "registered_ndis", label: "Registered NDIS Provider" },
            { value: "unregistered", label: "Unregistered Provider" },
            { value: "plan_management", label: "Plan Management Provider" },
            { value: "support_coord", label: "Support Coordination Provider" },
          ]}
        />
      </div>

      <div>
        <Label>Registration status</Label>

        <StyledSelect
          name="sp_registration_status"
          value={form.sp_registration_status}
          onChange={(v) => updateField("sp_registration_status", v)}
          placeholder="Select status..."
          disabled={disabled}
          required={false}
          options={[
            { value: "registered", label: "Registered with NDIS Commission" },
            { value: "unregistered", label: "Unregistered" },
            { value: "in_progress", label: "Registration in Progress" },
          ]}
        />
      </div>

      <div>
        <Label>Team size</Label>

        <StyledSelect
          name="sp_team_size"
          value={form.sp_team_size}
          onChange={(v) => updateField("sp_team_size", v)}
          placeholder="Select size..."
          disabled={disabled}
          required={false}
          options={[
            { value: "1_5", label: "1–5 staff" },
            { value: "5_20", label: "5–20 staff" },
            { value: "20_plus", label: "20+ staff" },
          ]}
        />
      </div>

      <div>
        <Label>Active participant volume</Label>

        <StyledSelect
          name="sp_participant_volume"
          value={form.sp_participant_volume}
          onChange={(v) => updateField("sp_participant_volume", v)}
          placeholder="Approx. number of participants..."
          disabled={disabled}
          required={false}
          options={[
            { value: "1_10", label: "1–10 participants" },
            { value: "10_50", label: "10–50 participants" },
            { value: "50_plus", label: "50+ participants" },
          ]}
        />
      </div>

      <div>
        <Label>Contact number</Label>

        <StyledInput
          name="sp_contact_number"
          value={form.sp_contact_number}
          onChange={(v) => updateField("sp_contact_number", v)}
          placeholder="02 xxxx xxxx"
          disabled={disabled}
          required={false}
        />
      </div>
    </>
  );
}
