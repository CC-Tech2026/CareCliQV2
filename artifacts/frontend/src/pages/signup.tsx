import { useState } from "react";
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

// ── Palette — aligned to CareScribe brand logo ───────────────────────────────
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

// ── Reusable Input Components ─────────────────────────────────────────────────
function StyledInput({
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
  autoComplete,
  error,
  required = true,
}: {
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
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      required={required}
      className="w-full h-11 px-4 rounded-xl text-[14px] font-medium outline-none transition-all duration-200"
      style={{
        background: BG,
        border: `1.5px solid ${error ? "#EF4444" : focused ? CORAL : BORDER}`,
        color: "#1E1640",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function StyledSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  required = true,
}: {
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
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      required={required}
      className="w-full h-11 px-4 rounded-xl text-[14px] font-medium outline-none transition-all duration-200"
      style={{
        background: BG,
        border: `1.5px solid ${focused ? CORAL : BORDER}`,
        color: "#1E1640",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
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

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Signup() {
  const { login, updateUser } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailVerify, setEmailVerify] = useState(false);

  const set = (f: keyof FormData, v: string) =>
    setForm((p) => ({ ...p, [f]: v }));

  const STEP_LABELS = ["Account Type", "Your Details", "Practice Info"];
  const TOTAL = 3;

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
      return form.iw_registration_status !== "" && form.iw_mobile.trim() !== "";
    }
    if (form.account_type === "allied_health") {
      return (
        form.ah_profession_type !== "" && form.ah_registration_status !== ""
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          account_type: form.account_type,
        }),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ detail: "Registration failed" }));
        throw new Error(err.detail || "Registration failed");
      }

      let token: string | null = null;
      try {
        const u = await login(form.email, form.password);
        token = u ? localStorage.getItem("carescribe_token") : null;
      } catch (loginErr) {
        const msg =
          loginErr instanceof Error ? loginErr.message.toLowerCase() : "";
        if (
          msg.includes("verify") ||
          msg.includes("email") ||
          msg.includes("confirmed")
        ) {
          setEmailVerify(true);
          setStep(3);
          return;
        }
        toast({
          title: "Account created",
          description: "Please sign in with your new credentials.",
        });
        navigate("/login");
        return;
      }

      if (token) {
        try {
          await fetch("/api/auth/complete-onboarding", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(buildPayload(form)),
          });
          updateUser({ onboarding_complete: true });
        } catch {
          /* non-fatal */
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

  // ── Step Content Builders ───────────────────────────────────────────────────
  function Step0() {
    return (
      <div className="space-y-4 animate-fade-in-up">
        <div className="mb-5">
          <h2
            className="text-[22px] font-black tracking-tight"
            style={{ color: PLUM }}
          >
            Who are you?
          </h2>
          <p
            className="text-[13px] mt-0.5 font-medium"
            style={{ color: "#9B6FAB" }}
          >
            Choose how you'll use CareScribe
          </p>
        </div>

        {TYPES.map((t) => {
          const sel = form.account_type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => set("account_type", t.value)}
              className="w-full text-left p-4 rounded-2xl border-2 transition-all duration-200 transform active:scale-[0.99] hover:border-[#5533CC]/40"
              style={{
                borderColor: sel ? t.dot : BORDER,
                background: sel ? `${t.dot}10` : "white",
                boxShadow: sel ? `0 8px 20px -6px ${t.dot}30` : "none",
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-1.5 h-3 w-3 rounded-full shrink-0 transition-colors"
                  style={{ background: sel ? t.dot : BORDER }}
                />
                <div className="flex-1">
                  <p
                    className="text-[14px] font-black tracking-tight"
                    style={{ color: sel ? PLUM : "#1E1640" }}
                  >
                    {t.title}
                  </p>
                  <p
                    className="text-[12px] mt-0.5 leading-snug font-medium"
                    style={{ color: "#7A6A9E" }}
                  >
                    {t.sub}
                  </p>
                </div>
                {sel && (
                  <CheckCircle2
                    size={18}
                    style={{ color: t.dot, marginTop: 2 }}
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
          className="w-full h-12 rounded-xl text-white text-[15px] font-black flex items-center justify-center gap-2 mt-4 transition-all duration-300 hover:opacity-95 shadow-[0_8px_24px_-6px_rgba(240,48,96,0.3)] hover:shadow-[0_12px_28px_-4px_rgba(240,48,96,0.4)] active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none"
          style={{
            background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
          }}
        >
          <span>Continue</span> <ArrowRight size={16} strokeWidth={2.5} />
        </button>

        <p
          className="text-center text-[13px] font-medium mt-4"
          style={{ color: "#B08EC0" }}
        >
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="font-black hover:underline"
            style={{ color: CORAL }}
          >
            Sign in
          </button>
        </p>
      </div>
    );
  }

  function Step1() {
    const mismatch =
      !!form.confirm_password && form.password !== form.confirm_password;
    const short = !!form.password && form.password.length < 8;

    const handleNextStep = (e: React.FormEvent) => {
      e.preventDefault();
      if (step1Valid()) setStep(2);
    };

    return (
      <form
        onSubmit={handleNextStep}
        className="space-y-3.5 animate-fade-in-up"
      >
        <div className="mb-3">
          <h2
            className="text-[22px] font-black tracking-tight"
            style={{ color: PLUM }}
          >
            Create account
          </h2>
          <p
            className="text-[13px] mt-0.5 font-medium"
            style={{ color: "#9B6FAB" }}
          >
            You'll use these to sign in every time
          </p>
        </div>

        <div>
          <Label>Full name</Label>
          <StyledInput
            value={form.full_name}
            onChange={(v) => set("full_name", v)}
            placeholder="Jane Smith"
            autoComplete="name"
            disabled={busy}
          />
        </div>
        <div>
          <Label>Email address</Label>
          <StyledInput
            type="email"
            value={form.email}
            onChange={(v) => set("email", v)}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={busy}
          />
        </div>
        <div>
          <Label>Password</Label>
          <div className="relative">
            <StyledInput
              type={showPass ? "text" : "password"}
              value={form.password}
              onChange={(v) => set("password", v)}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              disabled={busy}
              error={short}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-black/5 text-[#DEB2E4]"
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {short && (
            <p className="text-[11px] font-medium text-red-500 mt-1">
              Minimum 8 characters required
            </p>
          )}
        </div>
        <div>
          <Label>Confirm password</Label>
          <StyledInput
            type="password"
            value={form.confirm_password}
            onChange={(v) => set("confirm_password", v)}
            placeholder="Repeat password"
            autoComplete="new-password"
            disabled={busy}
            error={mismatch}
          />
          {mismatch && (
            <p className="text-[11px] font-bold text-red-500 mt-1">
              Passwords don't match
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={() => setStep(0)}
            className="flex items-center justify-center gap-1.5 px-5 h-11 rounded-xl text-[14px] font-black transition-all active:scale-[0.99] hover:bg-gray-100"
            style={{
              color: PLUM,
              background: "#FAF5FA",
              border: `1.5px solid ${BORDER}`,
            }}
          >
            <ArrowLeft size={15} strokeWidth={2.5} /> Back
          </button>
          <button
            type="submit"
            disabled={!step1Valid()}
            className="flex-1 h-11 rounded-xl text-white text-[14px] font-black flex items-center justify-center gap-2 transition-all duration-300 hover:opacity-95 active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none"
            style={{
              background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
            }}
          >
            <span>Continue</span> <ArrowRight size={15} strokeWidth={2.5} />
          </button>
        </div>
      </form>
    );
  }

  function Step2() {
    return (
      <form onSubmit={handleSubmit} className="space-y-3.5 animate-fade-in-up">
        <div className="mb-3">
          <h2
            className="text-[22px] font-black tracking-tight"
            style={{ color: PLUM }}
          >
            Practice details
          </h2>
          <p
            className="text-[13px] mt-0.5 font-medium"
            style={{ color: "#9B6FAB" }}
          >
            Help us tailor CareScribe for you
          </p>
        </div>

        {form.account_type === "independent_worker" && (
          <IndependentWorkerFields form={form} set={set} disabled={busy} />
        )}
        {form.account_type === "allied_health" && (
          <AlliedHealthFields form={form} set={set} disabled={busy} />
        )}
        {form.account_type === "small_provider" && (
          <SmallProviderFields form={form} set={set} disabled={busy} />
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={() => setStep(1)}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 px-5 h-11 rounded-xl text-[14px] font-black transition-all active:scale-[0.99] hover:bg-gray-100"
            style={{
              color: PLUM,
              background: "#FAF5FA",
              border: `1.5px solid ${BORDER}`,
            }}
          >
            <ArrowLeft size={15} strokeWidth={2.5} /> Back
          </button>
          <button
            type="submit"
            disabled={busy || !step2Valid()}
            className="flex-1 h-11 rounded-xl text-white text-[14px] font-black flex items-center justify-center gap-2 transition-all duration-300 hover:opacity-95 active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none"
            style={{
              background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
            }}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />{" "}
                <span>Setting up…</span>
              </>
            ) : (
              <>
                <span>Complete Setup</span>{" "}
                <ArrowRight size={15} strokeWidth={2.5} />
              </>
            )}
          </button>
        </div>
      </form>
    );
  }

  function Step3() {
    return (
      <div className="text-center space-y-5 py-4 animate-fade-in-up">
        {emailVerify ? (
          <>
            <div
              className="h-20 w-20 rounded-full flex items-center justify-center mx-auto animate-bounce-short"
              style={{ background: `${BLUSH}30` }}
            >
              <svg
                className="h-10 w-10"
                style={{ color: CORAL }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div>
              <h2
                className="text-[22px] font-black tracking-tight"
                style={{ color: PLUM }}
              >
                Check your email
              </h2>
              <p
                className="text-[13px] mt-2 max-w-xs mx-auto font-medium leading-relaxed"
                style={{ color: "#9B6FAB" }}
              >
                We sent a link to{" "}
                <span className="font-black" style={{ color: PLUM }}>
                  {form.email}
                </span>
                . Click it to activate your account.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="w-full h-12 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-all duration-300 hover:opacity-95 active:scale-[0.99]"
              style={{
                background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
              }}
            >
              <span>Go to Sign In</span>{" "}
              <ArrowRight size={16} strokeWidth={2.5} />
            </button>
          </>
        ) : (
          <>
            <div
              className="h-20 w-20 rounded-full flex items-center justify-center mx-auto animate-bounce-short"
              style={{ background: `${BLUSH}30` }}
            >
              <CheckCircle2 size={40} style={{ color: CORAL }} />
            </div>
            <div>
              <h2
                className="text-[22px] font-black tracking-tight"
                style={{ color: PLUM }}
              >
                You're all set!
              </h2>
              <p
                className="text-[13px] mt-2 font-medium"
                style={{ color: "#9B6FAB" }}
              >
                Welcome,{" "}
                <span className="font-black" style={{ color: PLUM }}>
                  {form.full_name.split(" ")[0]}
                </span>
                . Your account is ready.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="w-full h-12 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-all duration-300 hover:opacity-95 active:scale-[0.99]"
              style={{
                background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
              }}
            >
              <span>Go to Dashboard</span>{" "}
              <ArrowRight size={16} strokeWidth={2.5} />
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Render Viewport ─────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen flex flex-col md:flex-row font-sans selection:bg-[#5533CC]/20 relative overflow-hidden bg-[#F5F3FC]">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes fadeInUp {
              from { opacity: 0; transform: translateY(12px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes bounceShort {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
            .animate-fade-in-up {
              animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            .animate-bounce-short {
              animation: bounceShort 2s ease-in-out infinite;
            }
            .custom-form-scroll::-webkit-scrollbar {
              width: 6px;
            }
            .custom-form-scroll::-webkit-scrollbar-track {
              background: transparent;
            }
            .custom-form-scroll::-webkit-scrollbar-thumb {
              background: #D8D0F0;
              border-radius: 20px;
            }
            .custom-form-scroll::-webkit-scrollbar-thumb:hover {
              background: #C8C0EE;
            }
          `,
        }}
      />

      {/* ── LEFT HALF: Brand Creative Canvas ── */}
      <div className="w-full md:w-1/2 relative h-[35%] md:h-full flex flex-col justify-between p-6 md:p-12 overflow-hidden shrink-0">
        <div
          className="absolute inset-0 z-0 bg-cover bg-center transition-transform duration-700 hover:scale-105"
          style={{ backgroundImage: `url('/signup_welcome.jpg')` }}
        />
        <div
          className="absolute inset-0 z-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(30, 22, 64, 0.85) 0%, rgba(85, 51, 204, 0.5) 50%, rgba(240, 48, 96, 0.4) 100%)",
          }}
        />
        <div
          className="absolute inset-0 z-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />

        {/* Top Logo */}
        <div className="relative flex flex-col items-start">
          <img
            src="/logo.png"
            alt="CareScribe"
            className="w-auto object-contain shrink-0 max-w-[160px] md:max-w-[240px]"
            style={{
              height: "36px",
              /* Adds a soft, sophisticated brand glow behind the logo graphics */
              filter: "drop-shadow(0px 4px 6px rgba(40, 40, 100, 0.95))",
            }}
          />
          <p className="text-[10px] font-black uppercase tracking-[0.18em] mt-1.5 text-[#F8C0CE]">
            NDIS Compliance Made Easy
          </p>
        </div>

        {/* Marketing Slogan */}
        <div className="relative z-10 max-w-md my-auto pt-2 md:pt-0 text-center md:text-left">
          <h1 className="text-2xl md:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
            Write beautiful notes, <br className="hidden lg:inline" />
            <span className="text-[#FFD2DA]">minus the heavy admin.</span>
          </h1>
          <p className="text-[13px] md:text-[15px] mt-1.5 md:mt-4 text-white/90 font-medium leading-relaxed max-w-sm mx-auto md:mx-0 drop-shadow-sm">
            Join thousands of Australian healthcare operators automating
            invoicing, case tracking, and smart templates.
          </p>
        </div>

        <div className="relative z-10 text-center md:text-left text-[10px] text-white/80 font-bold tracking-wider hidden md:block drop-shadow-sm">
          © 2026 CARESCRIBE • SECURED FOR AUSTRALIAN HEALTHCARE
        </div>
      </div>

      {/* ── RIGHT HALF: Unified Multi-Step Form Wrapper ── */}
      <div className="w-full md:w-1/2 h-[65%] md:h-full flex flex-col items-center justify-center p-4 sm:p-8 md:p-12 lg:px-20 bg-[#F5F3FC]">
        <div className="w-full max-w-md flex flex-col max-h-full">
          {step < TOTAL && (
            <div className="flex items-center gap-2 justify-center mb-4 md:mb-6 w-full bg-white px-4 py-2.5 rounded-2xl border border-[#D8D0F0]/60 shadow-[0_4px_12px_rgba(84,34,105,0.03)] shrink-0">
              {STEP_LABELS.map((l, i) => (
                <div
                  key={l}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <div
                    className="h-1 w-full rounded-full transition-all duration-300"
                    style={{ background: i <= step ? PLUM : "#E5E7EB" }}
                  />
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider"
                    style={{ color: i <= step ? PLUM : "#9CA3AF" }}
                  >
                    {l.split(" ")[0]}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Form Content Context Viewport Box */}
          <div className="w-full bg-white rounded-[2rem] px-5 py-6 sm:p-8 shadow-[0_16px_48px_-12px_rgba(84,34,105,0.08)] border border-[#E8D5E8]/50 overflow-y-auto custom-form-scroll flex flex-col justify-between">
            <div>
              {step === 0 && <Step0 />}
              {step === 1 && <Step1 />}
              {step === 2 && <Step2 />}
              {step === 3 && <Step3 />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Payload builder ───────────────────────────────────────────────────────────
function buildPayload(form: FormData) {
  const base = { account_type: form.account_type };
  if (form.account_type === "independent_worker")
    return {
      ...base,
      onboarding_data: {
        registration_status: form.iw_registration_status,
        support_specialties: form.iw_support_specialties,
        years_experience: form.iw_years_experience,
        mobile_number: form.iw_mobile,
      },
    };
  if (form.account_type === "allied_health")
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
  if (form.account_type === "small_provider")
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
  return base;
}

// ── Dynamic Form Sub-fields ──────────────────────────────────────────────────
function IndependentWorkerFields({
  form,
  set,
  disabled,
}: {
  form: FormData;
  set: (f: keyof FormData, v: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div>
        <Label>Registration status</Label>
        <StyledSelect
          value={form.iw_registration_status}
          onChange={(v) => set("iw_registration_status", v)}
          placeholder="Select status…"
          disabled={disabled}
          options={[
            { value: "registered_ndis", label: "Registered NDIS Provider" },
            { value: "unregistered", label: "Unregistered Provider" },
            { value: "sole_trader", label: "Sole Trader" },
            { value: "employee", label: "Employee of a Provider" },
          ]}
        />
      </div>
      <div className="mt-3">
        <Label>Types of support you provide</Label>
        <StyledInput
          value={form.iw_support_specialties}
          onChange={(v) => set("iw_support_specialties", v)}
          placeholder="Personal care, Community access…"
          disabled={disabled}
        />
      </div>
      <div className="mt-3">
        <Label>Years of experience</Label>
        <StyledSelect
          value={form.iw_years_experience}
          onChange={(v) => set("iw_years_experience", v)}
          placeholder="Optional…"
          disabled={disabled}
          required={false}
          options={[
            { value: "less_than_1", label: "Less than 1 year" },
            { value: "1_to_3", label: "1–3 years" },
            { value: "3_to_5", label: "3–5 years" },
            { value: "5_to_10", label: "5–10 years" },
            { value: "10_plus", label: "10+ years" },
          ]}
        />
      </div>
      <div className="mt-3">
        <Label>Mobile number</Label>
        <StyledInput
          type="tel"
          value={form.iw_mobile}
          onChange={(v) => set("iw_mobile", v)}
          placeholder="04xx xxx xxx"
          disabled={disabled}
        />
      </div>
    </>
  );
}

function AlliedHealthFields({
  form,
  set,
  disabled,
}: {
  form: FormData;
  set: (f: keyof FormData, v: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div>
        <Label>Profession</Label>
        <StyledSelect
          value={form.ah_profession_type}
          onChange={(v) => set("ah_profession_type", v)}
          placeholder="Select profession…"
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
            { value: "psychologist", label: "Psychologist" },
            { value: "social_worker", label: "Social Worker" },
            { value: "other", label: "Other Allied Health" },
          ]}
        />
      </div>
      <div className="mt-3">
        <Label>Registration status</Label>
        <StyledSelect
          value={form.ah_registration_status}
          onChange={(v) => set("ah_registration_status", v)}
          placeholder="Select status…"
          disabled={disabled}
          options={[
            { value: "ahpra_registered", label: "AHPRA Registered" },
            { value: "aasw", label: "AASW Member" },
            { value: "unregistered", label: "Unregistered Practitioner" },
          ]}
        />
      </div>
      <div className="mt-3">
        <Label>Medicare Provider Number</Label>
        <StyledInput
          value={form.ah_provider_number}
          onChange={(v) => set("ah_provider_number", v)}
          placeholder="Enter provider number…"
          disabled={disabled}
        />
      </div>
      <div className="mt-3">
        <Label>Clinic Name / Employer</Label>
        <StyledInput
          value={form.ah_clinic_name}
          onChange={(v) => set("ah_clinic_name", v)}
          placeholder="E.g. Adelaide Health Collective"
          disabled={disabled}
        />
      </div>
    </>
  );
}

function SmallProviderFields({
  form,
  set,
  disabled,
}: {
  form: FormData;
  set: (f: keyof FormData, v: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div>
        <Label>Organisation Name</Label>
        <StyledInput
          value={form.sp_organisation_name}
          onChange={(v) => set("sp_organisation_name", v)}
          placeholder="E.g. Care Partners Ltd"
          disabled={disabled}
        />
      </div>
    </>
  );
}
