import { ArrowRight } from "lucide-react";
import { FLAG, INK, QUIET_INK, DISPLAY_FONT, GetStartedShell, PrimaryButton, SkipToPricingLink } from "./shared";

type Props = {
  onContinue: () => void;
  onSkip: () => void;
};

export function WhyCareCliqStep({ onContinue, onSkip }: Props) {
  return (
    <GetStartedShell step={3}>
      <h1 className="text-2xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
        Most providers run on a dozen disconnected tools.
      </h1>
      <p className="mt-3 max-w-lg text-[14.5px] leading-relaxed" style={{ color: QUIET_INK }}>
        Email, spreadsheets, paper forms, a rostering app, text messages. Nothing talks to
        anything else, so coordinators spend their week chasing corrections instead of reviewing
        finished work.
      </p>

      <div className="mt-10 flex items-center gap-6">
        <div>
          <p className="text-5xl sm:text-6xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
            5 days
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: QUIET_INK }}>
            Without CareCliQ, until a shift note is finalised
          </p>
        </div>
        <ArrowRight size={22} style={{ color: QUIET_INK }} />
        <div>
          <p className="text-5xl sm:text-6xl font-black" style={{ color: FLAG, fontFamily: DISPLAY_FONT }}>
            Same day
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: QUIET_INK }}>
            With CareCliQ
          </p>
        </div>
      </div>

      <div className="mt-10 flex items-center gap-5">
        <PrimaryButton onClick={onContinue}>Tell us about your team</PrimaryButton>
        <SkipToPricingLink onSkip={onSkip} />
      </div>
    </GetStartedShell>
  );
}
