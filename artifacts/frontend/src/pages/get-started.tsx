import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Check, Loader2, MailCheck, ShieldCheck, FileCheck2, Users } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const DISPLAY_FONT = "var(--font-display)";

type PlanTier = "micro" | "small" | "medium";

const TIERS: Array<{
  tier: PlanTier;
  name: string;
  seats: string;
  price: number;
  perUser?: string;
  blurb: string;
  popular?: boolean;
}> = [
  {
    tier: "micro",
    name: "Micro",
    seats: "1-4 users",
    price: 125,
    blurb: "For a solo operator or small independent team getting started.",
  },
  {
    tier: "small",
    name: "Small",
    seats: "5-10 users",
    price: 250,
    perUser: "$41.67 per user",
    blurb: "For growing coordination teams managing more shifts and staff.",
    popular: true,
  },
  {
    tier: "medium",
    name: "Medium",
    seats: "11-25 users",
    price: 400,
    blurb: "For established, multi-worker providers running at scale.",
  },
];

const FEATURES = [
  "All CareCliQ features included",
  "Unlimited progress notes and participants",
  "Audit-ready evidence exports",
];

const TRUST_ROW = [
  { icon: ShieldCheck, label: "Audit-ready NDIS documentation" },
  { icon: Users, label: "Unlimited participants, every tier" },
  { icon: FileCheck2, label: "No lock-in — cancel anytime" },
];

export default function GetStarted() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [paidSuccess, setPaidSuccess] = useState(false);

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success") {
      setPaidSuccess(true);
    } else if (checkout === "canceled") {
      toast({ title: "Checkout canceled", description: "No charge was made — pick a plan whenever you're ready." });
    }
    if (checkout) {
      window.history.replaceState({}, "", "/get-started");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleChoose(tier: PlanTier) {
    if (busyTier) return;
    setBusyTier(tier);
    try {
      const res = await apiFetch("/api/platform-billing/signup/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_tier: tier }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : "Could not start checkout.");
      }
      const data = await res.json();
      if (!data.checkout_url) throw new Error("Could not start checkout.");
      window.location.href = data.checkout_url;
    } catch (err) {
      toast({
        title: "Couldn't start checkout",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setBusyTier(null);
    }
  }

  if (paidSuccess) {
    return (
      <div className="relative min-h-screen bg-[var(--auth-shell-bg)] flex items-center justify-center px-6 overflow-hidden">
        <GlowBackdrop />
        <div
          className="relative w-full max-w-md rounded-3xl border p-8 text-center space-y-4 bg-[var(--auth-form-bg)] shadow-[var(--cc-shadow-lg)]"
          style={{ borderColor: "var(--auth-card-border)" }}
        >
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: `color-mix(in srgb, ${CORAL} 14%, transparent)` }}
          >
            <MailCheck size={30} style={{ color: CORAL }} />
          </div>
          <h1 className="text-2xl font-black" style={{ color: "var(--cc-text)", fontFamily: DISPLAY_FONT }}>
            Check your email
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--cc-muted)" }}>
            Payment confirmed — we've sent a welcome email with a link to set your password and
            get started. It usually arrives within a minute or two.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-2 font-bold underline underline-offset-2 text-sm"
            style={{ color: PLUM }}
          >
            Already set your password? Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[var(--auth-shell-bg)] overflow-hidden">
      <GlowBackdrop />
      <div className="relative max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-14">
          <CareCliQLogo size={40} />
          <AuthThemeToggle />
        </div>

        <div className="text-center mb-12 max-w-2xl mx-auto">
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider mb-5"
            style={{ background: `color-mix(in srgb, ${PLUM} 12%, transparent)`, color: PLUM }}
          >
            1 month free trial
          </div>
          <h1
            className="text-4xl sm:text-5xl font-black leading-[1.1] tracking-tight"
            style={{ color: "var(--cc-text)", fontFamily: DISPLAY_FONT }}
          >
            Audit-ready NDIS documentation,
            <br />
            <span style={{ color: PLUM }}>without the paperwork</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "var(--cc-muted)" }}>
            Pick the plan that fits your team size — every plan gets the full CareCliQ platform.
            No feature gates, no per-participant fees.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
          {TIERS.map(({ tier, name, seats, price, perUser, blurb, popular }) => (
            <div
              key={tier}
              className="relative rounded-3xl border p-7 flex flex-col bg-[var(--auth-form-bg)] transition-transform"
              style={{
                borderColor: popular ? PLUM : "var(--auth-card-border)",
                borderWidth: popular ? 2 : 1,
                boxShadow: popular ? "var(--cc-shadow-lg)" : "var(--cc-shadow-sm)",
                transform: popular ? "translateY(-8px)" : undefined,
              }}
            >
              {popular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-black text-white whitespace-nowrap"
                  style={{ background: PLUM }}
                >
                  Most popular
                </div>
              )}
              <h2 className="text-lg font-black" style={{ color: "var(--cc-text)", fontFamily: DISPLAY_FONT }}>
                {name}
              </h2>
              <p className="text-[12px] font-bold uppercase tracking-wider mt-1" style={{ color: "var(--cc-muted)" }}>
                {seats}
              </p>
              <p className="mt-3 text-[13px] leading-relaxed min-h-[36px]" style={{ color: "var(--cc-muted)" }}>
                {blurb}
              </p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-black" style={{ color: "var(--cc-text)", fontFamily: DISPLAY_FONT }}>
                  ${price}
                </span>
                <span className="text-sm font-bold" style={{ color: "var(--cc-muted)" }}>/ month</span>
              </div>
              {perUser && (
                <p className="text-[11px] font-semibold mt-0.5" style={{ color: CORAL }}>
                  works out to {perUser}
                </p>
              )}

              <div className="my-5 h-px" style={{ background: "var(--auth-card-border)" }} />

              <ul className="space-y-2.5 flex-1">
                {FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px]" style={{ color: "var(--cc-text)" }}>
                    <Check size={16} style={{ color: CORAL }} className="shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => void handleChoose(tier)}
                disabled={busyTier !== null}
                className="mt-6 w-full h-11 rounded-xl text-white font-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                style={{ background: popular ? PLUM : "var(--cc-text)" }}
              >
                {busyTier === tier ? <Loader2 size={16} className="animate-spin" /> : null}
                Start free trial
              </button>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {TRUST_ROW.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--cc-muted)" }}>
              <Icon size={15} style={{ color: PLUM }} />
              {label}
            </div>
          ))}
        </div>

        <p className="text-center text-[13px] font-medium mt-10 pb-4" style={{ color: "var(--cc-muted)" }}>
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="font-bold underline underline-offset-2"
            style={{ color: PLUM }}
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}

/** Two soft, low-opacity brand-color glows behind the page content — adds
 * depth without competing with the pricing cards or hurting text contrast. */
function GlowBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full blur-3xl"
        style={{ background: `color-mix(in srgb, ${PLUM} 18%, transparent)` }}
      />
      <div
        className="absolute -bottom-40 -right-24 h-[480px] w-[480px] rounded-full blur-3xl"
        style={{ background: `color-mix(in srgb, ${CORAL} 16%, transparent)` }}
      />
    </div>
  );
}
