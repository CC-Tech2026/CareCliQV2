import { ArrowUpRight, ClipboardCheck, ShieldCheck, Users2 } from "lucide-react";
import {
  ACCENTS,
  INK,
  QUIET_INK,
  DISPLAY_FONT,
  Card,
  GetStartedShell,
  Pill,
  PrimaryButton,
  SkipToPricingLink,
} from "./shared";

const CAPABILITIES = [
  {
    icon: ClipboardCheck,
    title: "Notes finished during the shift",
    body:
      "Support workers write progress notes as the shift happens, linked to the participant's actual goals. Nothing waits until the drive home.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance built in, not bolted on",
    body:
      "Incident reports, medication records, and audit exports are ready the moment someone asks for them, not assembled the week before a review.",
  },
  {
    icon: Users2,
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
      <Pill accent={ACCENTS[1]}>What it does</Pill>
      <h1 className="mt-4 text-3xl font-black" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
        One platform, built around the shift.
      </h1>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {CAPABILITIES.map((c, i) => {
          const accent = ACCENTS[i];
          const Icon = c.icon;
          return (
            <Card key={c.title} className="relative">
              <ArrowUpRight size={16} className="absolute top-5 right-5" style={{ color: QUIET_INK }} />
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ background: accent.bg, color: accent.fg }}
              >
                <Icon size={19} />
              </span>
              <h2 className="mt-4 text-[14.5px] font-black" style={{ color: INK }}>
                {c.title}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed" style={{ color: QUIET_INK }}>
                {c.body}
              </p>
            </Card>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-3">
        <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
        <SkipToPricingLink onSkip={onSkip} />
      </div>
    </GetStartedShell>
  );
}
