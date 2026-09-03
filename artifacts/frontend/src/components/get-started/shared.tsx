import { useEffect, useState } from "react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";

// Color has a job, not a mood. Signature (plum) marks a decision — a chosen
// answer, a submitted step, the recommended plan — never decoration. Flag
// (coral) marks a number that needs to stand out — the 5-days/same-day
// comparison, a price, a recommended plan name — never a background tint.
// Everything else is ink or quiet ink. No other color appears in this flow.
export const SIGNATURE = "var(--cc-plum)";
export const FLAG = "var(--cc-coral)";
export const INK = "var(--cc-text)";
export const QUIET_INK = "var(--cc-muted)";
export const PAPER = "var(--auth-shell-bg)";
export const RULE = "var(--auth-card-border)";
export const DISPLAY_FONT = "var(--font-display)";

export const STEP_LABELS = [
  "Welcome",
  "What it does",
  "Why it matters",
  "About your team",
  "Recommendation",
  "Plans",
] as const;

/** In-memory only for the /get-started session — never sent anywhere until a
 * plan is actually chosen on PricingStep, and never persisted. */
export type Answers = {
  teamSize?: "1-4" | "5-10" | "11-25" | "25+" | "other";
  teamSizeOther?: string;
  providerType?: "registered" | "unregistered" | "sole-trader" | "allied-health" | "other";
  providerTypeOther?: string;
  painPoint?: "notes" | "compliance" | "rostering" | "medication" | "too-many-tools" | "other";
  painPointOther?: string;
  currentTools?: "paper" | "spreadsheets" | "software" | "none" | "other";
  currentToolsOther?: string;
};

export const EMPTY_ANSWERS: Answers = {};

/** The running index — a table of contents down the left edge, not a progress
 * bar. Current step in ink and slightly heavier, every other step (past or
 * future) in quiet ink. No fills, no circles, no percentage. */
function StepIndex({ current }: { current: number }) {
  return (
    <nav aria-label="Onboarding steps" className="pt-1">
      <ol className="space-y-3.5 border-l" style={{ borderColor: RULE }}>
        {STEP_LABELS.map((label, i) => {
          const isCurrent = i + 1 === current;
          return (
            <li
              key={label}
              className="pl-4 text-[13px] leading-tight"
              style={{
                color: isCurrent ? INK : QUIET_INK,
                fontWeight: isCurrent ? 700 : 500,
                borderLeft: isCurrent ? `2px solid ${SIGNATURE}` : undefined,
                marginLeft: isCurrent ? "-1px" : undefined,
              }}
            >
              {label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function GetStartedShell({
  step,
  children,
  wide,
}: {
  step: number;
  children: React.ReactNode;
  /** Questionnaire needs more room for the 60/40 split. */
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen" style={{ background: PAPER }}>
      <div className={`mx-auto px-6 py-8 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        <div className="flex items-center justify-between mb-10">
          <CareCliQLogo size={36} />
          <AuthThemeToggle />
        </div>
        <div className="grid grid-cols-[140px_1fr] gap-10 items-start">
          <StepIndex current={step} />
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SkipToPricingLink({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="text-[13px] font-medium underline underline-offset-2"
      style={{ color: QUIET_INK }}
    >
      Skip, take me to pricing
    </button>
  );
}

export function PrimaryButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-11 px-5 rounded-md text-white text-[14px] font-semibold disabled:opacity-40 disabled:pointer-events-none"
      style={{ background: SIGNATURE }}
    >
      {children}
    </button>
  );
}

/** The one motion moment this flow allows: a value appearing in the live
 * profile panel fades in over ~200ms. Nothing else in the flow animates. */
export function FadeIn({ children, animKey }: { children: React.ReactNode; animKey: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [animKey]);
  return (
    <span
      className="inline-block transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {children}
    </span>
  );
}
