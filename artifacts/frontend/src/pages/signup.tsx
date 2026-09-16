import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { CCQ_TOKEN_KEY } from "@/lib/storage-keys";
import { useAuth, type AccountType } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { persistAuthSession, getRememberDevicePreference } from "@/lib/auth-session";
import {
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  Quote,
  AlertTriangle,
  Camera,
  Upload,
  User,
} from "lucide-react";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { OtpInput } from "@/components/auth/OtpInput";
import { uploadProfilePhoto } from "@/services/userService";

// ── Palette ───────────────────────────────────────────────────────────────────
const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "var(--auth-input-border)";
const BG = "var(--auth-input-bg)";

// Solid brand colors — no gradients.
const LOGO_PURPLE = "#7C3AED";

// ── Password Strength Indicator ───────────────────────────────────────────────
function PasswordStrengthBar({ password, t }: { password: string; t: (key: string) => string }) {
  const getScore = (pwd: string): number => {
    let score = 0;
    if (pwd.length >= 10) score++;
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
              background: i < score ? colors[score - 1] : "#E8E8EA",
            }}
          />
        ))}
      </div>
      {password && (
        <>
          <p className="text-[11px] font-medium" style={{ color: colors[Math.max(score - 1, 0)] }}>
            {labels[Math.max(score - 1, 0)]}
          </p>
          <p className="text-[11px] leading-snug" style={{ color: "var(--cc-muted)" }}>
            {t("auth.signup.passwordHint")}
          </p>
        </>
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

  sp_organisation_name: string;
  sp_provider_type: string;
  sp_org_type: string;
  sp_registration_status: string;
  sp_team_size: string;
  sp_participant_volume: string;
  sp_contact_number: string;
  sp_address: string;
  /** Head-office state — sets the organisation's timezone. */
  sp_state: string;
}

const AU_STATES = [
  { value: "SA", label: "South Australia" },
  { value: "NSW", label: "New South Wales" },
  { value: "VIC", label: "Victoria" },
  { value: "QLD", label: "Queensland" },
  { value: "WA", label: "Western Australia" },
  { value: "TAS", label: "Tasmania" },
  { value: "NT", label: "Northern Territory" },
  { value: "ACT", label: "Australian Capital Territory" },
];

const EMPTY: FormData = {
  account_type: "small_provider",
  full_name: "",
  email: "",
  password: "",
  confirm_password: "",

  sp_organisation_name: "",
  sp_provider_type: "",
  sp_org_type: "",
  sp_registration_status: "",
  sp_team_size: "",
  sp_participant_volume: "",
  sp_contact_number: "",
  sp_address: "",
  sp_state: "",
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
      title={placeholder}
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

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p
      className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
      style={{ color: PLUM }}
    >
      {children}
      {required ? <span style={{ color: "#EF4444" }}> *</span> : null}
    </p>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
interface InviteInfo {
  email: string;
  role: string;
  token: string;
  organization_id?: string;
  organization_name: string | null;
  expires_at: string;
  requires_email_code?: boolean;
}

export default function Signup() {
  const { login, updateUser, updateToken } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate: t, translateParams } = useAccessibility();

  const urlInviteToken = new URLSearchParams(window.location.search).get("token") ?? "";
  const [mode, setMode] = useState<"join" | "create">(urlInviteToken ? "join" : "join");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [emailVerify, setEmailVerify] = useState(false);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLoading, setInviteLoading] = useState(Boolean(urlInviteToken));
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [emailCodeVerified, setEmailCodeVerified] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeError, setEmailCodeError] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const orgNameLocked = mode === "create" && Boolean(invite?.organization_name);
  const isJoin = mode === "join";

  useEffect(() => {
    if (!urlInviteToken) return;
    let cancelled = false;
    setInviteLoading(true);
    setInviteError(null);
    fetch(`/api/invitations/validate/${encodeURIComponent(urlInviteToken)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          const detail = body.detail;
          throw new Error(
            typeof detail === "string" ? detail : t("auth.invite.invalidOrExpired"),
          );
        }
        return r.json() as Promise<Omit<InviteInfo, "token"> & { token?: string; email_verified?: boolean }>;
      })
      .then((data) => {
        if (cancelled) return;
        setInvite({
          email: data.email,
          role: data.role,
          token: urlInviteToken,
          organization_id: data.organization_id,
          organization_name: data.organization_name,
          expires_at: data.expires_at,
          requires_email_code: data.requires_email_code,
        });
        setEmailCodeVerified(Boolean(data.email_verified));
        setForm((prev) => ({
          ...prev,
          email: data.email || "",
          sp_organisation_name: data.organization_name || prev.sp_organisation_name,
          account_type: data.role === "support_worker" ? "independent_worker" : "small_provider",
        }));
        setMode("join");
        setStep(2);
        setInviteLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setInviteError(e.message || t("auth.invite.invalidOrExpired"));
        setInviteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urlInviteToken, t]);

  const needsEmailCode = Boolean(invite?.requires_email_code) && !emailCodeVerified;

  const sendEmailCode = useCallback(async () => {
    if (!invite?.token) return;
    setCodeBusy(true);
    setEmailCodeError(null);
    try {
      const res = await fetch(`/api/invitations/${encodeURIComponent(invite.token)}/send-code`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || t("auth.invite.codeSendFailed"));
      setCodeSent(true);
      setCodeMessage(data.message || null);
    } catch (e) {
      setEmailCodeError(e instanceof Error ? e.message : t("auth.invite.codeSendFailed"));
    } finally {
      setCodeBusy(false);
    }
  }, [invite?.token, t]);

  useEffect(() => {
    if (needsEmailCode && !codeSent && !codeBusy) {
      sendEmailCode();
    }
  }, [needsEmailCode, codeSent, codeBusy, sendEmailCode]);

  async function handleVerifyCode() {
    if (!invite?.token || emailCode.length !== 6 || codeBusy) return;
    setCodeBusy(true);
    setEmailCodeError(null);
    try {
      const res = await fetch(`/api/invitations/${encodeURIComponent(invite.token)}/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: emailCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || t("auth.invite.codeInvalid"));
      setEmailCodeVerified(true);
    } catch (e) {
      setEmailCodeError(e instanceof Error ? e.message : t("auth.invite.codeInvalid"));
    } finally {
      setCodeBusy(false);
    }
  }

  const updateField = useCallback((f: keyof FormData, v: string) => {
    setForm((p) => ({
      ...p,
      [f]: v,
    }));
  }, []);

  const JOIN_STEP_LABELS = [
    t("auth.signup.step.inviteCode"),
    t("auth.signup.step.account"),
    t("auth.signup.step.profile"),
    t("auth.signup.step.review"),
  ];
  const CREATE_STEP_LABELS = [t("auth.signup.step.details"), t("auth.signup.step.organisation")];
  const STEP_LABELS = isJoin ? JOIN_STEP_LABELS : CREATE_STEP_LABELS;

  function accountDetailsValid() {
    return (
      form.full_name.trim() !== "" &&
      form.email.trim() !== "" &&
      form.password.length >= 10 &&
      form.password === form.confirm_password
    );
  }

  function step1Valid() {
    return accountDetailsValid();
  }

  function profileValid() {
    return form.sp_address.trim() !== "";
  }

  function step2Valid() {
    return (
      form.sp_organisation_name.trim() !== "" &&
      form.sp_provider_type.trim() !== "" &&
      form.sp_org_type.trim() !== "" &&
      form.sp_registration_status.trim() !== "" &&
      form.sp_team_size.trim() !== "" &&
      form.sp_participant_volume.trim() !== "" &&
      form.sp_contact_number.trim() !== "" &&
      form.sp_address.trim() !== "" &&
      form.sp_state.trim() !== ""
    );
  }

  async function handleLookupInviteCode() {
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setInviteError(null);
    try {
      const res = await apiFetch(`/api/invitations/lookup/${encodeURIComponent(code)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body.detail === "string" ? body.detail : t("auth.signup.join.invalidCode"),
        );
      }
      const data = (await res.json()) as InviteInfo;
      setInvite({
        email: data.email,
        role: data.role,
        token: data.token,
        organization_id: data.organization_id,
        organization_name: data.organization_name,
        expires_at: data.expires_at,
      });
      setForm((prev) => ({
        ...prev,
        email: data.email || "",
        sp_organisation_name: data.organization_name || prev.sp_organisation_name,
        account_type: data.role === "support_worker" ? "independent_worker" : "small_provider",
      }));
      setStep(2);
    } catch (err) {
      setInvite(null);
      toast({
        title: t("auth.signup.error.failed"),
        description: err instanceof Error ? err.message : t("auth.signup.join.invalidCode"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function onPhotoSelected(file?: File | null) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast({
        title: t("profile.photo.unsupported"),
        description: t("profile.photo.uploadJpgPngWebp"),
        variant: "destructive",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t("profile.photo.tooLarge"),
        description: t("profile.photo.maxSize"),
        variant: "destructive",
      });
      return;
    }
    setProfilePhotoFile(file);
    setProfilePhotoPreview(URL.createObjectURL(file));
  }

  async function handleJoinComplete() {
    if (!invite?.token || !accountDetailsValid() || !profileValid() || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/invitations/accept/${encodeURIComponent(invite.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          password: form.password,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail;
        throw new Error(
          typeof detail === "string" ? detail : t("auth.invite.toast.acceptFailed"),
        );
      }
      const data = await res.json();

      if (data.access_token) {
        const rememberDevice = getRememberDevicePreference();
        const userData = {
          id: data.user.id,
          email: data.user.email,
          full_name: data.user.full_name,
          role: data.user.role,
          account_type: data.user.account_type,
          organization_id: data.user.organization_id,
          organizationId: data.user.organization_id,
          onboarding_complete: true,
        };
        persistAuthSession(data.access_token, JSON.stringify(userData), rememberDevice);
        await updateToken(data.access_token);

        if (profilePhotoFile) {
          try {
            const profile = await uploadProfilePhoto(profilePhotoFile);
            updateUser({ profile_photo_url: profile.profile_photo_url || null });
          } catch {
            /* optional */
          }
        }

        try {
          await apiFetch("/api/auth/complete-onboarding", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${data.access_token}`,
            },
            body: JSON.stringify({
              account_type: form.account_type || "independent_worker",
              organization_name: invite.organization_name || form.sp_organisation_name,
              contact_number: form.sp_contact_number || undefined,
              address: form.sp_address || undefined,
              org_address: form.sp_address || undefined,
              state: form.sp_state || undefined,
            }),
          });
          updateUser({ onboarding_complete: true });
        } catch {
          updateUser({ onboarding_complete: true });
        }
      }

      setStep(5);
      toast({ title: t("auth.invite.toast.welcome"), description: t("auth.invite.toast.activated") });
      const destination = data.user?.role === "support_worker" ? "/worker-onboarding" : "/hub";
      setTimeout(() => navigate(destination), 1500);
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

  async function handleInviteSubmit() {
    if (!invite?.token || !step2Valid() || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/invitations/accept/${encodeURIComponent(invite.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          password: form.password,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail;
        throw new Error(
          typeof detail === "string" ? detail : t("auth.invite.toast.acceptFailed"),
        );
      }
      const data = await res.json();

      if (data.access_token) {
        const rememberDevice = getRememberDevicePreference();
        const userData = {
          id: data.user.id,
          email: data.user.email,
          full_name: data.user.full_name,
          role: data.user.role,
          account_type: data.user.account_type,
          organization_id: data.user.organization_id,
          organizationId: data.user.organization_id,
          onboarding_complete: true,
        };
        persistAuthSession(data.access_token, JSON.stringify(userData), rememberDevice);
        await updateToken(data.access_token);

        try {
          await apiFetch("/api/auth/complete-onboarding", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${data.access_token}`,
            },
            body: JSON.stringify(buildPayload(form)),
          });
          updateUser({ onboarding_complete: true });
        } catch {
          updateUser({ onboarding_complete: true });
        }
      }

      setStep(3);
      toast({ title: t("auth.invite.toast.welcome"), description: t("auth.invite.toast.activated") });
      const destination = data.user?.role === "support_worker" ? "/worker-onboarding" : "/hub";
      setTimeout(() => navigate(destination), 1500);
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

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();

    if (!step2Valid() || busy) return;

    if (invite?.token && mode === "create") {
      await handleInviteSubmit();
      return;
    }

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

      let authToken: string | null = null;

      try {
        const result = await login(form.email, form.password);
        if (result.status === "authenticated") {
          authToken = localStorage.getItem(CCQ_TOKEN_KEY);
        }
      } catch (err) {
        setEmailVerify(true);
        setStep(3);
        return;
      }

      if (authToken) {
        try {
          const onboardingRes = await apiFetch(
            "/api/auth/complete-onboarding",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(buildPayload(form)),
            },
          );

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

  const short = !!form.password && form.password.length < 10;

  if (inviteLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--auth-shell-bg)]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin" style={{ color: PLUM }} size={32} />
          <p className="text-sm" style={{ color: "var(--cc-muted)" }}>{t("auth.invite.validating")}</p>
        </div>
      </div>
    );
  }

  if (inviteError && urlInviteToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--auth-shell-bg)] px-4">
        <div
          className="w-full max-w-md rounded-3xl p-8 text-center space-y-4 border bg-[var(--auth-form-bg)]"
          style={{ borderColor: "var(--auth-card-border)" }}
        >
          <AlertTriangle size={40} className="mx-auto" style={{ color: CORAL }} />
          <h2 className="text-xl font-bold" style={{ color: "var(--cc-text)" }}>{t("auth.invite.errorTitle")}</h2>
          <p className="text-sm" style={{ color: "var(--cc-muted)" }}>{inviteError}</p>
          <a href="/login" className="text-sm font-medium underline underline-offset-2" style={{ color: PLUM }}>
            {t("auth.invite.goToSignIn")}
          </a>
        </div>
      </div>
    );
  }

  if (invite && needsEmailCode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--auth-shell-bg)] px-4">
        <div
          className="w-full max-w-md rounded-3xl p-8 space-y-5 border bg-[var(--auth-form-bg)]"
          style={{ borderColor: "var(--auth-card-border)" }}
        >
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-bold" style={{ color: "var(--cc-text)" }}>{t("auth.invite.verifyTitle")}</h2>
            <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
              {translateParams("auth.invite.verifySubtitle", { email: invite.email })}
            </p>
          </div>

          <div>
            <label id="invite-code-label" className="text-[11px] font-black uppercase tracking-wider mb-3 block" style={{ color: "var(--cc-muted)" }}>
              {t("auth.invite.verificationCode")}
            </label>
            <OtpInput
              ariaLabelledBy="invite-code-label"
              value={emailCode}
              onChange={(v) => { setEmailCode(v); if (emailCodeError) setEmailCodeError(null); }}
              disabled={codeBusy}
              error={!!emailCodeError}
            />
            {emailCodeError && (
              <p className="mt-2 text-[12px] font-medium" style={{ color: CORAL }}>{emailCodeError}</p>
            )}
            {!emailCodeError && codeMessage && (
              <p className="mt-2 text-[12px] font-medium" style={{ color: "var(--cc-muted)" }}>{codeMessage}</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleVerifyCode}
            disabled={codeBusy || emailCode.length !== 6}
            className="w-full h-12 rounded-xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: "var(--cc-cta)" }}
          >
            {codeBusy
              ? <><Loader2 size={16} className="animate-spin" /><span>{t("auth.invite.verifying")}</span></>
              : <><span>{t("auth.invite.verify")}</span><ArrowRight size={16} strokeWidth={2.5} /></>
            }
          </button>

          <button
            type="button"
            onClick={() => { setCodeSent(false); sendEmailCode(); }}
            disabled={codeBusy}
            className="w-full text-center text-[13px] font-bold transition-opacity hover:opacity-75 disabled:opacity-40"
            style={{ color: PLUM }}
          >
            {t("auth.invite.resendCode")}
          </button>
        </div>
      </div>
    );
  }

  const progressStep = isJoin ? Math.min(step, 4) : Math.min(step, 2);
  const showFooter = isJoin ? step < 5 : step < 3;

  return (
    <div className="relative h-screen w-screen flex overflow-hidden md:gap-6 md:p-6 bg-[var(--auth-shell-bg)] md:bg-[#7C3AED] text-cc-text">
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
        @keyframes headlineLineIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .auth-headline-line {
          display: block;
          opacity: 0;
          animation: headlineLineIn 0.55s ease-out forwards;
        }
        @keyframes authGlowPulse {
          0%, 100% { opacity: 0.75; }
          50%      { opacity: 1; }
        }
        .auth-glow {
          animation: authGlowPulse 9s ease-in-out infinite;
        }
        @keyframes authHeroZoom {
          from { transform: scale(1); }
          to   { transform: scale(1.045); }
        }
        .auth-hero-photo {
          animation: authHeroZoom 22s ease-in-out infinite alternate;
        }
        .auth-scroll-hide { scrollbar-width: none; -ms-overflow-style: none; }
        .auth-scroll-hide::-webkit-scrollbar { display: none; }
      `,
        }}
      />
      {/* LEFT */}
      <div className="hidden md:flex md:flex-1 relative h-full overflow-hidden flex-col justify-between p-12 md:rounded-[28px]">
        {/* Hero photo fills the panel. Text sits on a flat (non-gradient) dark
            scrim, so colours here are hardcoded light values instead of the
            theme-conditional --auth-* vars — the backdrop is always a dark
            photo now, regardless of light/dark mode. */}
        <img
          src="/auth-hero-signup.jpg"
          alt=""
          aria-hidden="true"
          className="auth-hero-photo absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0" style={{ background: "rgba(26, 26, 46, 0.55)" }} />

        <div className="relative z-10 flex max-w-[440px] flex-col justify-between h-full">
          <div>
            <CareCliQLogo size={96} />
            <p className="mt-3 text-[11px] font-black tracking-[0.2em] uppercase" style={{ color: "rgba(255, 255, 255, 0.75)" }}>
              {t("auth.signup.marketing.tagline")}
            </p>
          </div>

          <div>
            <h1 className="text-[42px] font-black leading-[1.15] tracking-tight" style={{ color: "#FFFFFF" }}>
              <span className="auth-headline-line" style={{ animationDelay: "0ms" }}>
                {t("auth.signup.marketing.headline1")}
              </span>
              <span className="auth-headline-line" style={{ animationDelay: "100ms", color: "#C4B5FD" }}>
                {t("auth.signup.marketing.headline2")}
              </span>
            </h1>
            <p className="mt-5 leading-relaxed max-w-[380px]" style={{ color: "rgba(255, 255, 255, 0.85)" }}>
              {t("auth.signup.marketing.description")}
            </p>

            {/* Testimonial */}
            <div
              className="mt-8 max-w-[380px] rounded-2xl p-4"
              style={{ background: "var(--auth-card-bg)", border: "1px solid var(--auth-card-border)" }}
            >
              <Quote size={16} style={{ color: LOGO_PURPLE }} />
              <p className="mt-2.5 text-[13px] font-medium leading-relaxed" style={{ color: "var(--auth-headline)" }}>
                {t("auth.signup.marketing.testimonialQuote")}
              </p>
              <div className="mt-3 flex items-center gap-2.5">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0"
                  style={{ background: LOGO_PURPLE }}
                >
                  PN
                </div>
                <div>
                  <p className="text-[12px] font-black" style={{ color: "var(--auth-headline)" }}>
                    {t("auth.signup.marketing.testimonialName")}
                  </p>
                  <p className="text-[11px] font-medium" style={{ color: "var(--auth-marketing-muted)" }}>
                    {t("auth.signup.marketing.testimonialRole")} · {t("auth.signup.marketing.testimonialOrg")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-[11px] font-bold tracking-wider" style={{ color: "rgba(255, 255, 255, 0.75)" }}>
            {t("auth.signup.marketing.copyright")}
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="auth-scroll-hide relative w-full md:w-[600px] md:shrink-0 flex items-center justify-center overflow-y-auto p-4 sm:p-8 md:p-12 lg:px-16 md:rounded-[28px] md:border md:bg-[var(--auth-form-bg)] md:[border-color:var(--auth-card-border)] md:shadow-[var(--cc-shadow-lg)]">
        <div className="absolute top-4 right-4 z-30 sm:top-5 sm:right-5">
          <AuthThemeToggle />
        </div>
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 justify-center mb-5 px-4 py-2.5 rounded-2xl border bg-[var(--auth-form-bg)]" style={{ borderColor: "var(--auth-card-border)" }}>
            {STEP_LABELS.map((l, i) => (
              <div key={`${l}-${i}`} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="h-1 w-full rounded-full"
                  style={{
                    background: i + 1 <= progressStep ? PLUM : "var(--cc-border)",
                  }}
                />
                <span
                  className="text-[9px] font-bold uppercase"
                  style={{
                    color: i + 1 <= progressStep ? PLUM : "var(--cc-muted)",
                  }}
                >
                  {l.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>

          <div className="w-full min-h-0 pointer-events-auto rounded-[2rem] px-5 py-6 sm:p-8 shadow-[var(--cc-shadow-md)] border overflow-y-auto bg-[var(--auth-form-bg)] max-h-[calc(100vh-8rem)]" style={{ borderColor: "var(--auth-card-border)" }}>
            {isJoin && step === 1 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleLookupInviteCode();
                }}
                className="space-y-4 step-content"
              >
                <div>
                  <h2 className="text-[22px] font-black" style={{ color: PLUM }}>
                    {t("auth.signup.join.title")}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
                    {translateParams("auth.signup.join.subtitle", { step: "1" })}
                  </p>
                </div>

                <div>
                  <Label required>{t("auth.signup.join.title")}</Label>
                  <StyledInput
                    name="invite_code"
                    value={inviteCode}
                    onChange={(v) => setInviteCode(v.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase())}
                    placeholder={t("auth.signup.join.codePlaceholder")}
                    autoComplete="one-time-code"
                  />
                </div>

                {invite?.organization_name ? (
                  <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ background: "color-mix(in srgb, var(--cc-plum) 10%, transparent)", color: PLUM }}>
                    {t("auth.signup.join.joining")}{" "}
                    <span className="font-black">{invite.organization_name}</span>
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={inviteCode.length !== 6 || busy}
                  className="w-full h-11 rounded-xl text-white font-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                  style={{ background: PLUM }}
                >
                  {busy ? <Loader2 className="animate-spin" size={18} /> : null}
                  {t("auth.signup.continue")}
                </button>

                <p className="text-center text-[13px]" style={{ color: "var(--cc-muted)" }}>
                  {t("auth.signup.join.noInvite")}{" "}
                  <button
                    type="button"
                    onClick={() => setAskOpen(true)}
                    className="font-bold transition-opacity hover:opacity-80"
                    style={{ color: PLUM }}
                  >
                    {t("auth.signup.join.askCoordinator")}
                  </button>
                </p>
              </form>
            )}

            {isJoin && step === 2 && invite && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (accountDetailsValid()) setStep(3);
                }}
                className="space-y-4 step-content"
              >
                <div>
                  <h2 className="text-[22px] font-black" style={{ color: PLUM }}>
                    {t("auth.signup.join.createTitle")}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
                    {translateParams("auth.signup.join.createSubtitle", { step: "2" })}
                  </p>
                </div>

                <div>
                  <Label required>{t("auth.signup.email")}</Label>
                  <StyledInput name="email" type="email" value={form.email} onChange={() => undefined} disabled />
                  <p className="mt-1.5 text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    {t("auth.signup.org.lockedFromInvite")}
                  </p>
                </div>

                <div>
                  <Label required>{t("auth.signup.fullName")}</Label>
                  <StyledInput
                    name="full_name"
                    value={form.full_name}
                    onChange={(v) => updateField("full_name", v)}
                    placeholder={t("auth.signup.namePlaceholder")}
                    autoComplete="name"
                  />
                </div>

                <div>
                  <Label required>{t("auth.signup.password")}</Label>
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
                  {form.password ? (
                    <div className="mt-2.5">
                      <PasswordStrengthBar password={form.password} t={t} />
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Label required>{t("auth.signup.confirmPassword")}</Label>
                    {form.confirm_password ? (
                      <span className="text-[11px] font-bold" style={{ color: mismatch ? "#EF4444" : "#22C55E" }}>
                        {mismatch ? t("auth.signup.passwordMismatch") : t("auth.signup.passwordMatch")}
                      </span>
                    ) : null}
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
                    onClick={() => setStep(1)}
                    className="h-11 px-5 rounded-xl border font-black transition-all hover:bg-[var(--cc-soft)] active:scale-[0.97]"
                    style={{ borderColor: BORDER, color: PLUM }}
                  >
                    {t("auth.signup.back")}
                  </button>
                  <button
                    type="submit"
                    disabled={!accountDetailsValid()}
                    className="flex-1 h-11 rounded-xl text-white font-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                    style={{ background: PLUM }}
                  >
                    {t("auth.signup.continue")}
                  </button>
                </div>
              </form>
            )}

            {isJoin && step === 3 && invite && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (profileValid()) setStep(4);
                }}
                className="space-y-4 step-content"
              >
                <div>
                  <h2 className="text-[22px] font-black" style={{ color: PLUM }}>
                    {t("auth.signup.join.profileTitle")}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
                    {translateParams("auth.signup.join.profileSubtitle", { step: "3" })}
                  </p>
                </div>

                <div>
                  <Label>{t("auth.signup.join.profilePhoto")}</Label>
                  <div className="flex items-center gap-4">
                    <div
                      className="w-[72px] h-[72px] rounded-full border flex items-center justify-center overflow-hidden shrink-0"
                      style={{ borderColor: BORDER, background: "color-mix(in srgb, var(--cc-plum) 12%, transparent)" }}
                    >
                      {profilePhotoPreview ? (
                        <img src={profilePhotoPreview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <User size={28} style={{ color: PLUM }} />
                      )}
                    </div>
                    <div className="flex flex-col gap-2 flex-1">
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="user"
                        className="hidden"
                        onChange={(e) => onPhotoSelected(e.target.files?.[0])}
                      />
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => onPhotoSelected(e.target.files?.[0])}
                      />
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="h-9 px-3 rounded-xl border text-[13px] font-bold flex items-center gap-2"
                        style={{ borderColor: BORDER, color: PLUM }}
                      >
                        <Camera size={14} /> {t("auth.signup.join.photoCamera")}
                      </button>
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="h-9 px-3 rounded-xl border text-[13px] font-bold flex items-center gap-2"
                        style={{ borderColor: BORDER, color: PLUM }}
                      >
                        <Upload size={14} /> {t("auth.signup.join.photoUpload")}
                      </button>
                      {profilePhotoPreview ? (
                        <button
                          type="button"
                          onClick={() => {
                            setProfilePhotoFile(null);
                            setProfilePhotoPreview(null);
                          }}
                          className="text-[12px] text-left"
                          style={{ color: "var(--cc-muted)" }}
                        >
                          {t("auth.signup.join.photoRemove")}
                        </button>
                      ) : (
                        <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                          {t("auth.signup.join.photoOptional")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <Label>{t("auth.signup.field.contactNumber")}</Label>
                  <StyledInput
                    name="sp_contact_number"
                    value={form.sp_contact_number}
                    onChange={(v) => updateField("sp_contact_number", v)}
                    placeholder={t("auth.signup.placeholder.contact")}
                    required={false}
                  />
                  <p className="mt-1.5 text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    {t("auth.signup.join.optionalHint")}
                  </p>
                </div>

                <div>
                  <Label required>{t("auth.signup.field.address")}</Label>
                  <StyledInput
                    name="sp_address"
                    value={form.sp_address}
                    onChange={(v) => updateField("sp_address", v)}
                    placeholder={t("auth.signup.placeholder.address")}
                  />
                </div>

                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="h-11 px-5 rounded-xl border font-black transition-all hover:bg-[var(--cc-soft)] active:scale-[0.97]"
                    style={{ borderColor: BORDER, color: PLUM }}
                  >
                    {t("auth.signup.back")}
                  </button>
                  <button
                    type="submit"
                    disabled={!profileValid()}
                    className="flex-1 h-11 rounded-xl text-white font-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                    style={{ background: PLUM }}
                  >
                    {t("auth.signup.continue")}
                  </button>
                </div>
              </form>
            )}

            {isJoin && step === 4 && invite && (
              <div className="space-y-4 step-content">
                <div>
                  <h2 className="text-[22px] font-black" style={{ color: PLUM }}>
                    {t("auth.signup.join.reviewTitle")}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
                    {translateParams("auth.signup.join.reviewSubtitle", { step: "4" })}
                  </p>
                </div>

                <div
                  className="rounded-2xl border p-4 space-y-3"
                  style={{ borderColor: "var(--auth-card-border)", background: "color-mix(in srgb, var(--cc-plum) 8%, transparent)" }}
                >
                  <div className="flex justify-center">
                    <div
                      className="w-[72px] h-[72px] rounded-full border flex items-center justify-center overflow-hidden"
                      style={{ borderColor: BORDER, background: "color-mix(in srgb, var(--cc-plum) 12%, transparent)" }}
                    >
                      {profilePhotoPreview ? (
                        <img src={profilePhotoPreview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <User size={28} style={{ color: PLUM }} />
                      )}
                    </div>
                  </div>
                  {[
                    [t("auth.signup.join.reviewOrg"), invite.organization_name || t("auth.signup.join.reviewOrg")],
                    [t("auth.signup.fullName"), form.full_name.trim()],
                    [t("auth.signup.email"), invite.email],
                    [t("auth.signup.field.contactNumber"), form.sp_contact_number.trim() || t("auth.signup.join.notProvided")],
                    [t("auth.signup.field.address"), form.sp_address.trim()],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--cc-muted)" }}>
                        {label}
                      </p>
                      <p className="text-[14px] font-bold" style={{ color: "var(--cc-text)" }}>{value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="h-11 px-5 rounded-xl border font-black transition-all hover:bg-[var(--cc-soft)] active:scale-[0.97]"
                    style={{ borderColor: BORDER, color: PLUM }}
                  >
                    {t("auth.signup.back")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleJoinComplete()}
                    disabled={busy}
                    className="flex-1 h-11 rounded-xl text-white font-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                    style={{ background: PLUM }}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        {t("auth.signup.settingUp")}
                      </>
                    ) : (
                      t("auth.signup.completeSetup")
                    )}
                  </button>
                </div>
              </div>
            )}

            {((isJoin && step === 5) || (!isJoin && step === 3)) && (
              <div className="text-center py-6 step-content">
                <CheckCircle2 size={70} style={{ color: CORAL, margin: "0 auto" }} />
                <h2 className="text-[24px] font-black mt-5" style={{ color: PLUM }}>
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
                        : form.account_type === "small_provider" && !isJoin
                          ? "/getting-started"
                          : invite?.role === "support_worker" || form.account_type === "independent_worker"
                            ? "/worker-onboarding"
                            : "/hub",
                    )
                  }
                  className="mt-6 w-full h-11 rounded-xl text-white font-black"
                  style={{ background: PLUM }}
                >
                  {emailVerify ? t("auth.signup.goToLogin") : t("auth.signup.goToDashboard")}
                </button>
              </div>
            )}

            {!isJoin && step === 1 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (step1Valid()) setStep(2);
                }}
                className="space-y-4 step-content"
              >
                <div>
                  <h2 className="text-[22px] font-black" style={{ color: PLUM }}>
                    {t("auth.signup.title")}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
                    {t("auth.signup.subtitle")}
                  </p>
                </div>

                <div>
                  <Label required>{t("auth.signup.fullName")}</Label>
                  <StyledInput
                    name="full_name"
                    value={form.full_name}
                    onChange={(v) => updateField("full_name", v)}
                    placeholder={t("auth.signup.namePlaceholder")}
                    autoComplete="name"
                  />
                </div>

                <div>
                  <Label required>{t("auth.signup.email")}</Label>
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
                  <Label required>{t("auth.signup.password")}</Label>
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
                  {form.password ? (
                    <div className="mt-2.5">
                      <PasswordStrengthBar password={form.password} t={t} />
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Label required>{t("auth.signup.confirmPassword")}</Label>
                    {form.confirm_password ? (
                      <span className="text-[11px] font-bold" style={{ color: mismatch ? "#EF4444" : "#22C55E" }}>
                        {mismatch ? t("auth.signup.passwordMismatch") : t("auth.signup.passwordMatch")}
                      </span>
                    ) : null}
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
                    className="h-11 px-5 rounded-xl border font-black transition-all hover:bg-[var(--cc-soft)] active:scale-[0.97]"
                    style={{ borderColor: BORDER, color: PLUM }}
                  >
                    {t("auth.signup.back")}
                  </button>
                  <button
                    type="submit"
                    disabled={!step1Valid()}
                    className="flex-1 h-11 rounded-xl text-white font-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                    style={{ background: PLUM }}
                  >
                    {t("auth.signup.continue")}
                  </button>
                </div>
              </form>
            )}

            {!isJoin && step === 2 && (
              <form onSubmit={handleSubmit} className="space-y-4 step-content">
                <div>
                  <h2 className="text-[22px] font-black" style={{ color: PLUM }}>
                    {t("auth.signup.setupOrganisation")}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
                    {t("auth.signup.org.requiredHint")}
                  </p>
                </div>

                <SmallProviderFields
                  form={form}
                  updateField={updateField}
                  disabled={busy}
                  orgNameLocked={orgNameLocked}
                  t={t}
                />

                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="h-11 px-5 rounded-xl border font-black transition-all hover:bg-[var(--cc-soft)] active:scale-[0.97]"
                    style={{ borderColor: BORDER, color: PLUM }}
                  >
                    {t("auth.signup.back")}
                  </button>
                  <button
                    type="submit"
                    disabled={!step2Valid() || busy}
                    className="flex-1 h-11 rounded-xl text-white font-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                    style={{ background: PLUM }}
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
          </div>

          {showFooter && (
            <p className="text-center text-[13px] font-medium mt-5 pb-1" style={{ color: "var(--cc-muted)" }}>
              {t("auth.signup.hasAccount")}{" "}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="font-bold underline underline-offset-2"
                style={{ color: PLUM }}
              >
                {t("auth.signup.signIn")}
              </button>
            </p>
          )}
        </div>
      </div>

      {askOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setAskOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAskOpen(false);
          }}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-3xl border p-6 space-y-4 bg-[var(--auth-form-bg)] shadow-[var(--cc-shadow-md)]"
            style={{ borderColor: "var(--auth-card-border)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-coordinator-title"
          >
            <div>
              <h2 id="ask-coordinator-title" className="text-[22px] font-black" style={{ color: PLUM }}>
                {t("auth.signup.join.askTitle")}
              </h2>
              <p className="text-sm mt-1" style={{ color: "var(--cc-muted)" }}>
                {t("auth.signup.join.askIntro")}
              </p>
            </div>

            <ol className="space-y-3">
              {(
                [
                  "auth.signup.join.askStep1",
                  "auth.signup.join.askStep2",
                  "auth.signup.join.askStep3",
                  "auth.signup.join.askStep4",
                ] as const
              ).map((key, index) => (
                <li key={key} className="flex items-start gap-3">
                  <span
                    className="w-6 h-6 rounded-full text-[12px] font-black flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "color-mix(in srgb, var(--cc-plum) 14%, transparent)", color: PLUM }}
                  >
                    {index + 1}
                  </span>
                  <span className="text-[14px] leading-5" style={{ color: "var(--cc-text)" }}>
                    {t(key)}
                  </span>
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() => setAskOpen(false)}
              className="w-full h-12 rounded-xl border-[1.5px] font-black transition-colors hover:text-white"
              style={{
                borderColor: PLUM,
                color: PLUM,
                background: "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--cc-plum)";
                e.currentTarget.style.color = "#FFFFFF";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--cc-plum)";
              }}
            >
              {t("auth.signup.join.askGotIt")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Payload Builder ───────────────────────────────────────────────────────────
function buildPayload(form: FormData) {
  const accountType = form.account_type || "small_provider";
  return {
    account_type: accountType,
    organization_name: form.sp_organisation_name,
    provider_type: form.sp_provider_type || undefined,
    org_type: form.sp_org_type || undefined,
    registration_status: form.sp_registration_status || undefined,
    team_size: form.sp_team_size || undefined,
    participant_volume: form.sp_participant_volume || undefined,
    contact_number: form.sp_contact_number || undefined,
    address: form.sp_address || undefined,
    org_address: form.sp_address || undefined,
    state: form.sp_state || undefined,
    onboarding_data: {
      provider_type: form.sp_provider_type,
      org_type: form.sp_org_type,
      registration_status: form.sp_registration_status,
      team_size: form.sp_team_size,
      participant_volume: form.sp_participant_volume,
      contact_number: form.sp_contact_number,
      address: form.sp_address,
    },
  };
}

// ── Small Provider ────────────────────────────────────────────────────────────
function SmallProviderFields({
  form,
  updateField,
  disabled,
  orgNameLocked,
  t,
}: {
  form: FormData;
  updateField: (f: keyof FormData, v: string) => void;
  disabled?: boolean;
  orgNameLocked?: boolean;
  t: (key: string) => string;
}) {
  return (
    <>
      <div>
        <Label>{t("auth.signup.field.organisationName")}</Label>

        <StyledInput
          name="sp_organisation_name"
          value={form.sp_organisation_name}
          onChange={(v) => {
            if (orgNameLocked) return;
            updateField("sp_organisation_name", v);
          }}
          placeholder={t("auth.signup.placeholder.organisation")}
          disabled={disabled || orgNameLocked}
        />
        {orgNameLocked ? (
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--cc-muted)" }}>
            {t("auth.signup.org.lockedFromInvite")}
          </p>
        ) : null}
      </div>

      <div>
        <Label>{t("auth.signup.field.providerType")}</Label>

        <StyledSelect
          name="sp_provider_type"
          value={form.sp_provider_type}
          onChange={(v) => updateField("sp_provider_type", v)}
          placeholder={t("auth.signup.placeholder.selectType")}
          disabled={disabled}
          required
          options={[
            { value: "registered_ndis", label: t("auth.signup.providerType.registeredNdis") },
            { value: "unregistered", label: t("auth.signup.providerType.unregistered") },
            { value: "plan_management", label: t("auth.signup.providerType.planManagement") },
            { value: "support_coord", label: t("auth.signup.providerType.supportCoord") },
          ]}
        />
      </div>

      <div>
        <Label>{t("auth.signup.field.orgType")}</Label>

        <StyledSelect
          name="sp_org_type"
          value={form.sp_org_type}
          onChange={(v) => updateField("sp_org_type", v)}
          placeholder={t("auth.signup.placeholder.selectType")}
          disabled={disabled}
          required
          options={[
            { value: "aged_care", label: t("auth.signup.orgType.agedCare") },
            { value: "disability", label: t("auth.signup.orgType.disability") },
            { value: "aged_care_disability", label: t("auth.signup.orgType.agedCareDisability") },
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
          required
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
          required
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
          required
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
        />
      </div>

      <div>
        <Label>{t("auth.signup.field.address")}</Label>

        <StyledInput
          name="sp_address"
          value={form.sp_address}
          onChange={(v) => updateField("sp_address", v)}
          placeholder={t("auth.signup.placeholder.address")}
          disabled={disabled}
        />
      </div>

      <div>
        <Label>State</Label>

        <StyledSelect
          name="sp_state"
          value={form.sp_state}
          onChange={(v) => updateField("sp_state", v)}
          placeholder="Select your head office state"
          disabled={disabled}
          required
          options={AU_STATES}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Sets your organisation's timezone for rosters, pay and billing. Add other offices later under Settings → Branches.
        </p>
      </div>
    </>
  );
}
