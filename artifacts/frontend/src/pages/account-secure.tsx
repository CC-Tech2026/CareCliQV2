import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { secureAccount } from "@/services/securityService";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";

function readSecureToken(): string {
  return new URLSearchParams(window.location.search).get("token") || "";
}

export default function AccountSecure() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const token = useMemo(readSecureToken, []);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  async function handleSecureAccount() {
    if (!token) {
      toast({
        title: translate("accountSecure.toast.invalidLink"),
        description: translate("accountSecure.toast.invalidLinkDesc"),
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const result = await secureAccount(token);
      setComplete(true);
      toast({ title: translate("accountSecure.successTitle"), description: result.message });
    } catch (error) {
      toast({
        title: translate("accountSecure.toast.failedTitle"),
        description: error instanceof Error ? error.message : translate("accountSecure.toast.failedDesc"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F4EDE6]">
      <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-10 md:p-12 bg-white">
        <div className="flex items-center gap-3">
          <CareCliQLogo size={54} />
          <div className="h-4 w-[1px] bg-gray-200" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6A6A77]">
            {translate("accountSecure.brandSecurity")}
          </span>
        </div>

        <div className="w-full max-w-sm mx-auto my-auto py-8">
          {complete ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <h1 className="mt-4 text-2xl font-black" style={{ color: "var(--cc-text)" }}>
                {translate("accountSecure.successTitle")}
              </h1>
              <p className="mt-2 text-sm text-[#6A6A77]">
                {translate("accountSecure.successDesc")}
              </p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-6 h-12 w-full rounded-2xl text-white text-[15px] font-black"
                style={{ background: "var(--cc-cta)" }}
              >
                {translate("accountSecure.goToSignIn")}
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-center gap-3 rounded-2xl border bg-[#FFF7F9] p-4" style={{ borderColor: "rgba(190,24,93,0.25)" }}>
                <ShieldAlert className="h-6 w-6 shrink-0" style={{ color: CORAL }} />
                <p className="text-sm font-medium text-[#1A1A2E]">
                  {translate("accountSecure.alert")}
                </p>
              </div>

              <h1 className="text-[26px] font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
                {translate("accountSecure.title")}
              </h1>
              <p className="mt-2 text-sm text-[#6A6A77]">
                {translate("accountSecure.description")}
              </p>

              <button
                type="button"
                onClick={() => void handleSecureAccount()}
                disabled={busy || !token}
                className="mt-8 h-14 w-full rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "var(--cc-cta)" }}
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {translate("accountSecure.securing")}
                  </>
                ) : (
                  translate("accountSecure.secureButton")
                )}
              </button>

              {!token ? (
                <p className="mt-4 rounded-xl border px-4 py-3 text-[13px] font-medium" style={{ borderColor: "rgba(190,24,93,0.25)", background: "rgba(190,24,93,0.06)", color: CORAL }}>
                  {translate("accountSecure.invalidLink")}
                </p>
              ) : null}
            </>
          )}
        </div>

        <p className="text-[11px] font-medium text-center lg:text-left text-gray-400">
          {translate("accountSecure.help")}
        </p>
      </div>

      <div className="hidden lg:flex lg:col-span-7 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ background: "var(--cc-text)" }} />
        <div className="relative z-10 max-w-lg rounded-[2rem] border border-white/30 bg-white/70 p-8 backdrop-blur-md">
          <h2 className="text-xl font-black text-[#1A1A2E]">{translate("accountSecure.whatNext")}</h2>
          <ul className="mt-4 space-y-3 text-sm text-[#6A6A77]">
            <li>{translate("accountSecure.step1")}</li>
            <li>{translate("accountSecure.step2")}</li>
            <li>{translate("accountSecure.step3")}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
