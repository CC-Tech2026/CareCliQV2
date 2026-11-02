import { SIGNATURE, INK, QUIET_INK, RULE, DISPLAY_FONT, GetStartedShell, PrimaryButton, Reveal } from "./shared";
import type { Answers } from "./shared";
import { profileSentence } from "./QuestionnaireStep";
import { TIERS, type PlanTier } from "./PricingStep";

function recommendTier(teamSize: Answers["teamSize"]): { tier: PlanTier; note?: string } {
  switch (teamSize) {
    case "1-4":
      return { tier: "micro" };
    case "5-10":
      return { tier: "small" };
    case "11-25":
      return { tier: "medium" };
    case "25+":
      return { tier: "medium", note: "For more than 25 people, talk to us about a larger rollout." };
    default:
      return { tier: "small", note: "A starting point. Talk to us if it's not the right fit." };
  }
}

function reasonSentence(painPoint: Answers["painPoint"]): string {
  switch (painPoint) {
    case "notes":
      return "Notes are eating your week, so every plan includes unlimited progress notes written during the shift.";
    case "compliance":
      return "Audits are a pressure point, so every plan includes exports that are ready the moment they're asked for.";
    case "rostering":
      return "Rostering is the bottleneck, so workers are matched to participants by relationship, not just who is free.";
    case "medication":
      return "Medication carries real risk, so every record keeps a full chain of custody.";
    case "too-many-tools":
      return "You're stitching tools together, so everything lives in one record per person.";
    default:
      return "Every plan includes the whole platform, so you can start small and see how it fits.";
  }
}

type Props = {
  answers: Answers;
  onContinueWithPlan: (tier: PlanTier) => void;
};

export function RecommendationStep({ answers, onContinueWithPlan }: Props) {
  const { tier, note } = recommendTier(answers.teamSize);
  const plan = TIERS.find((t) => t.tier === tier)!;
  const sentence = profileSentence(answers);

  const reasons = [
    `${plan.name} is sized for ${plan.range.toLowerCase()}.`,
    reasonSentence(answers.painPoint),
    "Growing into the next size is a plan change, not a migration. Your notes and history come with you.",
  ];

  return (
    <GetStartedShell step={5}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,400px)] gap-12 lg:gap-20 items-center">
        <div>
          {sentence && (
            <Reveal>
              <p className="max-w-xl text-[17px] leading-relaxed" style={{ color: QUIET_INK }}>
                &ldquo;{sentence}&rdquo;
              </p>
            </Reveal>
          )}
          <Reveal delay={200}>
            <h1
              className="mt-5 text-[44px] sm:text-[64px] font-bold tracking-tight leading-[1]"
              style={{ color: INK, fontFamily: DISPLAY_FONT }}
            >
              We'd start you
              <br />
              on <span style={{ color: SIGNATURE }}>{plan.name}</span>.
            </h1>
          </Reveal>

          <Reveal delay={400}>
            <p className="mt-6 flex items-baseline gap-2 flex-wrap" style={{ color: INK }}>
              <span className="text-[40px] font-bold tracking-tight tabular-nums" style={{ fontFamily: DISPLAY_FONT }}>
                ${plan.price}
              </span>
              <span className="text-[15px]" style={{ color: QUIET_INK }}>
                a month + GST, after your free first month
              </span>
            </p>
          </Reveal>

          <Reveal delay={550}>
            <ol className="mt-8 max-w-xl" style={{ borderTop: `1px solid ${RULE}` }}>
              {reasons.map((r, i) => (
                <li key={r} className="flex gap-5 py-4" style={{ borderBottom: `1px solid ${RULE}` }}>
                  <span className="text-[13px] font-semibold tabular-nums pt-0.5" style={{ color: SIGNATURE }}>
                    0{i + 1}
                  </span>
                  <span className="text-[15.5px] leading-relaxed" style={{ color: INK }}>
                    {r}
                  </span>
                </li>
              ))}
            </ol>
            {note && (
              <p className="mt-4 text-[14px]" style={{ color: QUIET_INK }}>
                {note}
              </p>
            )}
          </Reveal>

          <Reveal delay={700} className="mt-10">
            <PrimaryButton onClick={() => onContinueWithPlan(tier)}>Start with {plan.name}</PrimaryButton>
          </Reveal>
        </div>

        <Reveal delay={300} className="hidden lg:block">
          <img
            src="/auth-hero-signup.jpg"
            alt="A young man in a wheelchair spinning a basketball on one finger"
            className="w-full h-[560px] object-cover rounded-[28px]"
            style={{ objectPosition: "40% center" }}
          />
        </Reveal>
      </div>
    </GetStartedShell>
  );
}
