import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { resendVerificationEmail } from "@/services/userService";

const PLUM = "#5533CC";
const CORAL = "#F03060";

export default function VerifyEmail() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!user?.email) return;
    setBusy(true);
    try {
      await resendVerificationEmail(user.email);
      toast({ title: "Verification email sent", description: "Check your inbox and spam folder." });
    } catch (error) {
      toast({
        title: "Could not resend email",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
      <section className="w-full rounded-[2rem] border border-[#E2DEF2] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#F5F3FC] text-[#5533CC]">
          <Mail className="h-8 w-8" />
        </div>
        <h1 className="mt-5 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Verify your email</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#7A6A9E]">
          CareScribe protects participant records by requiring verified email before full workspace access.
          We sent a verification link to <strong>{user?.email}</strong>.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={resend} disabled={busy} className="gap-2 rounded-xl" style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Resend verification email
          </Button>
          <Button variant="outline" onClick={() => navigate("/login")} className="rounded-xl">
            I have verified, sign in again
          </Button>
        </div>
        <button
          type="button"
          onClick={logout}
          className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-[#7A6A9E]"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Use a different account
        </button>
      </section>
    </div>
  );
}
