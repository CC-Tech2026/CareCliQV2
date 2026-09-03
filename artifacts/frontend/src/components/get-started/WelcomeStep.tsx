import { FLAG, INK, DISPLAY_FONT, GetStartedShell, PrimaryButton, SkipToPricingLink } from "./shared";

type Props = {
  onContinue: () => void;
  onSkip: () => void;
};

export function WelcomeStep({ onContinue, onSkip }: Props) {
  return (
    <GetStartedShell step={1}>
      <p
        className="text-6xl sm:text-7xl font-black tracking-tight leading-none"
        style={{ color: FLAG, fontFamily: DISPLAY_FONT }}
      >
        5 days becomes 1.
      </p>
      <p className="mt-6 max-w-md text-[15px] leading-relaxed" style={{ color: INK }}>
        That's how a coordinator's week changes once progress notes are written as the shift
        happens, not reconstructed from memory afterward. CareCliQ is documentation software
        built for NDIS providers, around what actually holds up when the Commission checks it.
      </p>
      <div className="mt-9 flex items-center gap-5">
        <PrimaryButton onClick={onContinue}>Show me how it works</PrimaryButton>
        <SkipToPricingLink onSkip={onSkip} />
      </div>
    </GetStartedShell>
  );
}
