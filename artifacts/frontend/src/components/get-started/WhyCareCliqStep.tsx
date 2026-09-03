import { ArrowRight, Clock, Zap } from "lucide-react";
import { ACCENTS, FLAG, INK, QUIET_INK, DISPLAY_FONT, Card, GetStartedShell, Pill, PrimaryButton, SkipToPricingLink } from "./shared";

type Props = {
  onContinue: () => void;
  onSkip: () => void;
};

export function WhyCareCliqStep({ onContinue, onSkip }: Props) {
  return (
    <GetStartedShell step={3} wide>
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-12 items-center">
        <div>
          <Pill accent={ACCENTS[2]}>Why it matters</Pill>
          <h1 className="mt-4 text-3xl font-black max-w-lg" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
            Most providers run on a dozen disconnected tools.
          </h1>
          <p className="mt-3 max-w-lg text-[14.5px] leading-relaxed" style={{ color: QUIET_INK }}>
            Email, spreadsheets, paper forms, a rostering app, text messages. Nothing talks to
            anything else, so coordinators spend their week chasing corrections instead of
            reviewing finished work.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <PrimaryButton onClick={onContinue}>Tell us about your team</PrimaryButton>
            <SkipToPricingLink onSkip={onSkip} />
          </div>
        </div>

        <Card className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: "var(--cc-soft)", color: QUIET_INK }}
            >
              <Clock size={19} />
            </span>
            <div>
              <p className="text-4xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
                5 days
              </p>
              <p className="text-[12px] font-medium" style={{ color: QUIET_INK }}>
                Without CareCliQ, until a shift note is finalised
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <ArrowRight size={20} style={{ color: QUIET_INK, transform: "rotate(90deg)" }} />
          </div>
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: "var(--cc-plum-soft)", color: FLAG }}
            >
              <Zap size={19} />
            </span>
            <div>
              <p className="text-4xl font-black" style={{ color: FLAG, fontFamily: DISPLAY_FONT }}>
                Same day
              </p>
              <p className="text-[12px] font-medium" style={{ color: QUIET_INK }}>
                With CareCliQ
              </p>
            </div>
          </div>
        </Card>
      </div>
    </GetStartedShell>
  );
}
