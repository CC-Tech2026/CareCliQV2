import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { ArrowLeft, CheckCircle2, Loader2, LockKeyhole } from "lucide-react";
import { PasswordNativeInput } from "@/components/PasswordInput";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";

const PLUM = "var(--cc-plum)";
const BORDER = "#FADAE4";

function readRecoveryParams(): { access_token: string; token_hash: string } {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return {
    access_token: hash.get("access_token") || query.get("access_token") || "",
    token_hash: hash.get("token_hash") || query.get("token_hash") || "",
  };
}

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate: t } = useAccessibility();
  const recovery = useMemo(readRecoveryParams, []);
  const hasRecoveryToken = !!(recovery.access_token || recovery.token_hash);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!hasRecoveryToken) {
      toast({ title: t("auth.reset.toast.expired"), description: t("auth.reset.toast.requestNew"), variant: "destructive" });
      return;
    }
    if (password.length < 10) {
      toast({ title: t("auth.reset.toast.tooShort"), description: t("auth.reset.toast.minChars"), variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: t("auth.reset.toast.mismatch"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: recovery.access_token, token_hash: recovery.token_hash, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || t("auth.reset.error.updateFailed"));
      }
      setComplete(true);
      toast({ title: t("auth.reset.toast.updated"), description: t("auth.reset.toast.canSignIn") });
    } catch (error) {
      toast({
        title: t("auth.reset.toast.failed"),
        description: error instanceof Error ? error.message : t("auth.reset.toast.requestLink"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#ECECEC]">
      <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-10 md:p-12 bg-white">
        <div className="flex items-center gap-3">
          <CareCliQLogo size={54} />
          <div className="h-4 w-[1px] bg-gray-200" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6A6A77]">{t("auth.reset.workspace")}</span>
        </div>

        <div className="w-full max-w-sm mx-auto my-auto py-8">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold mb-6"
            style={{ color: PLUM }}
          >
            <ArrowLeft className="h-4 w-4" /> {t("auth.reset.backToLogin")}
          </button>

          <div className="mb-8">
            <h1 className="text-[26px] font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
              {t("auth.reset.title")}
            </h1>
            <p className="text-[14px] font-medium mt-1" style={{ color: "var(--cc-muted)" }}>
              {t("auth.reset.subtitle")}
            </p>
          </div>

          {complete ? (
            <div className="rounded-2xl border p-5" style={{ borderColor: BORDER, background: "var(--cc-soft)" }}>
              <CheckCircle2 className="h-8 w-8 mb-3" style={{ color: PLUM }} />
              <p className="text-[15px] font-bold" style={{ color: "var(--cc-text)" }}>{t("auth.reset.updated")}</p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-4 h-11 px-5 rounded-2xl text-white font-bold transition-all hover:opacity-90 active:scale-[0.97]"
                style={{ background: "var(--cc-cta)" }}
              >
                {t("auth.reset.signIn")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {!hasRecoveryToken && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {t("auth.reset.missingToken")}
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: PLUM }}>
                  {t("auth.reset.newPassword")}
                </label>
                <div className="relative">
                  <LockKeyhole className="absolute left-4 top-1/2 z-10 -translate-y-1/2 h-4 w-4 text-[#6A6A77]" />
                  <PasswordNativeInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.reset.passwordPlaceholder")}
                    required
                    disabled={busy}
                    className="w-full h-12 pl-11 rounded-2xl text-[14px] font-medium outline-none border bg-[#ECECEC]"
                    style={{ borderColor: BORDER, color: "var(--cc-text)" }}
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: PLUM }}>
                  {t("auth.reset.confirmPassword")}
                </label>
                <PasswordNativeInput
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t("auth.reset.confirmPlaceholder")}
                  required
                  disabled={busy}
                  className="w-full h-12 px-4 rounded-2xl text-[14px] font-medium outline-none border bg-[#ECECEC]"
                  style={{ borderColor: BORDER, color: "var(--cc-text)" }}
                />
              </div>
              <button
                type="submit"
                disabled={busy || !hasRecoveryToken || password.length < 10 || password !== confirm}
                className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                style={{ background: "var(--cc-cta)" }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("auth.reset.submit")}
              </button>
            </form>
          )}
        </div>

        <p className="text-[11px] font-medium text-gray-400">
          {t("auth.reset.footer")}
        </p>
      </div>

      <div className="hidden lg:flex lg:col-span-7 items-center justify-center p-12" style={{ background: "#7C3AED" }}>
        <img src="/login_welcome.jpg" alt="CareCliQ workspace" className="max-w-xl w-full rounded-[2rem] shadow-2xl" />
      </div>
    </div>
  );
}
