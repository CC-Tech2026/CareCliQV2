import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Building2, Check, Loader2, Star, User, Users, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { ACCENTS, SIGNATURE, FLAG, INK, QUIET_INK, RULE, DISPLAY_FONT, Card, GetStartedShell, Pill } from "./shared";

type AbbrevStatus = "idle" | "checking" | "available" | "taken" | "invalid";

/** 4-letter org abbreviation, e.g. "HARV" for Harbour View — the suffix on
 * every staff member's auto-generated employee ID (SW003HARV). Must be
 * globally unique; live-checked here rather than on Stripe's hosted page
 * since that page can't call our backend mid-fill. */
function useOrgAbbrev() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<AbbrevStatus>("idle");

  useEffect(() => {
    const candidate = value.trim().toUpperCase();
    if (candidate.length === 0) {
      setStatus("idle");
      return;
    }
    if (!/^[A-Z]{4}$/.test(candidate)) {
      setStatus("invalid");
      return;
    }
    setStatus("checking");
    const timer = setTimeout(() => {
      apiFetch(`/api/platform-billing/signup/check-org-abbrev?value=${encodeURIComponent(candidate)}`)
        .then((res) => (res.ok ? res.json() : { available: false }))
        .then((data) => setStatus(data.available ? "available" : "taken"))
        .catch(() => setStatus("idle"));
    }, 400);
    return () => clearTimeout(timer);
  }, [value]);

  return { value, setValue, status, normalized: value.trim().toUpperCase() };
}

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
  const orgAbbrev = useOrgAbbrev();

  async function handleChoose(tier: PlanTier) {
    if (busyTier) return;
    if (orgAbbrev.status !== "available") {
      toast({
        title: "Organisation abbreviation required",
        description: "Enter a 4-letter abbreviation for your organisation and wait for it to be confirmed as available.",
        variant: "destructive",
      });
      return;
    }
    setBusyTier(tier);
    try {
      const res = await apiFetch("/api/platform-billing/signup/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_tier: tier, org_abbrev: orgAbbrev.normalized }),
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

      <div className="mt-5 max-w-xs">
        <label className="text-[12.5px] font-bold" style={{ color: INK }}>
          Organisation abbreviation
        </label>
        <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: QUIET_INK }}>
          4 letters, unique to your organisation — used in every staff member's employee ID (e.g. SW003
          <span style={{ color: SIGNATURE, fontWeight: 700 }}>HARV</span>).
        </p>
        <div className="relative mt-1.5">
          <input
            type="text"
            value={orgAbbrev.value}
            onChange={(e) => orgAbbrev.setValue(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="HARV"
            maxLength={4}
            className="w-full rounded-xl px-3.5 py-2.5 pr-9 text-[14px] font-bold tracking-wider outline-none uppercase"
            style={{
              color: INK,
              border: `1px solid ${orgAbbrev.status === "taken" || orgAbbrev.status === "invalid" ? "#DC2626" : RULE}`,
              background: "var(--cc-surface)",
            }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {orgAbbrev.status === "checking" && <Loader2 size={15} className="animate-spin" style={{ color: QUIET_INK }} />}
            {orgAbbrev.status === "available" && <Check size={16} style={{ color: "#16A34A" }} />}
            {orgAbbrev.status === "taken" && <X size={16} style={{ color: "#DC2626" }} />}
          </span>
        </div>
        {orgAbbrev.status === "taken" && (
          <p className="mt-1 text-[11.5px] font-semibold" style={{ color: "#DC2626" }}>
            That abbreviation is already taken — try another.
          </p>
        )}
        {orgAbbrev.status === "invalid" && orgAbbrev.value.length > 0 && (
          <p className="mt-1 text-[11.5px] font-semibold" style={{ color: "#DC2626" }}>
            Must be exactly 4 letters.
          </p>
        )}
      </div>

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
                disabled={busyTier !== null || orgAbbrev.status !== "available"}
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
