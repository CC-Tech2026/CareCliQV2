import { SIGNATURE, FLAG, INK, DISPLAY_FONT, Answers, GetStartedShell } from "./shared";
import type { PlanTier } from "./PricingStep";

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

  return (
    <GetStartedShell step={5}>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: SIGNATURE }}>
        Based on your answers
      </p>

      <p className="mt-3 text-[16px] leading-relaxed max-w-lg" style={{ color: INK }}>
        We'd suggest{" "}
        <span className="font-black" style={{ color: FLAG, fontFamily: DISPLAY_FONT }}>
          {TIER_NAME[tier]}
        </span>
        . {reason} Plans are based on team size, not features — every plan runs the same
        platform, so moving from Micro to Small or Small to Medium is a plan change, not a
        migration. Your participants, notes, and history come with you.
        {note ? <> {note}</> : null}
      </p>

      <div className="mt-9 flex items-center gap-5">
        <button
          type="button"
          onClick={() => onContinueWithPlan(tier)}
          className="h-11 px-5 rounded-md text-white text-[14px] font-semibold"
          style={{ background: SIGNATURE }}
        >
          Continue with {TIER_NAME[tier]}
        </button>
        <button
          type="button"
          onClick={onSeeAllPlans}
          className="text-[13px] font-medium underline underline-offset-2"
          style={{ color: "var(--cc-muted)" }}
        >
          See all plans instead
        </button>
      </div>
    </GetStartedShell>
  );
}
