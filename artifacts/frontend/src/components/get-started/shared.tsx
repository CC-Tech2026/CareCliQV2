import { createContext, useContext, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";

export const SIGNATURE = "var(--cc-plum)";
export const INK = "var(--cc-text)";
export const QUIET_INK = "var(--cc-muted)";
export const PAPER = "var(--auth-shell-bg)";
export const RULE = "var(--auth-card-border)";
export const DISPLAY_FONT = "var(--font-display)";

/** Light text for anything sitting on a photo behind the flat navy scrim,
 * which stays dark in both themes (same pattern as the login panel). */
export const ON_PHOTO = "#FFFFFF";
export const ON_PHOTO_MUTED = "rgba(255,255,255,0.8)";
export const ON_PHOTO_ACCENT = "#F9A8C9";
export const PHOTO_SCRIM = "rgba(26,26,46,0.58)";

export const STEP_LABELS = [
  "Welcome",
  "A shift with CareCliQ",
  "Why it matters",
  "About your team",
  "Our suggestion",
  "Plans",
] as const;

/** In-memory only for the /get-started session. Never sent anywhere until a
 * plan is actually chosen on PricingStep, and never persisted. */
export type Answers = {
  teamSize?: "1-4" | "5-10" | "11-25" | "25+" | "other";
  teamSizeOther?: string;
  providerType?: "registered" | "unregistered" | "applying" | "sole-trader" | "other";
  providerTypeOther?: string;
  painPoint?: "notes" | "compliance" | "rostering" | "medication" | "too-many-tools" | "other";
  painPointOther?: string;
  currentTools?: "paper" | "spreadsheets" | "software" | "none" | "other";
  currentToolsOther?: string;
};

export const EMPTY_ANSWERS: Answers = {};

/** Back and skip live in the shell, so every step gets them the same way.
 * Provided by GetStartedFlow. */
export const StepNavContext = createContext<{ back: (() => void) | null; skipToPricing: () => void } | null>(null);

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fades and lifts its children in, `delay` ms after the step appears, so a
 * step reads top to bottom instead of landing all at once. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-in fade-in slide-in-from-bottom-3 duration-700 motion-reduce:animate-none ${className}`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      {children}
    </div>
  );
}

export function GetStartedShell({
  step,
  children,
  photo,
  onBack,
}: {
  step: number;
  children: React.ReactNode;
  /** Full-bleed photo behind the whole step (Welcome). */
  photo?: { src: string; position?: string };
  /** Overrides the default back-to-previous-step, e.g. previous question. */
  onBack?: () => void;
}) {
  const nav = useContext(StepNavContext);
  const back = onBack ?? nav?.back ?? null;
  const onPhoto = Boolean(photo);
  const text = onPhoto ? ON_PHOTO : INK;
  const muted = onPhoto ? ON_PHOTO_MUTED : QUIET_INK;

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden" style={{ background: onPhoto ? "#1A1A2E" : PAPER }}>
      {photo && (
        // Phones and tablets: the photo fills the screen under a scrim.
        // Laptops and up: it starts 520px into the content column (whose left
        // edge matches <main>'s padding and centring), so the text sits on
        // navy and never covers a face.
        <div className="absolute inset-y-0 right-0 left-0 lg:left-[calc(64px+max(0px,(100vw-1280px)/2)+520px)] overflow-hidden">
          <img
            src={photo.src}
            alt=""
            aria-hidden
            className="h-full w-full object-cover animate-in fade-in zoom-in-105 duration-[1600ms] motion-reduce:animate-none"
            style={{ objectPosition: photo.position ?? "center" }}
          />
          <div className="absolute inset-0 lg:hidden" style={{ background: PHOTO_SCRIM }} />
          <div className="absolute inset-0 hidden lg:block" style={{ background: "rgba(26,26,46,0.12)" }} />
        </div>
      )}

      <div className="relative h-[3px] w-full" style={{ background: onPhoto ? "rgba(255,255,255,0.18)" : RULE }}>
        <div
          className="h-full transition-[width] duration-700 ease-out"
          style={{ width: `${(step / STEP_LABELS.length) * 100}%`, background: SIGNATURE }}
        />
      </div>

      <header className="relative flex items-center justify-between gap-4 px-5 sm:px-10 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <CareCliQLogo size={44} />
          <span className="hidden md:inline text-[12.5px] font-medium" style={{ color: muted }}>
            Step {step} of {STEP_LABELS.length} · {STEP_LABELS[step - 1]}
          </span>
        </div>
        <div className="flex items-center gap-5">
          {nav && step < STEP_LABELS.length && (
            <button
              type="button"
              onClick={nav.skipToPricing}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline"
              style={{ color: text }}
            >
              Skip to plans <ArrowRight size={14} />
            </button>
          )}
          <AuthThemeToggle />
        </div>
      </header>

      <main className="relative flex-1 flex flex-col px-5 sm:px-10 lg:px-16 pb-8">
        <div className="flex-1 flex items-center w-full max-w-6xl mx-auto py-6 sm:py-10">
          <div className="w-full">{children}</div>
        </div>
        {back && (
          <div className="w-full max-w-6xl mx-auto">
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-2 text-[13px] font-semibold underline-offset-4 hover:underline"
              style={{ color: muted }}
            >
              <ArrowLeft size={15} /> Back
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

/** The one main action on each step: ink on paper (white on a photo), not a
 * brand-coloured fill. */
export function PrimaryButton({
  onClick,
  children,
  disabled,
  onPhoto,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  onPhoto?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex items-center gap-3 h-[52px] pl-7 pr-6 rounded-full text-[15px] font-semibold transition-transform active:scale-[0.98] disabled:opacity-35 disabled:pointer-events-none"
      style={onPhoto ? { background: "#FFFFFF", color: "#1A1A2E" } : { background: INK, color: PAPER }}
    >
      {children}
      <ArrowRight size={17} className="transition-transform duration-300 group-hover:translate-x-1" />
    </button>
  );
}

/** A value fading in as it's answered. */
export function FadeIn({ children, animKey }: { children: React.ReactNode; animKey: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [animKey]);
  return (
    <span className="transition-opacity duration-500" style={{ opacity: visible ? 1 : 0 }}>
      {children}
    </span>
  );
}
