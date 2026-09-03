import { Star } from "lucide-react";
import { ACCENTS, SIGNATURE, FLAG, INK, QUIET_INK, DISPLAY_FONT, Card, GetStartedShell, Pill, PrimaryButton } from "./shared";
import type { Answers } from "./shared";
import { TIERS, type PlanTier } from "./PricingStep";

const TIER_NAME: Record<PlanTier, string> = { micro: "Micro", small: "Small", medium: "Medium" };

function recommendTier(teamSize: Answers["teamSize"]): { tier: PlanTier; note?: string } {
  switch (teamSize) {
    case "1-4":
      return { tier: "micro" };
    case "5-10":
      return { tier: "small" };
    case "11-25":
      return { tier: "medium" };
    case "25+":
      return { tier: "medium", note: "Talk to our team about a larger rollout." };
    default:
      return { tier: "small", note: "Shown as a starting point — talk to our team if it's not a fit." };
  }
}

function reasonSentence(painPoint: Answers["painPoint"]): string {
  switch (painPoint) {
    case "notes":
      return "Because notes are eating your week, every plan includes unlimited progress notes written during the shift, not after it.";
    case "compliance":
      return "Because audits are a pressure point, every plan includes exports that are ready the moment they're asked for.";
    case "rostering":
      return "Because rostering is the bottleneck, CareCliQ matches workers to participants based on the relationship, not just who is free.";
    case "medication":
      return "Because medication tracking carries real risk, CareCliQ keeps a full chain of custody on every record.";
    case "too-many-tools":
      return "Because you're stitching together a dozen tools, CareCliQ replaces them with one record per person.";
    default:
      return "Thanks for telling us more — here's where most teams your size start, and we're happy to talk through your specific situation.";
  }
}

type Props = {
  answers: Answers;
  onContinueWithPlan: (tier: PlanTier) => void;
  onSeeAllPlans: () => void;
};

export function RecommendationStep({ answers, onContinueWithPlan, onSeeAllPlans }: Props) {
  const { tier, note } = recommendTier(answers.teamSize);
  const reason = reasonSentence(answers.painPoint);
  const plan = TIERS.find((t) => t.tier === tier)!;
  const Icon = plan.icon;

  return (
    <GetStartedShell step={5} wide>
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-12 items-center">
        <div>
          <Pill accent={ACCENTS[3]}>Based on your answers</Pill>
          <p className="mt-5 text-[15px] leading-relaxed max-w-lg" style={{ color: INK }}>
            {reason} Plans are based on team size, not features — every plan runs the same
            platform, so moving from Micro to Small or Small to Medium is a plan change, not a
            migration. Your participants, notes, and history come with you.
            {note ? <> {note}</> : null}
          </p>
          <div className="mt-8 flex items-center gap-3">
            <PrimaryButton onClick={() => onContinueWithPlan(tier)}>
              Continue with {TIER_NAME[tier]}
            </PrimaryButton>
            <button
              type="button"
              onClick={onSeeAllPlans}
              className="rounded-full px-4 py-2.5 text-[13px] font-bold"
              style={{ color: "var(--cc-muted)" }}
            >
              See all plans instead
            </button>
          </div>
        </div>

        <Card selected className="relative">
          <span
            className="absolute -top-3 left-5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
            style={{ background: SIGNATURE }}
          >
            <Star size={11} fill="white" /> Recommended plan
          </span>
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: "var(--cc-plum-soft)", color: SIGNATURE }}
          >
            <Icon size={19} />
          </span>
          <p className="mt-4 text-2xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
            {plan.name}
          </p>
          <p className="text-[12.5px] font-semibold mt-0.5" style={{ color: QUIET_INK }}>{plan.range}</p>
          <div className="mt-4 flex items-baseline gap-1">
            <span
              className="text-3xl font-black"
              style={{ color: FLAG, fontFamily: DISPLAY_FONT, fontVariantNumeric: "tabular-nums" }}
            >
              ${plan.price}
            </span>
            <span className="text-sm font-semibold" style={{ color: QUIET_INK }}>/ month</span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: QUIET_INK }}>{plan.note}</p>
        </Card>
      </div>
    </GetStartedShell>
  );
}
