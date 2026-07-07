import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { persistAuthSession, getRememberDevicePreference } from "@/lib/auth-session";
import { Loader2, Eye, EyeOff, CheckCircle2, AlertTriangle } from "lucide-react";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "#FADAE4";

const ROLE_KEYS: Record<string, string> = {
  support_worker:      "auth.invite.role.supportWorker",
  allied_health:       "auth.invite.role.alliedHealth",
  support_coordinator: "auth.invite.role.supportCoordinator",
};

interface InviteInfo {
  email: string;
  role: string;
  organization_name: string | null;
  expires_at: string;
}

export default function AcceptInvite() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate: t, translateParams } = useAccessibility();
  const { updateToken } = useAuth();

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [step, setStep] = useState<"loading" | "error" | "form" | "done">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  const [fullName, setFullName]       = useState("");
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [showPass, setShowPass]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy]               = useState(false);

  function roleLabel(role: string): string {
    const key = ROLE_KEYS[role];
    return key ? t(key) : role;
  }

  useEffect(() => {
    if (!token) {
      setErrorMsg(t("auth.invite.noToken"));
      setStep("error");
      return;
    }
    fetch(`/api/invitations/validate/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || t("auth.invite.invalidOrExpired"));
        }
        return r.json();
      })
      .then((data: InviteInfo) => {
        setInvite(data);
        setStep("form");
      })
      .catch((e: Error) => {
        setErrorMsg(e.message);
        setStep("error");
      });
  }, [token, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim())     { toast({ title: t("auth.invite.toast.nameRequired"), variant: "destructive" }); return; }
    if (password.length < 8) { toast({ title: t("auth.invite.toast.passwordShort"), variant: "destructive" }); return; }
    if (password !== confirm) { toast({ title: t("auth.invite.toast.passwordMismatch"), variant: "destructive" }); return; }

    setBusy(true);
    try {
      const res = await apiFetch(`/api/invitations/accept/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim(), password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || t("auth.invite.toast.acceptFailed"));
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
      }

      setStep("done");
      toast({ title: t("auth.invite.toast.welcome"), description: t("auth.invite.toast.activated") });
      const destination = data.user?.role === "support_worker" ? "/worker-onboarding" : "/hub";
      setTimeout(() => navigate(destination), 1800);
    } catch (e) {
      toast({ title: t("auth.invite.toast.error"), description: e instanceof Error ? e.message : t("auth.invite.toast.activateFailed"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "var(--cc-bg)" }}
    >
      <div
        className="w-full max-w-md rounded-3xl p-8 shadow-xl"
        style={{ background: "rgba(255,255,255,0.96)", border: `1px solid ${BORDER}` }}
      >
        <div className="flex justify-center mb-6">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-sm"
            style={{ background: "var(--cc-text)" }}
          >
            C
          </div>
        </div>

        {step === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="animate-spin" style={{ color: PLUM }} size={32} />
            <p className="text-sm" style={{ color: "var(--cc-muted)" }}>{t("auth.invite.validating")}</p>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <AlertTriangle size={40} style={{ color: CORAL }} />
            <h2 className="text-xl font-bold" style={{ color: "var(--cc-text)" }}>{t("auth.invite.errorTitle")}</h2>
            <p className="text-sm leading-relaxed" style={{ color: "var(--cc-muted)" }}>{errorMsg}</p>
            <a
              href="/login"
              className="text-sm font-medium underline underline-offset-2"
              style={{ color: PLUM }}
            >
              {t("auth.invite.goToSignIn")}
            </a>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 size={48} style={{ color: "#22c55e" }} />
            <h2 className="text-xl font-bold" style={{ color: "var(--cc-text)" }}>{t("auth.invite.activated")}</h2>
            <p className="text-sm" style={{ color: "var(--cc-muted)" }}>{t("auth.invite.redirecting")}</p>
          </div>
        )}

        {step === "form" && invite && (
          <>
            <h1 className="text-2xl font-bold text-center mb-1" style={{ color: "var(--cc-text)" }}>
              {t("auth.invite.title")}
            </h1>
            <p className="text-sm text-center mb-6" style={{ color: "var(--cc-muted)" }}>
              {invite.organization_name
                ? <>{translateParams("auth.invite.orgInvited", { org: invite.organization_name })}</>
                : t("auth.invite.invitedAs")}
              <span
                className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{ background: "rgba(55,48,163,0.1)", color: PLUM }}
              >
                {roleLabel(invite.role)}
              </span>
            </p>

            <div className="mb-4 rounded-xl px-4 py-3 flex items-center gap-2"
              style={{ background: "rgba(55,48,163,0.04)", border: `1px solid ${BORDER}` }}>
              <span className="text-xs font-medium" style={{ color: "var(--cc-muted)" }}>{t("auth.invite.email")}</span>
              <span className="ml-auto text-sm font-medium" style={{ color: "var(--cc-text)" }}>{invite.email}</span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium" style={{ color: "var(--cc-text)" }}>{t("auth.invite.fullName")}</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("auth.invite.namePlaceholder")}
                  required
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                  style={{ border: `1.5px solid ${BORDER}`, color: "var(--cc-text)" }}
                  onFocus={(e) => (e.target.style.borderColor = PLUM)}
                  onBlur={(e) => (e.target.style.borderColor = BORDER)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium" style={{ color: "var(--cc-text)" }}>{t("auth.invite.createPassword")}</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.invite.passwordPlaceholder")}
                    required
                    className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none transition-all"
                    style={{ border: `1.5px solid ${BORDER}`, color: "var(--cc-text)" }}
                    onFocus={(e) => (e.target.style.borderColor = PLUM)}
                    onBlur={(e) => (e.target.style.borderColor = BORDER)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--cc-muted)" }}
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium" style={{ color: "var(--cc-text)" }}>{t("auth.invite.confirmPassword")}</label>
                <div className="relative">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={t("auth.invite.confirmPlaceholder")}
                    required
                    className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none transition-all"
                    style={{ border: `1.5px solid ${confirm && confirm !== password ? CORAL : BORDER}`, color: "var(--cc-text)" }}
                    onFocus={(e) => (e.target.style.borderColor = confirm !== password ? CORAL : PLUM)}
                    onBlur={(e) => (e.target.style.borderColor = confirm && confirm !== password ? CORAL : BORDER)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--cc-muted)" }}
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {confirm && confirm !== password && (
                  <p className="text-xs" style={{ color: CORAL }}>{t("auth.invite.passwordMismatch")}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
                style={{
                  background: "var(--cc-cta)",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                {t("auth.invite.activate")}
              </button>
            </form>

            <p className="text-center text-xs mt-5" style={{ color: "var(--cc-muted)" }}>
              {t("auth.invite.hasAccount")}{" "}
              <a href="/login" className="font-medium underline underline-offset-2" style={{ color: PLUM }}>
                {t("auth.invite.signIn")}
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
