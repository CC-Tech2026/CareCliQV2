import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { resendVerificationEmail } from "@/services/userService";

const PLUM = "var(--cc-plum)";

export default function VerifyEmail() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!user?.email) return;
    setBusy(true);
    try {
      await resendVerificationEmail(user.email);
      toast({
        title: translate("verifyEmail.toast.sentTitle"),
        description: translate("verifyEmail.toast.sentDesc"),
      });
    } catch (error) {
      toast({
        title: translate("verifyEmail.toast.resendFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
      <section className="w-full rounded-[2rem] border border-[#E8E8EA] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#ECECEC] text-[#E8457A]">
          <Mail className="h-8 w-8" />
        </div>
        <h1 className="mt-5 text-3xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
          {translate("verifyEmail.title")}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#6A6A77]">
          {translateParams("verifyEmail.description", { email: user?.email ?? "" })}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={resend} disabled={busy} className="gap-2 rounded-xl" style={{ background: "var(--cc-cta)" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {translate("verifyEmail.resend")}
          </Button>
          <Button variant="outline" onClick={() => navigate("/login")} className="rounded-xl">
            {translate("verifyEmail.signInAgain")}
          </Button>
        </div>
        <button
          type="button"
          onClick={logout}
          className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-[#6A6A77]"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {translate("verifyEmail.differentAccount")}
        </button>
      </section>
    </div>
  );
}
