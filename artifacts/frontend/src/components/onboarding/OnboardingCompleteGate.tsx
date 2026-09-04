import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, ShieldCheck, GraduationCap, PartyPopper } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getMyCompletionStatus,
  markMyCompletionSeen,
  type MyCompletionStats,
} from "@/services/inductionService";
import { getOrganizationBranding, type OrganizationBranding } from "@/services/organizationBrandingService";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

const EXCLUDED_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/accept-invite"];

/** Shown once when a support worker reaches Active (cleared Credentials and
 * Training), closing the loop on the onboarding pipeline. A different moment
 * from WelcomeScreenGate (shown at first login, before induction starts):
 * this is the other end of the same journey. */
export function OnboardingCompleteGate() {
  const { isAuthenticated, user } = useAuth();
  const [location, navigate] = useLocation();
  const [show, setShow] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [stats, setStats] = useState<MyCompletionStats | null>(null);

  const eligible =
    isAuthenticated &&
    user?.role === "support_worker" &&
    !EXCLUDED_PATHS.some((p) => location === p || location.startsWith(p + "/"));

  useEffect(() => {
    if (!eligible || checked) return;
    let cancelled = false;
    getMyCompletionStatus()
      .then((res) => {
        if (!cancelled && res.onboarding_completed && !res.onboarding_completed_seen_at) {
          setStats(res.stats);
          setShow(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eligible, checked]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    getOrganizationBranding()
      .then((data) => { if (!cancelled) setBranding(data); })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [show]);

  if (!show) return null;

  async function handleContinue(destination: string) {
    setDismissing(true);
    try {
      await markMyCompletionSeen();
    } catch {
      // Non-critical: worst case this screen shows again next login.
    }
    setShow(false);
    navigate(destination);
  }

  const orgName = branding?.display_name;
  const accent = branding?.brand_accent_color || PLUM;
  const firstName = user?.full_name?.split(" ")[0];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-card text-center shadow-xl">
        <div
          className="relative overflow-hidden px-8 pb-2 pt-9"
          style={{ background: `linear-gradient(180deg, ${accent}14, transparent)` }}
        >
          <div className="absolute -right-10 -top-14 h-32 w-32 rounded-full" style={{ background: `${accent}12` }} />
          <div className="absolute -left-12 top-6 h-24 w-24 rounded-full" style={{ background: `${accent}0d` }} />

          <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: SOFT }}>
            <PartyPopper size={24} style={{ color: PLUM }} />
          </div>

          <h1 className="relative mt-5 text-2xl font-black tracking-tight" style={{ color: TEXT }}>
            {firstName ? `You made it, ${firstName}!` : "You made it!"}
          </h1>
          <p className="relative mt-2 text-sm font-medium" style={{ color: MUTED }}>
            Welcome to the team{orgName ? ` at ${orgName}` : ""}. Credentials, training, all of
            it: you're officially active and ready to take shifts.
          </p>
        </div>

        <div className="px-8 pb-8">
          {stats && (stats.credentials_verified > 0 || stats.training_completed > 0) && (
            <div className="mb-6 grid grid-cols-2 gap-3">
              {stats.credentials_verified > 0 && (
                <div className="rounded-xl border p-3 text-left" style={{ borderColor: BORDER }}>
                  <ShieldCheck size={16} style={{ color: PLUM }} />
                  <p className="mt-1.5 text-lg font-black" style={{ color: TEXT }}>{stats.credentials_verified}</p>
                  <p className="text-[11px] font-medium" style={{ color: MUTED }}>
                    {stats.credentials_verified === 1 ? "credential verified" : "credentials verified"}
                  </p>
                </div>
              )}
              {stats.training_completed > 0 && (
                <div className="rounded-xl border p-3 text-left" style={{ borderColor: BORDER }}>
                  <GraduationCap size={16} style={{ color: PLUM }} />
                  <p className="mt-1.5 text-lg font-black" style={{ color: TEXT }}>{stats.training_completed}</p>
                  <p className="text-[11px] font-medium" style={{ color: MUTED }}>
                    {stats.training_completed === 1 ? "module completed" : "modules completed"}
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => handleContinue("/my-shifts")}
            disabled={dismissing}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black text-white disabled:opacity-50"
            style={{ background: accent }}
          >
            {dismissing ? "Loading…" : "View my shifts"}
            {!dismissing && <ArrowRight size={16} />}
          </button>
          <button
            type="button"
            onClick={() => handleContinue("/worker-onboarding")}
            disabled={dismissing}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold disabled:opacity-50"
            style={{ color: MUTED }}
          >
            Not now
          </button>

          <p className="mt-3 text-[11px] font-medium" style={{ color: "var(--cc-muted)", opacity: 0.7 }}>
            Powered by CareCliQ
          </p>
        </div>
      </div>
    </div>
  );
}
