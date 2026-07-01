import { useState } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { ArrowLeft, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { CareCliQLogoSVG } from "@/components/CareCliQLogoSVG";

const PLUM = "var(--cc-plum)";
const BORDER = "#C7D2FE";

export default function ForgotPassword() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate: t } = useAccessibility();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || t("auth.forgot.error.sendFailed"));
      }
      setSent(true);
      toast({ title: t("auth.forgot.toast.sent"), description: t("auth.forgot.toast.sentDesc") });
    } catch (error) {
      toast({
        title: t("auth.forgot.toast.failed"),
        description: error instanceof Error ? error.message : t("auth.forgot.toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F8F8FE]">
      <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-10 md:p-12 bg-white">
        <div className="flex items-center gap-3">
          <CareCliQLogoSVG size={54} />
          <div className="h-4 w-[1px] bg-gray-200" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B7280]">{t("auth.forgot.workspace")}</span>
        </div>

        <div className="w-full max-w-sm mx-auto my-auto py-8">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold mb-6"
            style={{ color: PLUM }}
          >
            <ArrowLeft className="h-4 w-4" /> {t("auth.forgot.backToLogin")}
          </button>

          <div className="mb-8">
            <h1 className="text-[26px] font-black tracking-tight" style={{ color: PLUM }}>
              {t("auth.forgot.title")}
            </h1>
            <p className="text-[14px] font-medium mt-1" style={{ color: "var(--cc-muted)" }}>
              {t("auth.forgot.subtitle")}
            </p>
          </div>

          {sent ? (
            <div className="rounded-2xl border p-5" style={{ borderColor: BORDER, background: "var(--cc-soft)" }}>
              <CheckCircle2 className="h-8 w-8 mb-3" style={{ color: PLUM }} />
              <p className="text-[15px] font-bold" style={{ color: "var(--cc-text)" }}>{t("auth.forgot.checkEmail")}</p>
              <p className="text-[13px] mt-1 leading-relaxed" style={{ color: "var(--cc-muted)" }}>
                {t("auth.forgot.sentMessage")}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: PLUM }}>
                  {t("auth.forgot.email")}
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("auth.forgot.emailPlaceholder")}
                    required
                    disabled={busy}
                    className="w-full h-12 pl-11 pr-4 rounded-2xl text-[14px] font-medium outline-none border bg-[#F8F8FE]"
                    style={{ borderColor: BORDER, color: "var(--cc-text)" }}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="w-full h-14 rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: PLUM }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("auth.forgot.submit")}
              </button>
            </form>
          )}
        </div>

        <p className="text-[11px] font-medium text-gray-400">
          {t("auth.forgot.footer")}
        </p>
      </div>

      <div className="hidden lg:flex lg:col-span-7 items-center justify-center p-12 bg-gradient-to-br from-[#BE185D] via-[#9B5DE5] to-[#3730A3]">
        <img src="/login_welcome.jpg" alt="CareCliQ workspace" className="max-w-xl w-full rounded-[2rem] shadow-2xl" />
      </div>
    </div>
  );
}
