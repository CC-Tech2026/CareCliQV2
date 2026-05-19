import { useState, useCallback } from "react";
import { useLocation } from "wouter";
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
const PLUM = "#5533CC";
const CORAL = "#F03060";
const BLUSH = "#F8C0CE";
const BORDER = "#D8D0F0";
const BG = "#F5F3FC";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FormData {
  account_type: AccountType | "";
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;

  iw_registration_status: string;
  iw_support_specialties: string;
  iw_years_experience: string;
  iw_mobile: string;

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
  account_type: "",
  full_name: "",
  email: "",
  password: "",
  confirm_password: "",

  iw_registration_status: "",
  iw_support_specialties: "",
  iw_years_experience: "",
  iw_mobile: "",

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

  return (
    <input
      name={name}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      required={required}
      spellCheck={false}
      className="w-full h-11 px-4 rounded-xl text-[16px] md:text-[14px] font-medium outline-none transition-all duration-200"
      style={{
        background: BG,
        border: `1.5px solid ${
          error ? "#EF4444" : focused ? CORAL : BORDER
        }`,
        color: "#1E1640",
        WebkitAppearance: "none",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
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
        color: "#1E1640",
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

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailVerify, setEmailVerify] = useState(false);

  const updateField = useCallback(
    (f: keyof FormData, v: string) => {
      setForm((p) => ({
        ...p,
        [f]: v,
      }));
    },
    []
  );

  const STEP_LABELS = [
    "Account Type",
    "Your Details",
    "Practice Info",
  ];

  const TYPES = [
    {
      value: "independent_worker" as AccountType,
      title: "Independent Support Worker",
      sub: "Sole trader, unregistered provider, or independent worker",
      dot: CORAL,
    },
    {
      value: "allied_health" as AccountType,
      title: "Allied Health Professional",
      sub: "OT, Speech Pathologist, Physio, Behaviour Support",
      dot: "#9B5DE5",
    },
    {
      value: "small_provider" as AccountType,
      title: "Small Provider / Care Team",
      sub: "Small care company or NDIS provider organisation",
      dot: PLUM,
    },
  ] as const;

  function step1Valid() {
    return (
      form.full_name.trim() !== "" &&
      form.email.trim() !== "" &&
      form.password.length >= 8 &&
      form.password === form.confirm_password
    );
  }

  function step2Valid() {
    if (form.account_type === "independent_worker") {
      return (
        form.iw_registration_status !== "" &&
        form.iw_mobile.trim() !== ""
      );
    }

    if (form.account_type === "allied_health") {
      return (
        form.ah_profession_type !== "" &&
        form.ah_registration_status !== ""
      );
    }

    if (form.account_type === "small_provider") {
      return form.sp_organisation_name.trim() !== "";
    }

    return false;
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();

    if (!step2Valid() || busy) return;

    setBusy(true);

    try {
      const res = await fetch("/api/auth/register", {
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
        const errBody = await res.json().catch(() => ({ detail: "Registration failed" }));
        throw new Error(errBody.detail || "Registration failed");
      }

      let token: string | null = null;

      try {
        const u = await login(form.email, form.password);

        token = u
          ? localStorage.getItem("carescribe_token")
          : null;
      } catch (err) {
        setEmailVerify(true);
        setStep(3);
        return;
      }

      if (token) {
        try {
          const onboardingRes = await fetch("/api/auth/complete-onboarding", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(buildPayload(form)),
          });

          // complete-onboarding now returns a fresh JWT that already includes
          // organization_id — use it directly so no second login is needed.
          if (onboardingRes.ok) {
            const onboardingData = await onboardingRes.json().catch(() => ({}));
            if (onboardingData.access_token) {
              await updateToken(onboardingData.access_token);
            } else {
              updateUser({ onboarding_complete: true });
            }
            if (form.account_type === "small_provider" && !onboardingData.org_created) {
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
        description:
          err instanceof Error
            ? err.message
            : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const mismatch =
    !!form.confirm_password &&
    form.password !== form.confirm_password;

  const short =
    !!form.password &&
    form.password.length < 8;

  return (
    <div className="h-screen w-screen flex bg-[#F5F3FC] overflow-hidden" style={{ animation: "authPageEnter 0.3s ease-out" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes authPageEnter {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      ` }} />
      {/* LEFT */}
      <div className="hidden md:flex md:w-1/2 relative h-full overflow-hidden">
        <div
          className="absolute inset-0 z-0 pointer-events-none bg-cover bg-center"
          style={{
            backgroundImage: `url('/signup_welcome.jpg')`,
          }}
        />

        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(135deg, rgba(30,22,64,0.85) 0%, rgba(85,51,204,0.5) 50%, rgba(240,48,96,0.4) 100%)",
          }}
        />

        <div
          className="absolute inset-0 z-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <img
              src="/logo.png"
              alt="CareScribe"
              className="max-w-[220px]"
            />

            <p className="mt-3 text-xs font-black tracking-[0.18em] uppercase text-[#FFD2DA]">
              NDIS Compliance Made Easy
            </p>
          </div>

          <div>
            <h1 className="text-5xl font-black text-white leading-tight">
              Write beautiful notes,
              <br />
              <span className="text-[#FFD2DA]">
                minus the heavy admin.
              </span>
            </h1>

            <p className="mt-5 text-white/90 max-w-md leading-relaxed">
              Join thousands of Australian healthcare operators automating
              invoicing, case tracking, and smart templates.
            </p>
          </div>

          <div className="text-white/70 text-xs font-bold tracking-wider">
            © 2026 CARESCRIBE
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-4 sm:p-8 md:p-12 lg:px-20">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 justify-center mb-5 bg-white px-4 py-2.5 rounded-2xl border border-[#D8D0F0]/60">
            {STEP_LABELS.map((l, i) => (
              <div
                key={l}
                className="flex-1 flex flex-col items-center gap-1"
              >
                <div
                  className="h-1 w-full rounded-full"
                  style={{
                    background:
                      i <= step ? PLUM : "#E5E7EB",
                  }}
                />

                <span
                  className="text-[9px] font-bold uppercase"
                  style={{
                    color:
                      i <= step ? PLUM : "#9CA3AF",
                  }}
                >
                  {l.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>

          <div className="w-full min-h-0 pointer-events-auto bg-white rounded-[2rem] px-5 py-6 sm:p-8 shadow-[0_16px_48px_-12px_rgba(84,34,105,0.08)] border border-[#E8D5E8]/50 overflow-y-auto">
            {/* STEP 0 */}
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <h2
                    className="text-[22px] font-black"
                    style={{ color: PLUM }}
                  >
                    Who are you?
                  </h2>

                  <p className="text-sm text-[#9B6FAB]">
                    Choose how you'll use CareScribe
                  </p>
                </div>

                {TYPES.map((t) => {
                  const sel =
                    form.account_type === t.value;

                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() =>
                        updateField(
                          "account_type",
                          t.value
                        )
                      }
                      className="w-full text-left p-4 rounded-2xl border-2 transition-all"
                      style={{
                        borderColor: sel
                          ? t.dot
                          : BORDER,
                        background: sel
                          ? `${t.dot}10`
                          : "white",
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-1.5 h-3 w-3 rounded-full"
                          style={{
                            background: sel
                              ? t.dot
                              : BORDER,
                          }}
                        />

                        <div className="flex-1">
                          <p className="font-black">
                            {t.title}
                          </p>

                          <p className="text-sm text-[#7A6A9E]">
                            {t.sub}
                          </p>
                        </div>

                        {sel && (
                          <CheckCircle2
                            size={18}
                            style={{
                              color: t.dot,
                            }}
                          />
                        )}
                      </div>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={!form.account_type}
                  className="w-full h-12 rounded-xl text-white font-black disabled:opacity-40"
                  style={{
                    background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
                  }}
                >
                  Continue
                </button>
              </div>
            )}

            {/* STEP 1 */}
            {step === 1 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();

                  if (step1Valid()) {
                    setStep(2);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <h2
                    className="text-[22px] font-black"
                    style={{ color: PLUM }}
                  >
                    Create account
                  </h2>

                  <p className="text-sm text-[#9B6FAB]">
                    You'll use these to sign in
                  </p>
                </div>

                <div>
                  <Label>Full name</Label>

                  <StyledInput
                    name="full_name"
                    value={form.full_name}
                    onChange={(v) =>
                      updateField(
                        "full_name",
                        v
                      )
                    }
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
                    onChange={(v) =>
                      updateField("email", v)
                    }
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <Label>Password</Label>

                  <div className="relative">
                    <StyledInput
                      name="password"
                      type={
                        showPass
                          ? "text"
                          : "password"
                      }
                      value={form.password}
                      onChange={(v) =>
                        updateField(
                          "password",
                          v
                        )
                      }
                      placeholder="Minimum 8 characters"
                      autoComplete="new-password"
                      error={short}
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowPass(
                          (p) => !p
                        )
                      }
                      className="absolute right-4 top-1/2 -translate-y-1/2"
                    >
                      {showPass ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <Label>Confirm password</Label>

                  <StyledInput
                    name="confirm_password"
                    type="password"
                    value={form.confirm_password}
                    onChange={(v) =>
                      updateField(
                        "confirm_password",
                        v
                      )
                    }
                    placeholder="Repeat password"
                    error={mismatch}
                  />
                </div>

                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setStep(0)}
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
                      background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
                    }}
                  >
                    Continue
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <form
                onSubmit={handleSubmit}
                className="space-y-4"
              >
                {form.account_type ===
                  "independent_worker" && (
                  <IndependentWorkerFields
                    form={form}
                    updateField={updateField}
                    disabled={busy}
                  />
                )}

                {form.account_type ===
                  "allied_health" && (
                  <AlliedHealthFields
                    form={form}
                    updateField={updateField}
                    disabled={busy}
                  />
                )}

                {form.account_type ===
                  "small_provider" && (
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
                    disabled={
                      !step2Valid() || busy
                    }
                    className="flex-1 h-11 rounded-xl text-white font-black disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{
                      background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
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
              <div className="text-center py-6">
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
                  {emailVerify
                    ? "Check your email"
                    : "You're all set!"}
                </h2>

                <p className="text-[#9B6FAB] mt-2">
                  {emailVerify
                    ? `We sent a verification email to ${form.email}`
                    : "Your account is ready."}
                </p>

                <button
                  onClick={() =>
                    navigate(
                      emailVerify
                        ? "/login"
                        : "/dashboard"
                    )
                  }
                  className="mt-6 w-full h-11 rounded-xl text-white font-black"
                  style={{
                    background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
                  }}
                >
                  {emailVerify
                    ? "Go to Login"
                    : "Go to Dashboard"}
                </button>
              </div>
            )}
          </div>

          {/* Sign-in nav — visible on all steps except the success screen */}
          {step < 3 && (
            <p
              className="text-center text-[13px] font-medium mt-5 pb-1"
              style={{ color: "#7A6A9E" }}
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
    if (form.sp_provider_type)       base.provider_type       = form.sp_provider_type;
    if (form.sp_registration_status) base.registration_status = form.sp_registration_status;
    if (form.sp_team_size)           base.team_size           = form.sp_team_size;
    if (form.sp_participant_volume)  base.participant_volume  = form.sp_participant_volume;
    if (form.sp_contact_number)      base.contact_number      = form.sp_contact_number;
  } else if (form.account_type === "independent_worker") {
    base.onboarding_data = {
      registration_status:  form.iw_registration_status,
      support_specialties:  form.iw_support_specialties,
      years_experience:     form.iw_years_experience,
      mobile:               form.iw_mobile,
    };
  } else if (form.account_type === "allied_health") {
    base.onboarding_data = {
      profession_type:      form.ah_profession_type,
      registration_status:  form.ah_registration_status,
      provider_number:      form.ah_provider_number,
      specialties:          form.ah_specialties,
      clinic_name:          form.ah_clinic_name,
    };
  }

  return base;
}

// ── Independent Worker ────────────────────────────────────────────────────────
function IndependentWorkerFields({
  form,
  updateField,
  disabled,
}: any) {
  return (
    <>
      <div>
        <Label>Registration status</Label>

        <StyledSelect
          name="iw_registration_status"
          value={form.iw_registration_status}
          onChange={(v) =>
            updateField(
              "iw_registration_status",
              v
            )
          }
          placeholder="Select status..."
          disabled={disabled}
          options={[
            {
              value: "registered_ndis",
              label: "Registered NDIS Provider",
            },
            {
              value: "unregistered",
              label: "Unregistered Provider",
            },
          ]}
        />
      </div>

      <div>
        <Label>Support specialties</Label>

        <StyledSelect
          name="iw_support_specialties"
          value={form.iw_support_specialties}
          onChange={(v) =>
            updateField("iw_support_specialties", v)
          }
          placeholder="Select specialty..."
          disabled={disabled}
          required={false}
          options={[
            { value: "community_access",      label: "Community Access" },
            { value: "personal_care",         label: "Personal Care" },
            { value: "daily_living",          label: "Daily Living Activities" },
            { value: "social_participation",  label: "Social & Civic Participation" },
            { value: "skill_development",     label: "Skill Development" },
            { value: "transport",             label: "Transport" },
          ]}
        />
      </div>

      <div>
        <Label>Years of experience</Label>

        <StyledSelect
          name="iw_years_experience"
          value={form.iw_years_experience}
          onChange={(v) =>
            updateField("iw_years_experience", v)
          }
          placeholder="Select range..."
          disabled={disabled}
          required={false}
          options={[
            { value: "less_than_1", label: "Less than 1 year" },
            { value: "1_3",         label: "1–3 years" },
            { value: "3_5",         label: "3–5 years" },
            { value: "5_plus",      label: "5+ years" },
          ]}
        />
      </div>

      <div>
        <Label>Mobile number</Label>

        <StyledInput
          name="iw_mobile"
          value={form.iw_mobile}
          onChange={(v) =>
            updateField("iw_mobile", v)
          }
          placeholder="04xx xxx xxx"
          disabled={disabled}
        />
      </div>
    </>
  );
}

// ── Allied Health ─────────────────────────────────────────────────────────────
function AlliedHealthFields({
  form,
  updateField,
  disabled,
}: any) {
  return (
    <>
      <div>
        <Label>Profession</Label>

        <StyledSelect
          name="ah_profession_type"
          value={form.ah_profession_type}
          onChange={(v) =>
            updateField("ah_profession_type", v)
          }
          placeholder="Select profession..."
          disabled={disabled}
          options={[
            { value: "occupational_therapist",  label: "Occupational Therapist" },
            { value: "speech_pathologist",       label: "Speech Pathologist" },
            { value: "physiotherapist",          label: "Physiotherapist" },
            { value: "behaviour_support",        label: "Behaviour Support Practitioner" },
            { value: "social_worker",            label: "Social Worker" },
            { value: "psychologist",             label: "Psychologist" },
          ]}
        />
      </div>

      <div>
        <Label>Registration status</Label>

        <StyledSelect
          name="ah_registration_status"
          value={form.ah_registration_status}
          onChange={(v) =>
            updateField("ah_registration_status", v)
          }
          placeholder="Select status..."
          disabled={disabled}
          options={[
            { value: "ahpra_registered",  label: "AHPRA Registered" },
            { value: "ndis_registered",   label: "NDIS Registered Provider" },
            { value: "unregistered",      label: "Unregistered" },
          ]}
        />
      </div>

      <div>
        <Label>AHPRA / Provider number</Label>

        <StyledInput
          name="ah_provider_number"
          value={form.ah_provider_number}
          onChange={(v) =>
            updateField("ah_provider_number", v)
          }
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
          onChange={(v) =>
            updateField("ah_specialties", v)
          }
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
          onChange={(v) =>
            updateField("ah_clinic_name", v)
          }
          placeholder="Clinic or employer"
          disabled={disabled}
          required={false}
        />
      </div>
    </>
  );
}

// ── Small Provider ────────────────────────────────────────────────────────────
function SmallProviderFields({
  form,
  updateField,
  disabled,
}: any) {
  return (
    <>
      <div>
        <Label>Organisation Name</Label>

        <StyledInput
          name="sp_organisation_name"
          value={form.sp_organisation_name}
          onChange={(v) =>
            updateField("sp_organisation_name", v)
          }
          placeholder="Care Partners Ltd"
          disabled={disabled}
        />
      </div>

      <div>
        <Label>Provider type</Label>

        <StyledSelect
          name="sp_provider_type"
          value={form.sp_provider_type}
          onChange={(v) =>
            updateField("sp_provider_type", v)
          }
          placeholder="Select type..."
          disabled={disabled}
          required={false}
          options={[
            { value: "registered_ndis",   label: "Registered NDIS Provider" },
            { value: "unregistered",      label: "Unregistered Provider" },
            { value: "plan_management",   label: "Plan Management Provider" },
            { value: "support_coord",     label: "Support Coordination Provider" },
          ]}
        />
      </div>

      <div>
        <Label>Registration status</Label>

        <StyledSelect
          name="sp_registration_status"
          value={form.sp_registration_status}
          onChange={(v) =>
            updateField("sp_registration_status", v)
          }
          placeholder="Select status..."
          disabled={disabled}
          required={false}
          options={[
            { value: "registered",   label: "Registered with NDIS Commission" },
            { value: "unregistered", label: "Unregistered" },
            { value: "in_progress",  label: "Registration in Progress" },
          ]}
        />
      </div>

      <div>
        <Label>Team size</Label>

        <StyledSelect
          name="sp_team_size"
          value={form.sp_team_size}
          onChange={(v) =>
            updateField("sp_team_size", v)
          }
          placeholder="Select size..."
          disabled={disabled}
          required={false}
          options={[
            { value: "1_5",     label: "1–5 staff" },
            { value: "5_20",    label: "5–20 staff" },
            { value: "20_plus", label: "20+ staff" },
          ]}
        />
      </div>

      <div>
        <Label>Active participant volume</Label>

        <StyledSelect
          name="sp_participant_volume"
          value={form.sp_participant_volume}
          onChange={(v) =>
            updateField("sp_participant_volume", v)
          }
          placeholder="Approx. number of participants..."
          disabled={disabled}
          required={false}
          options={[
            { value: "1_10",    label: "1–10 participants" },
            { value: "10_50",   label: "10–50 participants" },
            { value: "50_plus", label: "50+ participants" },
          ]}
        />
      </div>

      <div>
        <Label>Contact number</Label>

        <StyledInput
          name="sp_contact_number"
          value={form.sp_contact_number}
          onChange={(v) =>
            updateField("sp_contact_number", v)
          }
          placeholder="02 xxxx xxxx"
          disabled={disabled}
          required={false}
        />
      </div>
    </>
  );
}