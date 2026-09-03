import { ClipboardCheck, ShieldCheck, Users2 } from "lucide-react";
import {
  ACCENTS,
  FLAG,
  INK,
  DISPLAY_FONT,
  GetStartedShell,
  Pill,
  PreviewList,
  PrimaryButton,
  SkipToPricingLink,
} from "./shared";

const PREVIEW = [
  {
    icon: <ClipboardCheck size={19} />,
    title: "Notes finished during the shift",
    body: "Written as it happens, linked to the participant's goals — not reconstructed afterward.",
  },
  {
    icon: <ShieldCheck size={19} />,
    title: "Compliance built in",
    body: "Incident reports and audit exports are ready the moment someone asks for them.",
  },
  {
    icon: <Users2 size={19} />,
    title: "One record per person",
    body: "Every participant and worker has one profile the whole team can see.",
  },
];

type Props = {
  onContinue: () => void;
  onSkip: () => void;
};

export function WelcomeStep({ onContinue, onSkip }: Props) {
  return (
    <GetStartedShell step={1} wide>
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-12 items-center">
        <div>
          <Pill accent={ACCENTS[0]}>Welcome to CareCliQ</Pill>
          <p
            className="mt-5 text-5xl sm:text-6xl font-black tracking-tight leading-none"
            style={{ color: INK, fontFamily: DISPLAY_FONT }}
          >
            <span style={{ color: FLAG }}>5 days</span> becomes 1.
          </p>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed" style={{ color: INK }}>
            That's how a coordinator's week changes once progress notes are written as the shift
            happens, not reconstructed from memory afterward. CareCliQ is documentation software
            built for NDIS providers, around what actually holds up when the Commission checks it.
          </p>
          <div className="mt-9 flex items-center gap-3">
            <PrimaryButton onClick={onContinue}>Show me how it works</PrimaryButton>
            <SkipToPricingLink onSkip={onSkip} />
          </div>
        </div>
        <PreviewList items={PREVIEW} />
      </div>
    </GetStartedShell>
  );
}
