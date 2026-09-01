import { useLocation } from "wouter";
import { Lock, ShieldCheck, GraduationCap, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

const REASON_COPY: Record<string, { title: string; body: string }> = {
  credentials: {
    title: "Your credentials are incomplete",
    body: "One or more mandatory credentials are missing, rejected, or overdue. Complete them below to regain full access to your account.",
  },
  training: {
    title: "Your mandatory training is incomplete",
    body: "One or more mandatory training modules are overdue. Complete them below to regain full access to your account.",
  },
  credentials_training: {
    title: "Your credentials and training are incomplete",
    body: "Mandatory credentials and mandatory training are both outstanding. Complete both below to regain full access to your account.",
  },
};

export default function AccountDeactivated() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  const reason = user?.deactivation_reason ?? null;
  const copy = reason ? REASON_COPY[reason] : null;
  const showCredentials = reason === "credentials" || reason === "credentials_training";
  const showTraining = reason === "training" || reason === "credentials_training";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-4">
      <section className="w-full rounded-[2rem] border p-8 text-center shadow-sm" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full" style={{ background: SOFT }}>
          <Lock className="h-8 w-8" style={{ color: PLUM }} />
        </div>

        <h1 className="mt-5 text-2xl font-black tracking-tight" style={{ color: TEXT }}>
          {copy ? copy.title : "Your account has been deactivated"}
        </h1>

        <p className="mx-auto mt-3 max-w-lg text-sm leading-6" style={{ color: MUTED }}>
          {copy ? copy.body : "Reach out to your organisation admin for details on why your account was deactivated and what's needed to reactivate it."}
        </p>

        {user?.deactivation_note && (
          <div className="mx-auto mt-5 max-w-lg rounded-xl border p-4 text-left" style={{ borderColor: BORDER, background: SOFT }}>
            <p className="text-xs font-black uppercase tracking-wide" style={{ color: PLUM }}>Note from your admin</p>
            <p className="mt-1 text-sm leading-6" style={{ color: TEXT }}>{user.deactivation_note}</p>
          </div>
        )}

        {(showCredentials || showTraining) && (
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            {showCredentials && (
              <Button onClick={() => navigate("/worker-onboarding")} className="gap-2 rounded-xl" style={{ background: "var(--cc-cta)" }}>
                <ShieldCheck className="h-4 w-4" />
                Go to my credentials
              </Button>
            )}
            {showTraining && (
              <Button onClick={() => navigate("/worker/training")} className="gap-2 rounded-xl" style={{ background: "var(--cc-cta)" }}>
                <GraduationCap className="h-4 w-4" />
                Go to my training
              </Button>
            )}
          </div>
        )}

        {!copy && (
          <p className="mx-auto mt-6 max-w-lg text-xs leading-6" style={{ color: MUTED }}>
            Only your organisation admin can reactivate your account. No other pages are available while your account is deactivated.
          </p>
        )}

        <button
          type="button"
          onClick={logout}
          className="mt-6 inline-flex items-center gap-1.5 text-xs font-bold"
          style={{ color: MUTED }}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </section>
    </div>
  );
}
