import { useEffect, useState } from "react";
import {
  ON_PHOTO,
  ON_PHOTO_ACCENT,
  ON_PHOTO_MUTED,
  DISPLAY_FONT,
  GetStartedShell,
  PrimaryButton,
  Reveal,
  prefersReducedMotion,
} from "./shared";

type Props = {
  onContinue: () => void;
};

/** Counts 5 down to 1 once, the moment the page settles: the whole pitch in
 * one number. */
function useCountdown() {
  const [days, setDays] = useState(() => (prefersReducedMotion() ? 1 : 5));
  useEffect(() => {
    if (days === 1) return;
    const id = setTimeout(() => setDays((d) => d - 1), days === 5 ? 1400 : 380);
    return () => clearTimeout(id);
  }, [days]);
  return days;
}

export function WelcomeStep({ onContinue }: Props) {
  const days = useCountdown();
  const done = days === 1;

  return (
    <GetStartedShell step={1} photo={{ src: "/auth-hero-login.jpg", position: "45% 40%" }}>
      <div className="max-w-3xl lg:max-w-[460px]">
        <Reveal delay={200}>
          <p className="text-[13px] sm:text-[14px] font-semibold tracking-wide uppercase" style={{ color: ON_PHOTO_MUTED }}>
            Time to finalise one shift note
          </p>
        </Reveal>

        <Reveal delay={350}>
          <h1
            className="mt-3 font-bold tracking-tight leading-[0.92] text-[84px] sm:text-[128px] lg:text-[120px]"
            style={{ color: ON_PHOTO, fontFamily: DISPLAY_FONT }}
            aria-label="5 days becomes 1 day"
          >
            <span className="inline-block tabular-nums" style={{ minWidth: "0.62em" }}>
              <span key={days} className="inline-block animate-in fade-in slide-in-from-top-4 duration-300 motion-reduce:animate-none">
                {days}
              </span>
            </span>{" "}
            <span className="relative inline-block">
              {done ? "day." : "days"}
              <span
                className="absolute left-0 -bottom-1 sm:-bottom-2 h-[6px] sm:h-[8px] rounded-full transition-[width] duration-700 ease-out"
                style={{ width: done ? "100%" : "0%", background: ON_PHOTO_ACCENT }}
              />
            </span>
          </h1>
        </Reveal>

        <div
          className="transition-all duration-700"
          style={{ opacity: done ? 1 : 0, transform: done ? "none" : "translateY(12px)" }}
        >
          <p className="mt-8 max-w-xl text-[18px] sm:text-[21px] leading-relaxed" style={{ color: ON_PHOTO }}>
            That's what changes when progress notes are written as the shift happens, not pieced
            together from memory on a Friday night.
          </p>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed" style={{ color: ON_PHOTO_MUTED }}>
            CareCliQ is documentation software for NDIS providers, built around what holds up
            when the Commission checks it. Less time on paperwork. More time with the people you
            support.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <PrimaryButton onClick={onContinue} onPhoto>
              Show me a shift
            </PrimaryButton>
            <span className="text-[13.5px] font-medium" style={{ color: ON_PHOTO_MUTED }}>
              First month free · About two minutes
            </span>
          </div>
        </div>
      </div>
    </GetStartedShell>
  );
}
