import { useState } from "react";
import { useLocation } from "wouter";
import { Building2, Loader2, Star, User, Users } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { ACCENTS, SIGNATURE, FLAG, INK, QUIET_INK, DISPLAY_FONT, Card, GetStartedShell, Pill } from "./shared";

export type PlanTier = "micro" | "small" | "medium";

export const TIERS: Array<{
  tier: PlanTier;
  name: string;
  icon: typeof User;
  range: string;
  price: number;
  perPerson?: string;
  note: string;
}> = [
  {
    tier: "micro",
    name: "Micro",
    icon: User,
    range: "1 to 4 people",
    price: 125,
    note: "For a solo operator or a small independent team getting started.",
  },
  {
    tier: "small",
    name: "Small",
    icon: Users,
    range: "5 to 10 people",
    price: 250,
    perPerson: "$41.67 per person",
    note: "For a growing coordination team managing more shifts and staff.",
  },
  {
    tier: "medium",
    name: "Medium",
    icon: Building2,
    range: "11 to 25 people",
    price: 400,
    note: "For an established, multi worker provider running at scale.",
  },
];

const SHARED_FEATURES = [
  "Unlimited participants and notes",
  "Shift-linked progress notes, written in the moment",
  "Compliance and audit exports, ready any time",
  "One record per person, visible to the whole team",
];

type Props = {
  /** Set when the visitor arrived via the Recommendation step. Unset (skipped
   * straight to pricing) — no plan gets any recommendation treatment at all. */
  recommendedTier?: PlanTier;
};

export function PricingStep({ recommendedTier }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);

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

  return (
    <GetStartedShell step={6} wide>
      <Pill accent={ACCENTS[0]}>Plans</Pill>
      <h1 className="mt-2 text-2xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
        Documentation that holds up when it's checked.
      </h1>
      <p className="mt-2 max-w-md text-[13px] leading-snug" style={{ color: QUIET_INK }}>
        The first month is free. After that, pick the plan sized to your team. Every plan runs
        the same platform, so there's nothing to upgrade into later.
      </p>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {TIERS.map(({ tier, name, icon: Icon, range, price, perPerson }, i) => {
          const isRecommended = recommendedTier === tier;
          const accent = ACCENTS[i];
          return (
            <Card key={tier} selected={isRecommended} className="relative flex flex-col !p-4">
              {isRecommended && (
                <span
                  className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                  style={{ background: SIGNATURE }}
                >
                  <Star size={10} fill="white" /> Recommended
                </span>
              )}
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: accent.bg, color: accent.fg }}
                >
                  <Icon size={16} />
                </span>
                <div>
                  <h2 className="text-[15px] font-black leading-tight" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
                    {name}
                  </h2>
                  <p className="text-[11px] font-semibold" style={{ color: QUIET_INK }}>{range}</p>
                </div>
              </div>

              <ul className="mt-3 flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--auth-card-border)" }}>
                {SHARED_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 pt-1.5 text-[11.5px] leading-snug" style={{ color: INK }}>
                    <span className="mt-0.5 shrink-0" style={{ color: SIGNATURE }}>&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex items-baseline gap-1">
                <span
                  className="text-3xl font-black"
                  style={{ color: FLAG, fontFamily: DISPLAY_FONT, fontVariantNumeric: "tabular-nums" }}
                >
                  ${price}
                </span>
                <span className="text-[13px] font-semibold" style={{ color: QUIET_INK }}>/ month</span>
                {perPerson && (
                  <span className="text-[10.5px] font-semibold" style={{ color: QUIET_INK }}>&nbsp;· {perPerson}</span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleChoose(tier)}
                disabled={busyTier !== null}
                className="mt-3 w-full h-9 rounded-full text-white font-bold text-[13px] disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                style={{ background: SIGNATURE, boxShadow: "var(--cc-shadow-sm)" }}
              >
                {busyTier === tier ? <Loader2 size={13} className="animate-spin" /> : null}
                Start free trial
              </button>
            </Card>
          );
        })}
      </div>

      <p className="text-[12.5px] font-medium mt-5" style={{ color: QUIET_INK }}>
        Already have an account?{" "}
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="font-bold underline underline-offset-2"
          style={{ color: INK }}
        >
          Sign in
        </button>
      </p>
    </GetStartedShell>
  );
}
