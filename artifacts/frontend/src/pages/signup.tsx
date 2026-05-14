import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth, type AccountType } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";

// ── Palette ──────────────────────────────────────────────────────────────────
const PLUM   = "#542269";
const CORAL  = "#F1738A";
const BLUSH  = "#F6B8C0";
const PURPLE = "#DEB2E4";
const BORDER = "#E8D5E8";
const BG     = "#FAF5FA";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FormData {
  account_type: AccountType | "";
  full_name: string; email: string; password: string; confirm_password: string;
  iw_registration_status: string; iw_support_specialties: string;
  iw_years_experience: string; iw_mobile: string;
  ah_profession_type: string; ah_registration_status: string;
  ah_provider_number: string; ah_specialties: string; ah_clinic_name: string;
  sp_organisation_name: string; sp_provider_type: string;
  sp_registration_status: string; sp_team_size: string;
  sp_participant_volume: string; sp_contact_number: string;
}

const EMPTY: FormData = {
  account_type: "", full_name: "", email: "", password: "", confirm_password: "",
  iw_registration_status: "", iw_support_specialties: "", iw_years_experience: "", iw_mobile: "",
  ah_profession_type: "", ah_registration_status: "", ah_provider_number: "", ah_specialties: "", ah_clinic_name: "",
  sp_organisation_name: "", sp_provider_type: "", sp_registration_status: "",
  sp_team_size: "", sp_participant_volume: "", sp_contact_number: "",
};

// ── Small reusable pieces ─────────────────────────────────────────────────────

function StyledInput({ type = "text", value, onChange, placeholder, disabled, autoComplete, error }: {
  type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; autoComplete?: string; error?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      required
      className="w-full h-12 px-4 rounded-2xl text-[14px] outline-none transition-all"
      style={{
        background: BG,
        border: `1.5px solid ${error ? "#EF4444" : focused ? CORAL : BORDER}`,
        color: "#37352F",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function StyledSelect({ value, onChange, options, placeholder, disabled }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string; disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="w-full h-12 px-4 rounded-2xl text-[14px] outline-none"
      style={{ background: BG, border: `1.5px solid ${BORDER}`, color: "#37352F" }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: PLUM }}>
      {children}
    </p>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-0">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] mt-1" style={{ color: "#B08EC0" }}>{hint}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Signup() {
  const { login, updateUser } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailVerify, setEmailVerify] = useState(false);

  const set = (f: keyof FormData, v: string) => setForm(p => ({ ...p, [f]: v }));

  // Step labels
  const STEP_LABELS = ["Account Type", "Your Details", "Practice Info"];
  const TOTAL = 3;

  // ── Top gradient area
  function TopArea() {
    return (
      <div
        className="flex flex-col items-center justify-end pb-8 pt-14 px-6 text-center text-white flex-[0_0_auto]"
        style={{
          background: `linear-gradient(155deg, ${CORAL} 0%, ${PLUM} 100%)`,
          minHeight: 180,
        }}
      >
        <h1 className="text-[30px] font-black tracking-tight leading-none">
          Care<span style={{ color: "#FBD0DA" }}>Scribe</span>
        </h1>
        {step < TOTAL && (
          <div className="mt-5 w-full max-w-xs">
            {/* Step pills */}
            <div className="flex gap-2 justify-center">
              {STEP_LABELS.map((l, i) => (
                <div
                  key={l}
                  className="flex-1 h-1.5 rounded-full transition-all duration-300"
                  style={{ background: i <= step ? "white" : "rgba(255,255,255,0.3)" }}
                />
              ))}
            </div>
            <p className="text-[11px] uppercase tracking-widest mt-2 opacity-50 font-semibold">
              Step {step + 1} of {TOTAL} · {STEP_LABELS[step]}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Step 0: account type ────────────────────────────────────────────────────
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
      dot: PURPLE,
    },
    {
      value: "small_provider" as AccountType,
      title: "Small Provider / Care Team",
      sub: "Small care company or NDIS provider organisation",
      dot: PLUM,
    },
  ] as const;

  function Step0() {
    return (
      <div className="space-y-4">
        <div className="mb-5">
          <h2 className="text-[22px] font-black" style={{ color: PLUM }}>Who are you?</h2>
          <p className="text-[13px] mt-0.5" style={{ color: "#9B6FAB" }}>Choose how you'll use CareScribe</p>
        </div>

        {TYPES.map(t => {
          const sel = form.account_type === t.value;
          return (
            <button
              key={t.value}
              onClick={() => set("account_type", t.value)}
              className="w-full text-left p-4 rounded-2xl border-2 transition-all"
              style={{
                borderColor: sel ? t.dot : BORDER,
                background: sel ? `${t.dot}10` : "white",
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-1 h-3 w-3 rounded-full shrink-0"
                  style={{ background: sel ? t.dot : BORDER }}
                />
                <div className="flex-1">
                  <p className="text-[14px] font-bold" style={{ color: sel ? PLUM : "#37352F" }}>{t.title}</p>
                  <p className="text-[12px] mt-0.5 leading-snug" style={{ color: "#9B6FAB" }}>{t.sub}</p>
                </div>
                {sel && <CheckCircle2 size={18} style={{ color: t.dot, marginTop: 2 }} />}
              </div>
            </button>
          );
        })}

        <button
          onClick={() => setStep(1)}
          disabled={!form.account_type}
          className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 mt-2 transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
        >
          Continue <ArrowRight size={16} />
        </button>

        <p className="text-center text-[13px]" style={{ color: "#B08EC0" }}>
          Already have an account?{" "}
          <button onClick={() => navigate("/login")} className="font-bold" style={{ color: CORAL }}>
            Sign in
          </button>
        </p>
      </div>
    );
  }

  // ── Step 1: account details ──────────────────────────────────────────────────
  function step1Valid() {
    return form.full_name.trim() && form.email.trim() && form.password.length >= 8 && form.password === form.confirm_password;
  }

  function Step1() {
    const mismatch = !!form.confirm_password && form.password !== form.confirm_password;
    const short = !!form.password && form.password.length < 8;
    return (
      <div className="space-y-4">
        <div className="mb-3">
          <h2 className="text-[22px] font-black" style={{ color: PLUM }}>Create account</h2>
          <p className="text-[13px] mt-0.5" style={{ color: "#9B6FAB" }}>You'll use these to sign in every time</p>
        </div>

        <Field label="Full name">
          <StyledInput value={form.full_name} onChange={v => set("full_name", v)} placeholder="Jane Smith" autoComplete="name" disabled={busy} />
        </Field>
        <Field label="Email address">
          <StyledInput type="email" value={form.email} onChange={v => set("email", v)} placeholder="you@example.com" autoComplete="email" disabled={busy} />
        </Field>
        <Field label="Password" hint={short ? "Minimum 8 characters" : ""}>
          <div className="relative">
            <StyledInput type={showPass ? "text" : "password"} value={form.password} onChange={v => set("password", v)} placeholder="Min. 8 characters" autoComplete="new-password" disabled={busy} error={short} />
            <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2" style={{ color: PURPLE }}>
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
        <Field label="Confirm password">
          <StyledInput type="password" value={form.confirm_password} onChange={v => set("confirm_password", v)} placeholder="Repeat password" autoComplete="new-password" disabled={busy} error={mismatch} />
          {mismatch && <p className="text-[11px] text-red-500 mt-1">Passwords don't match</p>}
        </Field>

        <div className="flex gap-3 pt-1">
          <button onClick={() => setStep(0)} className="flex items-center gap-1 px-4 py-3 rounded-2xl text-[14px] font-bold" style={{ color: PLUM, background: "#FAF5FA", border: `1.5px solid ${BORDER}` }}>
            <ArrowLeft size={15} /> Back
          </button>
          <button
            onClick={() => setStep(2)}
            disabled={!step1Valid()}
            className="flex-1 h-12 rounded-2xl text-white text-[14px] font-black flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: professional details ─────────────────────────────────────────────
  function Step2() {
    return (
      <div className="space-y-4">
        <div className="mb-3">
          <h2 className="text-[22px] font-black" style={{ color: PLUM }}>Practice details</h2>
          <p className="text-[13px] mt-0.5" style={{ color: "#9B6FAB" }}>Help us tailor CareScribe for you</p>
        </div>

        {form.account_type === "independent_worker" && <IndependentWorkerFields form={form} set={set} disabled={busy} />}
        {form.account_type === "allied_health" && <AlliedHealthFields form={form} set={set} disabled={busy} />}
        {form.account_type === "small_provider" && <SmallProviderFields form={form} set={set} disabled={busy} />}

        <div className="flex gap-3 pt-1">
          <button onClick={() => setStep(1)} disabled={busy} className="flex items-center gap-1 px-4 py-3 rounded-2xl text-[14px] font-bold" style={{ color: PLUM, background: "#FAF5FA", border: `1.5px solid ${BORDER}` }}>
            <ArrowLeft size={15} /> Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || (form.account_type === "small_provider" && !form.sp_organisation_name.trim())}
            className="flex-1 h-12 rounded-2xl text-white text-[14px] font-black flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
          >
            {busy ? <><Loader2 size={16} className="animate-spin" /> Setting up…</> : <>Complete Setup <ArrowRight size={15} /></>}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: success / verify ─────────────────────────────────────────────────
  function Step3() {
    if (emailVerify) {
      return (
        <div className="text-center space-y-5 py-4">
          <div className="h-20 w-20 rounded-full flex items-center justify-center mx-auto" style={{ background: `${BLUSH}30` }}>
            <svg className="h-10 w-10" style={{ color: CORAL }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-[22px] font-black" style={{ color: PLUM }}>Check your email</h2>
            <p className="text-[13px] mt-2 max-w-xs mx-auto" style={{ color: "#9B6FAB" }}>
              We sent a link to <span className="font-bold" style={{ color: PLUM }}>{form.email}</span>. Click it to activate your account.
            </p>
          </div>
          <button onClick={() => navigate("/login")} className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-opacity hover:opacity-90" style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}>
            Go to Sign In <ArrowRight size={16} />
          </button>
        </div>
      );
    }
    return (
      <div className="text-center space-y-5 py-4">
        <div className="h-20 w-20 rounded-full flex items-center justify-center mx-auto" style={{ background: `${BLUSH}30` }}>
          <CheckCircle2 size={40} style={{ color: CORAL }} />
        </div>
        <div>
          <h2 className="text-[22px] font-black" style={{ color: PLUM }}>You're all set!</h2>
          <p className="text-[13px] mt-2" style={{ color: "#9B6FAB" }}>
            Welcome, <span className="font-bold" style={{ color: PLUM }}>{form.full_name.split(" ")[0]}</span>. Your account is ready.
          </p>
        </div>
        <button onClick={() => navigate("/dashboard")} className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-opacity hover:opacity-90" style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}>
          Go to Dashboard <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password, full_name: form.full_name, account_type: form.account_type }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Registration failed" }));
        throw new Error(err.detail || "Registration failed");
      }

      let token: string | null = null;
      try {
        const u = await login(form.email, form.password);
        token = u ? localStorage.getItem("carescribe_token") : null;
      } catch (loginErr) {
        const msg = loginErr instanceof Error ? loginErr.message.toLowerCase() : "";
        if (msg.includes("verify") || msg.includes("email") || msg.includes("confirmed")) {
          setEmailVerify(true); setStep(3); return;
        }
        toast({ title: "Account created", description: "Please sign in with your new credentials." });
        navigate("/login"); return;
      }

      if (token) {
        try {
          await fetch("/api/auth/complete-onboarding", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(buildPayload(form)),
          });
          updateUser({ onboarding_complete: true });
        } catch { /* non-fatal */ }
      }
      setStep(3);
    } catch (err) {
      toast({ title: "Sign up failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: `linear-gradient(155deg, ${CORAL} 0%, ${PLUM} 100%)` }}>
      <TopArea />

      {/* White bottom card */}
      <div
        className="flex-1 bg-white px-5 pt-7 pb-10 overflow-y-auto"
        style={{ borderRadius: "28px 28px 0 0", boxShadow: "0 -8px 40px rgba(84,34,105,0.15)" }}
      >
        <div className="w-full max-w-sm mx-auto">
          {step === 0 && <Step0 />}
          {step === 1 && <Step1 />}
          {step === 2 && <Step2 />}
          {step === 3 && <Step3 />}
        </div>
      </div>
    </div>
  );
}

// ── Payload builder ───────────────────────────────────────────────────────────
function buildPayload(form: FormData) {
  const base = { account_type: form.account_type };
  if (form.account_type === "independent_worker") return { ...base, onboarding_data: { registration_status: form.iw_registration_status, support_specialties: form.iw_support_specialties, years_experience: form.iw_years_experience, mobile_number: form.iw_mobile } };
  if (form.account_type === "allied_health") return { ...base, onboarding_data: { profession_type: form.ah_profession_type, registration_status: form.ah_registration_status, provider_number: form.ah_provider_number, specialties: form.ah_specialties, clinic_name: form.ah_clinic_name } };
  if (form.account_type === "small_provider") return { ...base, organization_name: form.sp_organisation_name, provider_type: form.sp_provider_type, registration_status: form.sp_registration_status, team_size: form.sp_team_size, participant_volume: form.sp_participant_volume, contact_number: form.sp_contact_number, onboarding_data: { provider_type: form.sp_provider_type, team_size: form.sp_team_size, participant_volume: form.sp_participant_volume } };
  return base;
}

// ── Account-type detail forms ─────────────────────────────────────────────────
function IndependentWorkerFields({ form, set, disabled }: { form: FormData; set: (f: keyof FormData, v: string) => void; disabled: boolean }) {
  return <>
    <div><Label>Registration status</Label><StyledSelect value={form.iw_registration_status} onChange={v => set("iw_registration_status", v)} placeholder="Select status…" disabled={disabled} options={[{ value: "registered_ndis", label: "Registered NDIS Provider" }, { value: "unregistered", label: "Unregistered Provider" }, { value: "sole_trader", label: "Sole Trader" }, { value: "employee", label: "Employee of a Provider" }]} /></div>
    <div><Label>Types of support you provide</Label><StyledInput value={form.iw_support_specialties} onChange={v => set("iw_support_specialties", v)} placeholder="Personal care, Community access…" disabled={disabled} /></div>
    <div><Label>Years of experience</Label><StyledSelect value={form.iw_years_experience} onChange={v => set("iw_years_experience", v)} placeholder="Optional…" disabled={disabled} options={[{ value: "less_than_1", label: "Less than 1 year" }, { value: "1_to_3", label: "1–3 years" }, { value: "3_to_5", label: "3–5 years" }, { value: "5_to_10", label: "5–10 years" }, { value: "10_plus", label: "10+ years" }]} /></div>
    <div><Label>Mobile number</Label><StyledInput type="tel" value={form.iw_mobile} onChange={v => set("iw_mobile", v)} placeholder="04xx xxx xxx" disabled={disabled} /></div>
  </>;
}

function AlliedHealthFields({ form, set, disabled }: { form: FormData; set: (f: keyof FormData, v: string) => void; disabled: boolean }) {
  return <>
    <div><Label>Profession</Label><StyledSelect value={form.ah_profession_type} onChange={v => set("ah_profession_type", v)} placeholder="Select profession…" disabled={disabled} options={[{ value: "occupational_therapist", label: "Occupational Therapist" }, { value: "speech_pathologist", label: "Speech Pathologist" }, { value: "physiotherapist", label: "Physiotherapist" }, { value: "behaviour_support", label: "Behaviour Support Practitioner" }, { value: "psychologist", label: "Psychologist" }, { value: "social_worker", label: "Social Worker" }, { value: "other", label: "Other Allied Health" }]} /></div>
    <div><Label>Registration status</Label><StyledSelect value={form.ah_registration_status} onChange={v => set("ah_registration_status", v)} placeholder="Select status…" disabled={disabled} options={[{ value: "ahpra_registered", label: "AHPRA Registered" }, { value: "aasw", label: "AASW Member" }, { value: "unregistered", label: "Unregistered Practitioner" }, { value: "student", label: "Student / Provisional" }]} /></div>
    <div><Label>Provider number <span className="text-[10px] normal-case font-normal" style={{ color: "#B08EC0" }}>(optional)</span></Label><StyledInput value={form.ah_provider_number} onChange={v => set("ah_provider_number", v)} placeholder="e.g. 2123456A" disabled={disabled} /></div>
    <div><Label>Areas of speciality <span className="text-[10px] normal-case font-normal" style={{ color: "#B08EC0" }}>(optional)</span></Label><StyledInput value={form.ah_specialties} onChange={v => set("ah_specialties", v)} placeholder="Autism, TBI, Mental health…" disabled={disabled} /></div>
    <div><Label>Clinic or practice name <span className="text-[10px] normal-case font-normal" style={{ color: "#B08EC0" }}>(optional)</span></Label><StyledInput value={form.ah_clinic_name} onChange={v => set("ah_clinic_name", v)} placeholder="Your practice name" disabled={disabled} /></div>
  </>;
}

function SmallProviderFields({ form, set, disabled }: { form: FormData; set: (f: keyof FormData, v: string) => void; disabled: boolean }) {
  return <>
    <div><Label>Organisation name</Label><StyledInput value={form.sp_organisation_name} onChange={v => set("sp_organisation_name", v)} placeholder="Your organisation name" disabled={disabled} /></div>
    <div><Label>Organisation type</Label><StyledSelect value={form.sp_provider_type} onChange={v => set("sp_provider_type", v)} placeholder="Select type…" disabled={disabled} options={[{ value: "registered_ndis", label: "Registered NDIS Provider" }, { value: "unregistered", label: "Unregistered Provider" }, { value: "allied_health_practice", label: "Allied Health Practice" }, { value: "support_coordination", label: "Support Coordination Agency" }, { value: "mixed", label: "Mixed Services" }]} /></div>
    <div><Label>Registration status</Label><StyledSelect value={form.sp_registration_status} onChange={v => set("sp_registration_status", v)} placeholder="Select status…" disabled={disabled} options={[{ value: "registered", label: "NDIS Registered" }, { value: "unregistered", label: "Unregistered" }, { value: "in_progress", label: "Registration In Progress" }]} /></div>
    <div className="grid grid-cols-2 gap-3">
      <div><Label>Team size</Label><StyledSelect value={form.sp_team_size} onChange={v => set("sp_team_size", v)} placeholder="Size…" disabled={disabled} options={[{ value: "solo", label: "Solo" }, { value: "2_5", label: "2–5 staff" }, { value: "6_15", label: "6–15 staff" }, { value: "15_plus", label: "15+ staff" }]} /></div>
      <div><Label>Participants</Label><StyledSelect value={form.sp_participant_volume} onChange={v => set("sp_participant_volume", v)} placeholder="Count…" disabled={disabled} options={[{ value: "1_10", label: "1–10" }, { value: "11_50", label: "11–50" }, { value: "51_200", label: "51–200" }, { value: "200_plus", label: "200+" }]} /></div>
    </div>
    <div><Label>Contact number <span className="text-[10px] normal-case font-normal" style={{ color: "#B08EC0" }}>(optional)</span></Label><StyledInput type="tel" value={form.sp_contact_number} onChange={v => set("sp_contact_number", v)} placeholder="Organisation phone" disabled={disabled} /></div>
  </>;
}
