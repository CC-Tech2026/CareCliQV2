import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { secureAccount } from "@/services/securityService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const BORDER = "#D8D0F0";

function readSecureToken(): string {
  return new URLSearchParams(window.location.search).get("token") || "";
}

export default function AccountSecure() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const token = useMemo(readSecureToken, []);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  async function handleSecureAccount() {
    if (!token) {
      toast({
        title: "Invalid link",
        description: "This secure link is missing or expired.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const result = await secureAccount(token);
      setComplete(true);
      toast({ title: "Account secured", description: result.message });
    } catch (error) {
      toast({
        title: "Could not secure account",
        description: error instanceof Error ? error.message : "This link may have expired.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F5F3FC]">
      <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-10 md:p-12 bg-white">
        <div className="flex items-center gap-3">
          <img src="/carecliQ_logo.png" alt="CareCliQ" className="h-9 w-auto object-contain" />
          <div className="h-4 w-[1px] bg-gray-200" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7A6A9E]">Security</span>
        </div>

        <div className="w-full max-w-sm mx-auto my-auto py-8">
          {complete ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <h1 className="mt-4 text-2xl font-black" style={{ color: PLUM }}>
                Account secured
              </h1>
              <p className="mt-2 text-sm text-[#7A6A9E]">
                All active sessions were signed out. Sign in again with your password and enable two-factor authentication if you have not already.
              </p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-6 h-12 w-full rounded-2xl text-white text-[15px] font-black"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                Go to sign in
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-center gap-3 rounded-2xl border bg-[#FFF7F9] p-4" style={{ borderColor: "rgba(240,48,96,0.25)" }}>
                <ShieldAlert className="h-6 w-6 shrink-0" style={{ color: CORAL }} />
                <p className="text-sm font-medium text-[#1E1640]">
                  If you did not sign in recently, secure your account now to sign out all devices.
                </p>
              </div>

              <h1 className="text-[26px] font-black tracking-tight" style={{ color: PLUM }}>
                Secure your account
              </h1>
              <p className="mt-2 text-sm text-[#7A6A9E]">
                This will immediately revoke all active sessions and remove trusted devices.
              </p>

              <button
                type="button"
                onClick={() => void handleSecureAccount()}
                disabled={busy || !token}
                className="mt-8 h-14 w-full rounded-2xl text-white text-[15px] font-black flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Securing account…
                  </>
                ) : (
                  "Secure my account"
                )}
              </button>

              {!token ? (
                <p className="mt-4 rounded-xl border px-4 py-3 text-[13px] font-medium" style={{ borderColor: "rgba(240,48,96,0.25)", background: "rgba(240,48,96,0.06)", color: CORAL }}>
                  This secure link is invalid or has expired.
                </p>
              ) : null}
            </>
          )}
        </div>

        <p className="text-[11px] font-medium text-center lg:text-left text-gray-400">
          Need help? Contact your organisation administrator.
        </p>
      </div>

      <div className="hidden lg:flex lg:col-span-7 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }} />
        <div className="relative z-10 max-w-lg rounded-[2rem] border border-white/30 bg-white/70 p-8 backdrop-blur-md">
          <h2 className="text-xl font-black text-[#1E1640]">What happens next?</h2>
          <ul className="mt-4 space-y-3 text-sm text-[#7A6A9E]">
            <li>All signed-in devices will be logged out immediately.</li>
            <li>Trusted devices will be removed and 2FA will be required again on new sign-ins.</li>
            <li>Sign in with your password and review your security settings.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
