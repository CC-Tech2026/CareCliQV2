import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth, type AccountType } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  User,
  Stethoscope,
  Building2,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  PenLine,
} from "lucide-react";

// ── CareScribe palette ────────────────────────────────────────────────────────
const PLUM    = "#542269";
const CORAL   = "#F1738A";
const BLUSH   = "#F6B8C0";
const PURPLE  = "#DEB2E4";
const BORDER  = "#E8D5E8";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

const INITIAL_FORM: FormData = {
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

// ---------------------------------------------------------------------------
// Account type cards
// ---------------------------------------------------------------------------

const ACCOUNT_TYPES = [
  {
    value: "independent_worker" as AccountType,
    icon: User,
    title: "Independent Support Worker",
    subtitle: "Sole trader, unregistered provider, or independent disability support worker",
    selectedBg: "rgba(246,184,192,0.18)",
    selectedBorder: BLUSH,
    iconBgSelected: "rgba(241,115,138,0.22)",
    iconColorSelected: CORAL,
  },
  {
    value: "allied_health" as AccountType,
    icon: Stethoscope,
    title: "Allied Health Professional",
    subtitle: "OT, Speech Pathologist, Physiotherapist, Behaviour Support Practitioner",
    selectedBg: "rgba(222,178,228,0.18)",
    selectedBorder: PURPLE,
    iconBgSelected: "rgba(222,178,228,0.25)",
    iconColorSelected: PURPLE,
  },
  {
    value: "small_provider" as AccountType,
    icon: Building2,
    title: "Small Provider / Care Team",
    subtitle: "Small care company, growing provider team, or NDIS provider organisation",
    selectedBg: "rgba(84,34,105,0.18)",
    selectedBorder: "rgba(222,178,228,0.6)",
    iconBgSelected: "rgba(84,34,105,0.22)",
    iconColorSelected: PURPLE,
  },
] as const;

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

function Logo() {
  return (
    <div className="flex flex-col items-center gap-2 mb-8">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
          boxShadow: `0 6px 20px rgba(241,115,138,0.35)`,
        }}
      >
        <PenLine size={22} color="white" strokeWidth={2.3} />
      </div>
      <span className="text-xl font-bold text-white tracking-tight">CareScribe</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1.5 flex-1 rounded-full transition-all duration-300"
          style={{
            background: i < current ? CORAL : i === current ? BLUSH : "rgba(255,255,255,0.2)",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium flex gap-0.5" style={{ color: "#37352F" }}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs" style={{ color: "#9B6FAB" }}>{hint}</p>}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full h-11 px-3 rounded-xl text-sm bg-white disabled:opacity-50 outline-none"
      style={{ border: `1px solid ${BORDER}`, color: "#37352F" }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Signup() {
  const { login, updateUser } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

  const set = (field: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // ── Step 0: choose account type ──────────────────────────────────────────

  function renderStep0() {
    return (
      <div className="space-y-4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">Welcome to CareScribe</h1>
          <p className="text-sm mt-1" style={{ color: PURPLE }}>Choose how you'll be using the platform</p>
        </div>

        <div className="space-y-3">
          {ACCOUNT_TYPES.map((type) => {
            const Icon = type.icon;
            const selected = form.account_type === type.value;
            return (
              <button
                key={type.value}
                onClick={() => set("account_type", type.value)}
                className="w-full text-left p-4 rounded-2xl border-2 transition-all duration-150 active:scale-[0.99]"
                style={{
                  background: selected ? type.selectedBg : "rgba(255,255,255,0.06)",
                  borderColor: selected ? type.selectedBorder : "rgba(255,255,255,0.12)",
                }}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background: selected ? type.iconBgSelected : "rgba(255,255,255,0.10)",
                      color: selected ? type.iconColorSelected : "rgba(255,255,255,0.5)",
                    }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-tight" style={{ color: selected ? "white" : "rgba(255,255,255,0.75)" }}>
                      {type.title}
                    </p>
                    <p className="text-xs mt-1 leading-snug" style={{ color: selected ? PURPLE : "rgba(255,255,255,0.35)" }}>
                      {type.subtitle}
                    </p>
                  </div>
                  {selected && (
                    <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" style={{ color: BLUSH }} />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <Button
          onClick={() => setStep(1)}
          disabled={!form.account_type}
          className="w-full h-12 font-semibold rounded-xl gap-2 mt-2 text-white border-0 hover:opacity-90 transition-opacity"
          style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
        >
          Continue <ArrowRight className="h-4 w-4" />
        </Button>

        <p className="text-center text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
          Already have an account?{" "}
          <button
            onClick={() => navigate("/login")}
            className="font-medium hover:underline"
            style={{ color: BLUSH }}
          >
            Sign in
          </button>
        </p>
      </div>
    );
  }

  // ── Step 1: create account ───────────────────────────────────────────────

  function step1Valid() {
    if (!form.full_name.trim() || !form.email.trim() || !form.password) return false;
    if (form.password.length < 8) return false;
    if (form.password !== form.confirm_password) return false;
    return true;
  }

  function renderStep1() {
    const passwordMismatch = form.confirm_password && form.password !== form.confirm_password;
    const passwordShort = form.password && form.password.length < 8;

    return (
      <div className="space-y-4">
        <div className="mb-2">
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="text-sm mt-1" style={{ color: PURPLE }}>You'll use these to sign in every time</p>
        </div>

        <div className="bg-white rounded-2xl p-5 space-y-4" style={{ boxShadow: `0 8px 32px rgba(84,34,105,0.20)` }}>
          <Field label="Full name" required>
            <Input
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="Jane Smith"
              className="h-11 rounded-xl"
              style={{ borderColor: BORDER }}
              autoComplete="name"
            />
          </Field>

          <Field label="Email address" required>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="you@example.com"
              className="h-11 rounded-xl"
              style={{ borderColor: BORDER }}
              autoComplete="email"
            />
          </Field>

          <Field label="Password" required hint={form.password && !passwordShort ? "" : "Minimum 8 characters"}>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="Min. 8 characters"
                className={cn("h-11 rounded-xl pr-10", passwordShort && "border-red-400")}
                style={{ borderColor: passwordShort ? undefined : BORDER }}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: PURPLE }}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <Field label="Confirm password" required>
            <Input
              type="password"
              value={form.confirm_password}
              onChange={(e) => set("confirm_password", e.target.value)}
              placeholder="Repeat your password"
              className={cn("h-11 rounded-xl", passwordMismatch && "border-red-400")}
              style={{ borderColor: passwordMismatch ? undefined : BORDER }}
              autoComplete="new-password"
            />
            {passwordMismatch && (
              <p className="text-xs text-red-500 mt-1">Passwords don't match</p>
            )}
          </Field>
        </div>

        <div className="flex gap-3">
          <Button
            variant="ghost"
            onClick={() => setStep(0)}
            className="gap-1.5 hover:bg-white/10"
            style={{ color: PURPLE }}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button
            onClick={() => setStep(2)}
            disabled={!step1Valid()}
            className="flex-1 h-12 font-semibold rounded-xl gap-2 text-white border-0 hover:opacity-90 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
          >
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 2: professional details ─────────────────────────────────────────

  function renderStep2() {
    return (
      <div className="space-y-4">
        <div className="mb-2">
          <h1 className="text-2xl font-bold text-white">Your professional details</h1>
          <p className="text-sm mt-1" style={{ color: PURPLE }}>Help us tailor CareScribe to your practice</p>
        </div>

        <div className="bg-white rounded-2xl p-5 space-y-4" style={{ boxShadow: `0 8px 32px rgba(84,34,105,0.20)` }}>
          {form.account_type === "independent_worker" && <IndependentWorkerFields form={form} set={set} submitting={submitting} />}
          {form.account_type === "allied_health" && <AlliedHealthFields form={form} set={set} submitting={submitting} />}
          {form.account_type === "small_provider" && <SmallProviderFields form={form} set={set} submitting={submitting} />}
        </div>

        <div className="flex gap-3">
          <Button
            variant="ghost"
            onClick={() => setStep(1)}
            disabled={submitting}
            className="gap-1.5 hover:bg-white/10"
            style={{ color: PURPLE }}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || (form.account_type === "small_provider" && !form.sp_organisation_name.trim())}
            className="flex-1 h-12 font-semibold rounded-xl gap-2 text-white border-0 hover:opacity-90 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Setting up…
              </>
            ) : (
              <>Complete Setup <ArrowRight className="h-4 w-4" /></>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 3: success / email verification ─────────────────────────────────

  function renderStep3() {
    if (emailVerificationRequired) {
      return (
        <div className="text-center space-y-4">
          <div
            className="h-20 w-20 rounded-full flex items-center justify-center mx-auto"
            style={{ background: "rgba(222,178,228,0.2)" }}
          >
            <svg className="h-10 w-10" style={{ color: BLUSH }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Check your email</h1>
            <p className="text-sm mt-2 max-w-xs mx-auto" style={{ color: PURPLE }}>
              We've sent a verification link to{" "}
              <span className="text-white font-medium">{form.email}</span>.
              Click the link to activate your account, then sign in.
            </p>
          </div>
          <Button
            onClick={() => navigate("/login")}
            className="w-full h-12 font-semibold rounded-xl text-white border-0 hover:opacity-90 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
          >
            Go to Sign In
          </Button>
        </div>
      );
    }

    return (
      <div className="text-center space-y-5">
        <div
          className="h-20 w-20 rounded-full flex items-center justify-center mx-auto"
          style={{ background: "rgba(246,184,192,0.2)" }}
        >
          <CheckCircle2 className="h-10 w-10" style={{ color: BLUSH }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">You're all set!</h1>
          <p className="text-sm mt-2" style={{ color: PURPLE }}>
            Welcome to CareScribe,{" "}
            <span className="text-white font-semibold">{form.full_name.split(" ")[0]}</span>.
            Your account is ready.
          </p>
        </div>
        <Button
          onClick={() => navigate("/dashboard")}
          className="w-full h-12 font-semibold rounded-xl text-white border-0 hover:opacity-90 transition-opacity"
          style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
        >
          Go to Dashboard
        </Button>
      </div>
    );
  }

  // ── Submit handler ───────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const regRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          account_type: form.account_type,
        }),
      });
      if (!regRes.ok) {
        const err = await regRes.json().catch(() => ({ detail: "Registration failed" }));
        throw new Error(err.detail || "Registration failed");
      }

      let token: string | null = null;
      try {
        const authUser = await login(form.email, form.password);
        token = authUser ? localStorage.getItem("carescribe_token") : null;
      } catch (loginErr) {
        const msg = loginErr instanceof Error ? loginErr.message.toLowerCase() : "";
        if (msg.includes("verify") || msg.includes("email") || msg.includes("confirmed")) {
          setEmailVerificationRequired(true);
          setStep(3);
          return;
        }
        toast({ title: "Account created", description: "Please sign in with your new credentials." });
        navigate("/login");
        return;
      }

      if (token) {
        try {
          const onboardingPayload = buildOnboardingPayload(form);
          await fetch("/api/auth/complete-onboarding", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(onboardingPayload),
          });
          updateUser({ onboarding_complete: true });
        } catch (e) {
          console.warn("Onboarding save failed", e);
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
      setSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const TOTAL_STEPS = 3;

  return (
    <div
      className="min-h-screen px-4 py-10 flex flex-col items-center"
      style={{ background: `linear-gradient(160deg, ${PLUM} 0%, #3D1855 55%, #2A1040 100%)` }}
    >
      <div className="w-full max-w-sm">
        <Logo />
        {step < TOTAL_STEPS && <StepIndicator current={step} total={TOTAL_STEPS} />}
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding payload builder
// ---------------------------------------------------------------------------

function buildOnboardingPayload(form: FormData) {
  const base = { account_type: form.account_type };

  if (form.account_type === "independent_worker") {
    return {
      ...base,
      onboarding_data: {
        registration_status: form.iw_registration_status,
        support_specialties: form.iw_support_specialties,
        years_experience: form.iw_years_experience,
        mobile_number: form.iw_mobile,
      },
    };
  }

  if (form.account_type === "allied_health") {
    return {
      ...base,
      onboarding_data: {
        profession_type: form.ah_profession_type,
        registration_status: form.ah_registration_status,
        provider_number: form.ah_provider_number,
        specialties: form.ah_specialties,
        clinic_name: form.ah_clinic_name,
      },
    };
  }

  if (form.account_type === "small_provider") {
    return {
      ...base,
      organization_name: form.sp_organisation_name,
      provider_type: form.sp_provider_type,
      registration_status: form.sp_registration_status,
      team_size: form.sp_team_size,
      participant_volume: form.sp_participant_volume,
      contact_number: form.sp_contact_number,
      onboarding_data: {
        provider_type: form.sp_provider_type,
        team_size: form.sp_team_size,
        participant_volume: form.sp_participant_volume,
      },
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Account-type-specific detail forms
// ---------------------------------------------------------------------------

function IndependentWorkerFields({
  form,
  set,
  submitting,
}: {
  form: FormData;
  set: (f: keyof FormData, v: string) => void;
  submitting: boolean;
}) {
  return (
    <>
      <Field label="Registration status" required>
        <SelectField
          value={form.iw_registration_status}
          onChange={(v) => set("iw_registration_status", v)}
          placeholder="Select your status…"
          disabled={submitting}
          options={[
            { value: "registered_ndis", label: "Registered NDIS Provider" },
            { value: "unregistered", label: "Unregistered Provider" },
            { value: "sole_trader", label: "Sole Trader" },
            { value: "employee", label: "Employee of a Provider" },
          ]}
        />
      </Field>
      <Field label="Types of support you provide" hint="e.g. Personal care, Community access, Life skills">
        <Input
          value={form.iw_support_specialties}
          onChange={(e) => set("iw_support_specialties", e.target.value)}
          placeholder="Personal care, Community access…"
          disabled={submitting}
          className="h-11 rounded-xl"
          style={{ borderColor: BORDER }}
        />
      </Field>
      <Field label="Years of experience" hint="Optional">
        <SelectField
          value={form.iw_years_experience}
          onChange={(v) => set("iw_years_experience", v)}
          placeholder="Select (optional)…"
          disabled={submitting}
          options={[
            { value: "less_than_1", label: "Less than 1 year" },
            { value: "1_to_3", label: "1–3 years" },
            { value: "3_to_5", label: "3–5 years" },
            { value: "5_to_10", label: "5–10 years" },
            { value: "10_plus", label: "10+ years" },
          ]}
        />
      </Field>
      <Field label="Mobile number" hint="For contact and scheduling">
        <Input
          type="tel"
          value={form.iw_mobile}
          onChange={(e) => set("iw_mobile", e.target.value)}
          placeholder="04xx xxx xxx"
          disabled={submitting}
          className="h-11 rounded-xl"
          style={{ borderColor: BORDER }}
        />
      </Field>
    </>
  );
}

function AlliedHealthFields({
  form,
  set,
  submitting,
}: {
  form: FormData;
  set: (f: keyof FormData, v: string) => void;
  submitting: boolean;
}) {
  return (
    <>
      <Field label="Profession" required>
        <SelectField
          value={form.ah_profession_type}
          onChange={(v) => set("ah_profession_type", v)}
          placeholder="Select your profession…"
          disabled={submitting}
          options={[
            { value: "occupational_therapist", label: "Occupational Therapist" },
            { value: "speech_pathologist", label: "Speech Pathologist" },
            { value: "physiotherapist", label: "Physiotherapist" },
            { value: "behaviour_support", label: "Behaviour Support Practitioner" },
            { value: "psychologist", label: "Psychologist" },
            { value: "social_worker", label: "Social Worker" },
            { value: "other", label: "Other Allied Health" },
          ]}
        />
      </Field>
      <Field label="Registration status" required>
        <SelectField
          value={form.ah_registration_status}
          onChange={(v) => set("ah_registration_status", v)}
          placeholder="Select your status…"
          disabled={submitting}
          options={[
            { value: "ahpra_registered", label: "AHPRA Registered" },
            { value: "aasw", label: "AASW Member" },
            { value: "unregistered", label: "Unregistered Practitioner" },
            { value: "student", label: "Student / Provisional" },
          ]}
        />
      </Field>
      <Field label="Provider number" hint="NDIS or Medicare provider number (optional)">
        <Input
          value={form.ah_provider_number}
          onChange={(e) => set("ah_provider_number", e.target.value)}
          placeholder="e.g. 2123456A"
          disabled={submitting}
          className="h-11 rounded-xl"
          style={{ borderColor: BORDER }}
        />
      </Field>
      <Field label="Areas of speciality" hint="Optional — e.g. Autism, TBI, Mental health">
        <Input
          value={form.ah_specialties}
          onChange={(e) => set("ah_specialties", e.target.value)}
          placeholder="Autism, TBI, Mental health…"
          disabled={submitting}
          className="h-11 rounded-xl"
          style={{ borderColor: BORDER }}
        />
      </Field>
      <Field label="Clinic or practice name" hint="Optional">
        <Input
          value={form.ah_clinic_name}
          onChange={(e) => set("ah_clinic_name", e.target.value)}
          placeholder="Your practice name"
          disabled={submitting}
          className="h-11 rounded-xl"
          style={{ borderColor: BORDER }}
        />
      </Field>
    </>
  );
}

function SmallProviderFields({
  form,
  set,
  submitting,
}: {
  form: FormData;
  set: (f: keyof FormData, v: string) => void;
  submitting: boolean;
}) {
  return (
    <>
      <Field label="Organisation name" required>
        <Input
          value={form.sp_organisation_name}
          onChange={(e) => set("sp_organisation_name", e.target.value)}
          placeholder="Your organisation name"
          disabled={submitting}
          className="h-11 rounded-xl"
          style={{ borderColor: BORDER }}
        />
      </Field>
      <Field label="Organisation type" required>
        <SelectField
          value={form.sp_provider_type}
          onChange={(v) => set("sp_provider_type", v)}
          placeholder="Select type…"
          disabled={submitting}
          options={[
            { value: "registered_ndis", label: "Registered NDIS Provider" },
            { value: "unregistered", label: "Unregistered Provider" },
            { value: "allied_health_practice", label: "Allied Health Practice" },
            { value: "support_coordination", label: "Support Coordination Agency" },
            { value: "mixed", label: "Mixed Services" },
          ]}
        />
      </Field>
      <Field label="Registration status">
        <SelectField
          value={form.sp_registration_status}
          onChange={(v) => set("sp_registration_status", v)}
          placeholder="Select status…"
          disabled={submitting}
          options={[
            { value: "registered", label: "NDIS Registered" },
            { value: "unregistered", label: "Unregistered" },
            { value: "in_progress", label: "Registration In Progress" },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Team size" required>
          <SelectField
            value={form.sp_team_size}
            onChange={(v) => set("sp_team_size", v)}
            placeholder="Size…"
            disabled={submitting}
            options={[
              { value: "solo", label: "Solo" },
              { value: "2_5", label: "2–5 staff" },
              { value: "6_15", label: "6–15 staff" },
              { value: "15_plus", label: "15+ staff" },
            ]}
          />
        </Field>
        <Field label="Participants" required>
          <SelectField
            value={form.sp_participant_volume}
            onChange={(v) => set("sp_participant_volume", v)}
            placeholder="Count…"
            disabled={submitting}
            options={[
              { value: "1_10", label: "1–10" },
              { value: "11_50", label: "11–50" },
              { value: "51_200", label: "51–200" },
              { value: "200_plus", label: "200+" },
            ]}
          />
        </Field>
      </div>
      <Field label="Contact number">
        <Input
          type="tel"
          value={form.sp_contact_number}
          onChange={(e) => set("sp_contact_number", e.target.value)}
          placeholder="Organisation phone"
          disabled={submitting}
          className="h-11 rounded-xl"
          style={{ borderColor: BORDER }}
        />
      </Field>
    </>
  );
}
