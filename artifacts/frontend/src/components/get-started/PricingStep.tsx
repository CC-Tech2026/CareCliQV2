import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Building2, Check, Loader2, User, Users } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { SIGNATURE, INK, QUIET_INK, RULE, PAPER, DISPLAY_FONT, GetStartedShell, Reveal } from "./shared";

type AbbrevStatus = "idle" | "checking" | "available" | "taken" | "invalid";

/** 4-letter org abbreviation, e.g. "HARV" for Harbour View, the suffix on
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

export const SHARED_FEATURES = [
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

  const abbrevReady = orgAbbrev.status === "available";
  const abbrevBad = orgAbbrev.status === "taken" || (orgAbbrev.status === "invalid" && orgAbbrev.value.length > 0);

  return (
    <GetStartedShell step={6}>
      <Reveal>
        <h1
          className="text-[40px] sm:text-[56px] font-bold tracking-tight leading-[1.02]"
          style={{ color: INK, fontFamily: DISPLAY_FONT }}
        >
          Your first month is on us.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed" style={{ color: QUIET_INK }}>
          Pick the plan sized to your team. Every plan runs the same platform, so there's nothing
          to upgrade into later. Prices exclude GST.
        </p>
      </Reveal>

      <Reveal delay={150} className="mt-10">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 md:gap-12 items-end">
          <div>
            <label htmlFor="org-abbrev" className="text-[15px] font-semibold" style={{ color: INK }}>
              First, a 4-letter code for your organisation
            </label>
            <p className="mt-1 text-[14px]" style={{ color: QUIET_INK }}>
              It goes on the end of every staff member's employee ID, so pick something you'll recognise.
            </p>
            <div className="mt-4 flex items-center gap-4">
              <input
                id="org-abbrev"
                type="text"
                value={orgAbbrev.value}
                onChange={(e) => orgAbbrev.setValue(e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4))}
                placeholder="HARV"
                maxLength={4}
                autoComplete="off"
                aria-invalid={abbrevBad}
                aria-describedby="org-abbrev-status"
                className="w-[170px] bg-transparent py-1 text-[40px] font-bold tracking-[0.18em] uppercase outline-none placeholder:opacity-25"
                style={{
                  color: INK,
                  fontFamily: DISPLAY_FONT,
                  borderBottom: `2px solid ${abbrevBad ? "#DC2626" : abbrevReady ? "var(--cc-green)" : INK}`,
                }}
              />
              <p id="org-abbrev-status" className="text-[14px] font-semibold flex items-center gap-1.5" aria-live="polite">
                {orgAbbrev.status === "checking" && (
                  <span className="flex items-center gap-1.5" style={{ color: QUIET_INK }}>
                    <Loader2 size={14} className="animate-spin" /> Checking
                  </span>
                )}
                {abbrevReady && (
                  <span className="flex items-center gap-1.5" style={{ color: "var(--cc-green)" }}>
                    <Check size={16} strokeWidth={3} /> It's yours
                  </span>
                )}
                {orgAbbrev.status === "taken" && <span style={{ color: "#DC2626" }}>Already taken. Try another.</span>}
                {orgAbbrev.status === "invalid" && orgAbbrev.value.length > 0 && (
                  <span style={{ color: QUIET_INK }}>
                    {4 - orgAbbrev.value.length} more letter{4 - orgAbbrev.value.length === 1 ? "" : "s"}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div aria-hidden className="md:text-right">
            <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: QUIET_INK }}>
              Staff IDs will look like
            </p>
            <p className="mt-1 text-[28px] font-bold tracking-wide tabular-nums" style={{ fontFamily: DISPLAY_FONT }}>
              <span style={{ color: QUIET_INK }}>SW003</span>
              <span style={{ color: orgAbbrev.normalized ? SIGNATURE : RULE }}>{orgAbbrev.normalized.padEnd(4, "_")}</span>
            </p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={300} className="mt-12">
        <div
          className="grid grid-cols-1 md:grid-cols-3 rounded-[24px] overflow-hidden transition-opacity duration-500"
          style={{ border: `1px solid ${RULE}`, opacity: abbrevReady ? 1 : 0.55 }}
        >
          {TIERS.map(({ tier, name, range, price, perPerson, note }, i) => {
            const isRecommended = recommendedTier === tier;
            return (
              <div
                key={tier}
                className={`relative flex flex-col p-7 ${i > 0 ? "border-t md:border-t-0 md:border-l" : ""}`}
                style={{ borderColor: RULE }}
              >
                {isRecommended && <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: SIGNATURE }} />}
                <p className="text-[12.5px] font-semibold min-h-[18px]" style={{ color: SIGNATURE }}>
                  {isRecommended ? "Our suggestion for you" : ""}
                </p>
                <h2 className="mt-2 text-[26px] font-bold tracking-tight" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
                  {name}
                </h2>
                <p className="text-[14px]" style={{ color: QUIET_INK }}>
                  {range}
                </p>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-[44px] leading-none font-bold tracking-tight tabular-nums" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
                    ${price}
                  </span>
                  <span className="text-[14px]" style={{ color: QUIET_INK }}>
                    / month + GST
                  </span>
                </p>
                <p className="mt-2 text-[13px] min-h-[20px]" style={{ color: QUIET_INK }}>
                  {perPerson ?? ""}
                </p>
                <p className="mt-4 flex-1 text-[14.5px] leading-relaxed" style={{ color: INK }}>
                  {note}
                </p>
                <button
                  type="button"
                  onClick={() => void handleChoose(tier)}
                  disabled={busyTier !== null || !abbrevReady}
                  className="group mt-8 h-12 rounded-full text-[14.5px] font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed"
                  style={
                    isRecommended || !recommendedTier
                      ? { background: INK, color: PAPER }
                      : { background: "transparent", color: INK, border: `1.5px solid ${INK}` }
                  }
                >
                  {busyTier === tier ? <Loader2 size={15} className="animate-spin" /> : null}
                  {abbrevReady ? "Start free month" : "Add your code first"}
                  {abbrevReady && busyTier !== tier && (
                    <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-[14px] leading-relaxed" style={{ color: QUIET_INK }}>
          <span className="font-semibold" style={{ color: INK }}>
            Every plan includes
          </span>{" "}
          {SHARED_FEATURES.map((f) => f.toLowerCase()).join(" · ")}.
        </p>
        <p className="mt-3 text-[14px]" style={{ color: QUIET_INK }}>
          Already with us?{" "}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="font-semibold underline underline-offset-4"
            style={{ color: INK }}
          >
            Sign in
          </button>
        </p>
      </Reveal>
    </GetStartedShell>
  );
}
