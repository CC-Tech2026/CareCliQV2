import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";

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

/** A small rotating on-brand palette for eyebrow tags, pill badges, and card icon
 * tints — plum stays the "primary decision" colour, the rest add variety without
 * leaving the app's existing token set. */
export const ACCENTS = [
  { fg: "var(--cc-plum)", bg: "var(--cc-plum-soft)", border: "var(--cc-plum-border)" },
  { fg: "var(--cc-coral)", bg: "var(--cc-coral-soft)", border: "var(--cc-coral-ring)" },
  { fg: "var(--cc-amber)", bg: "var(--cc-amber-tint)", border: "var(--cc-amber)" },
  { fg: "var(--cc-sky)", bg: "var(--cc-sky-tint)", border: "var(--cc-sky)" },
] as const;

export function accentFor(index: number) {
  return ACCENTS[index % ACCENTS.length];
}

/** Small rounded pill — used for eyebrow tags above headlines and for
 * highlighted words inline in copy. */
export function Pill({
  children,
  accent = ACCENTS[0],
  icon,
}: {
  children: React.ReactNode;
  accent?: (typeof ACCENTS)[number];
  icon?: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold"
      style={{ background: accent.bg, color: accent.fg }}
    >
      {icon}
      {children}
    </span>
  );
}

/** The step ring + connected circle list living in the dark-navy sidebar —
 * colours here are hardcoded for that dark background, matching the app's
 * real nav sidebar (--cc-sidebar-bg) rather than the light auth tokens. */
const RAIL_TEXT = "rgba(255,255,255,0.92)";
const RAIL_MUTED = "rgba(255,255,255,0.48)";
const RAIL_LINE = "rgba(255,255,255,0.14)";
const RAIL_SOFT = "rgba(255,255,255,0.06)";

function StepRail({ current }: { current: number }) {
  const pct = Math.round((current / STEP_LABELS.length) * 100);
  return (
    <div>
      <div className="flex items-center gap-5">
        <div
          className="relative h-24 w-24 shrink-0 rounded-full grid place-items-center"
          style={{ background: `conic-gradient(${SIGNATURE} ${pct}%, ${RAIL_LINE} 0)` }}
        >
          <div
            className="h-[76px] w-[76px] rounded-full grid place-items-center text-[18px] font-black"
            style={{ background: "var(--cc-sidebar-bg)", color: RAIL_TEXT }}
          >
            {current}/{STEP_LABELS.length}
          </div>
        </div>
        <div>
          <p className="text-[26px] leading-tight font-black" style={{ color: RAIL_TEXT }}>
            Getting started
          </p>
          <p className="text-[15px] font-medium" style={{ color: RAIL_MUTED }}>
            with CareCliQ
          </p>
        </div>
      </div>

      <ol className="mt-10">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const isDone = n < current;
          const isCurrent = n === current;
          return (
            <li key={label} className="relative pb-9 last:pb-0 pl-0 flex items-start gap-4">
              {i < STEP_LABELS.length - 1 && (
                <span
                  className="absolute left-[17px] top-9 bottom-0 w-px"
                  style={{ background: isDone ? SIGNATURE : RAIL_LINE }}
                />
              )}
              <span
                className="relative z-10 h-9 w-9 shrink-0 rounded-full grid place-items-center text-[13px] font-black"
                style={{
                  background: isDone ? SIGNATURE : isCurrent ? "var(--cc-sidebar-bg)" : RAIL_SOFT,
                  border: isCurrent ? `2px solid ${SIGNATURE}` : isDone ? "none" : `1px solid ${RAIL_LINE}`,
                  color: isDone ? "white" : isCurrent ? SIGNATURE : RAIL_MUTED,
                }}
              >
                {isDone ? <Check size={16} strokeWidth={3} /> : n}
              </span>
              <span
                className="pt-1 text-[16px]"
                style={{ color: isCurrent ? RAIL_TEXT : RAIL_MUTED, fontWeight: isCurrent ? 800 : 600 }}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function GetStartedShell({
  step,
  children,
  wide,
}: {
  step: number;
  children: React.ReactNode;
  /** Questionnaire and Plans need more room for the wider content split. */
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen flex" style={{ background: "var(--cc-plum-subtle)" }}>
      <div
        className="hidden sm:flex w-[420px] shrink-0 flex-col p-12"
        style={{ background: "var(--cc-sidebar-bg)" }}
      >
        <div className="flex-1 flex items-center">
          <StepRail current={step} />
        </div>

        <div className="pt-8" style={{ borderTop: `1px solid ${RAIL_LINE}` }}>
          <p className="text-[13px] leading-relaxed" style={{ color: RAIL_MUTED }}>
            &ldquo;Documentation software built for NDIS providers, around what actually
            holds up when the Commission checks it.&rdquo;
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col" style={{ background: "var(--cc-surface)" }}>
        {/* Logo lives here now - the right-hand panel's header, not the dark
            sidebar - on the left of this bar with its "Powered by" caption,
            with the theme toggle at the opposite end so the two aren't
            crowding each other. */}
        <div
          className="flex items-center justify-between px-6 sm:px-14 py-6 gap-4"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <span className="sm:hidden">
            <CareCliQLogo size={34} />
          </span>
          <div className="hidden sm:flex items-center gap-3">
            <CareCliQLogo size={64} />
            <p className="text-[11px] font-semibold tracking-wide" style={{ color: QUIET_INK }}>
              Powered by CC Tech Australia Pty Ltd
            </p>
          </div>
          <AuthThemeToggle />
        </div>
        <div className="flex-1 flex items-center px-6 sm:px-14 py-10">
          <div className={`mx-auto w-full ${wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</div>
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
      className="rounded-full px-4 py-2.5 text-[13px] font-bold"
      style={{ color: QUIET_INK, border: `1px solid ${RULE}` }}
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
      className="h-11 px-6 rounded-full text-white text-[14px] font-bold disabled:opacity-40 disabled:pointer-events-none"
      style={{ background: SIGNATURE, boxShadow: "var(--cc-shadow-sm)" }}
    >
      {children}
    </button>
  );
}

/** Bordered rounded card — the base unit for feature tiles, stat tiles, and
 * questionnaire option rows throughout the flow. */
export function Card({
  children,
  selected,
  className = "",
}: {
  children: React.ReactNode;
  selected?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        border: selected ? `2px solid ${SIGNATURE}` : `1px solid ${RULE}`,
        background: selected ? "var(--cc-plum-subtle)" : "var(--cc-surface)",
        boxShadow: selected ? "var(--cc-shadow-sm)" : "var(--cc-card-shadow)",
      }}
    >
      {children}
    </div>
  );
}

/** A compact icon-tile list used as the supporting visual in a two-column
 * hero (Welcome, Recommendation) so the content panel isn't just a lone
 * block of text floating in a wide white space. */
export function PreviewList({
  items,
}: {
  items: { icon: React.ReactNode; title: string; body: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => {
        const accent = ACCENTS[i % ACCENTS.length];
        return (
          <Card key={item.title} className="flex items-start gap-4">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{ background: accent.bg, color: accent.fg }}
            >
              {item.icon}
            </span>
            <div>
              <p className="text-[14px] font-black" style={{ color: INK }}>
                {item.title}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: QUIET_INK }}>
                {item.body}
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** A value fading in as it's answered in the live profile panel. */
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
