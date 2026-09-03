import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { SIGNATURE, FLAG, INK, QUIET_INK, RULE, DISPLAY_FONT, GetStartedShell } from "./shared";

export type PlanTier = "micro" | "small" | "medium";

const TIERS: Array<{
  tier: PlanTier;
  name: string;
  range: string;
  price: number;
  perPerson?: string;
  note: string;
}> = [
  {
    tier: "micro",
    name: "Micro",
    range: "1 to 4 people",
    price: 125,
    note: "For a solo operator or a small independent team getting started.",
  },
  {
    tier: "small",
    name: "Small",
    range: "5 to 10 people",
    price: 250,
    perPerson: "$41.67 per person",
    note: "For a growing coordination team managing more shifts and staff.",
  },
  {
    tier: "medium",
    name: "Medium",
    range: "11 to 25 people",
    price: 400,
    note: "For an established, multi worker provider running at scale.",
  },
];

const SHARED_FEATURES = [
  "The full platform on every plan",
  "Unlimited participants and notes",
  "Exports ready for an audit any time",
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
      <h1 className="text-2xl sm:text-3xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
        Documentation that holds up when it's checked.
      </h1>
      <p className="mt-3 max-w-md text-[14.5px] leading-relaxed" style={{ color: QUIET_INK }}>
        The first month is free. After that, pick the plan sized to your team. Every plan runs
        the same platform, so there's nothing to upgrade into later.
      </p>

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-1.5">
        {SHARED_FEATURES.map((f) => (
          <span key={f} className="text-[13px]" style={{ color: INK }}>
            <span style={{ color: SIGNATURE }}>&#10003;</span> {f}
          </span>
        ))}
      </div>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
        {TIERS.map(({ tier, name, range, price, perPerson, note }) => {
          const isRecommended = recommendedTier === tier;
          return (
            <div
              key={tier}
              className="pt-4"
              style={{
                borderTop: isRecommended ? `2px solid ${SIGNATURE}` : `1px solid ${RULE}`,
              }}
            >
              <h2 className="text-lg font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
                {name}
              </h2>
              <p className="text-[12.5px] font-semibold mt-0.5" style={{ color: QUIET_INK }}>{range}</p>
              {isRecommended && (
                <p className="mt-1.5 text-[12.5px]" style={{ color: INK }}>
                  This is the plan we walked through together.
                </p>
              )}
              <p className="mt-3 text-[13px] leading-relaxed" style={{ color: QUIET_INK }}>{note}</p>

              <div className="mt-4 flex items-baseline gap-1">
                <span
                  className="text-4xl font-black"
                  style={{ color: FLAG, fontFamily: DISPLAY_FONT, fontVariantNumeric: "tabular-nums" }}
                >
                  ${price}
                </span>
                <span className="text-sm font-semibold" style={{ color: QUIET_INK }}>/ month</span>
              </div>
              {perPerson && (
                <p className="text-[11.5px] font-semibold mt-0.5" style={{ color: QUIET_INK }}>{perPerson}</p>
              )}

              <button
                type="button"
                onClick={() => void handleChoose(tier)}
                disabled={busyTier !== null}
                className="mt-5 w-full h-11 rounded-md text-white font-semibold text-sm disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                style={{ background: isRecommended ? SIGNATURE : INK }}
              >
                {busyTier === tier ? <Loader2 size={14} className="animate-spin" /> : null}
                Start free trial
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-14 flex items-center gap-6">
        <div>
          <p className="text-4xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>5 days</p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: QUIET_INK }}>Without CareCliQ</p>
        </div>
        <ArrowRight size={18} style={{ color: QUIET_INK }} />
        <div>
          <p className="text-4xl font-black" style={{ color: FLAG, fontFamily: DISPLAY_FONT }}>Same day</p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: QUIET_INK }}>With CareCliQ</p>
        </div>
      </div>

      <p className="text-[13px] font-medium mt-12" style={{ color: QUIET_INK }}>
        Already have an account?{" "}
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="font-semibold underline underline-offset-2"
          style={{ color: INK }}
        >
          Sign in
        </button>
      </p>
    </GetStartedShell>
  );
}
