import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getMyWelcomeStatus, markMyWelcomeSeen } from "@/services/inductionService";
import { getOrganizationBranding, type OrganizationBranding } from "@/services/organizationBrandingService";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

const EXCLUDED_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/accept-invite"];

/** First-login welcome screen, shown once before a new support worker sees
 * anything else, then routes into induction. Only support_workers get this —
 * it's the on-ramp into the induction checklist, not a general app feature. */
export function WelcomeScreenGate() {
  const { isAuthenticated, user } = useAuth();
  const [location, navigate] = useLocation();
  const [show, setShow] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);

  const eligible =
    isAuthenticated &&
    user?.role === "support_worker" &&
    !EXCLUDED_PATHS.some((p) => location === p || location.startsWith(p + "/"));

  useEffect(() => {
    if (!eligible || checked) return;
    let cancelled = false;
    getMyWelcomeStatus()
      .then((res) => {
        if (!cancelled && !res.welcome_seen_at) setShow(true);
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

  async function handleContinue() {
    setDismissing(true);
    try {
      await markMyWelcomeSeen();
    } catch {
      // Non-critical — worst case the welcome screen shows again next login.
    }
    setShow(false);
    navigate("/worker-induction");
  }

  const orgName = branding?.display_name;
  const accent = branding?.brand_accent_color || PLUM;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl overflow-hidden" style={{ background: "var(--cc-soft)" }}>
          {branding?.logo_url ? (
            <img src={branding.logo_url} alt={orgName || ""} className="h-full w-full object-contain" />
          ) : (
            <Sparkles size={24} style={{ color: PLUM }} />
          )}
        </div>
        <h1 className="mt-5 text-2xl font-black tracking-tight" style={{ color: TEXT }}>
          {orgName
            ? `Welcome to the team at ${orgName}`
            : `Welcome${user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}`}
        </h1>
        <p className="mt-2 text-sm font-medium" style={{ color: MUTED }}>
          Glad to have you on board. Let's get you set up with a quick induction before your first shift.
        </p>
        <button
          type="button"
          onClick={handleContinue}
          disabled={dismissing}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black text-white disabled:opacity-50"
          style={{ background: accent }}
        >
          {dismissing ? "Loading…" : "Get started"}
          {!dismissing && <ArrowRight size={16} />}
        </button>
        <p className="mt-5 text-[11px] font-medium" style={{ color: "var(--cc-muted)", opacity: 0.7 }}>
          Powered by CareCliQ
        </p>
      </div>
    </div>
  );
}
