import { SIGNATURE, INK, QUIET_INK, RULE, DISPLAY_FONT, GetStartedShell, PrimaryButton, SkipToPricingLink } from "./shared";

const CAPABILITIES = [
  {
    title: "Notes finished during the shift",
    body:
      "Support workers write progress notes as the shift happens, linked to the participant's actual goals. Nothing waits until the drive home.",
  },
  {
    title: "Compliance built in, not bolted on",
    body:
      "Incident reports, medication records, and audit exports are ready the moment someone asks for them, not assembled the week before a review.",
  },
  {
    title: "One record per person",
    body:
      "Every participant and every worker has one profile the whole team can see, instead of the same information copied across a dozen spreadsheets and apps.",
  },
];

type Props = {
  onContinue: () => void;
  onSkip: () => void;
};

export function FeatureHighlightsStep({ onContinue, onSkip }: Props) {
  return (
    <GetStartedShell step={2}>
      <h1 className="text-2xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
        What it does
      </h1>

      <div className="mt-7">
        {CAPABILITIES.map((c, i) => (
          <div
            key={c.title}
            className="py-5"
            style={{ borderTop: i === 0 ? undefined : `1px solid ${RULE}` }}
          >
            <h2 className="text-[15px] font-bold flex items-baseline gap-2" style={{ color: INK }}>
              <span style={{ color: SIGNATURE }}>&#10003;</span>
              {c.title}
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed max-w-lg" style={{ color: QUIET_INK }}>
              {c.body}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-5">
        <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
        <SkipToPricingLink onSkip={onSkip} />
      </div>
    </GetStartedShell>
  );
}
