import { useEffect, useState } from "react";
import { SIGNATURE, INK, QUIET_INK, RULE, PAPER, DISPLAY_FONT, GetStartedShell, PrimaryButton, Reveal, prefersReducedMotion } from "./shared";

const TOOLS = ["Email", "Spreadsheets", "Paper forms", "A rostering app", "Text messages"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** What happens to one shift note across the week, the old way. */
const WITHOUT = ["Scribbled on paper", "Typed up from memory", "Emailed to the office", "Sent back to fix", "Finally filed"];

/** ms the "without" dot takes to cross Monday to Friday. */
const TRAVEL = 3200;

function Track({
  label,
  sub,
  subColor,
  play,
  children,
}: {
  label: string;
  sub: string;
  subColor: string;
  play: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-x-8 gap-y-4 py-6 [@media(max-height:820px)]:py-4" style={{ borderTop: `1px solid ${RULE}` }}>
      <div>
        <p className="text-[17px] font-semibold" style={{ color: INK }}>
          {label}
        </p>
        <p
          className="mt-0.5 text-[28px] font-bold tracking-tight transition-opacity duration-700"
          style={{ color: subColor, fontFamily: DISPLAY_FONT, opacity: play ? 1 : 0 }}
        >
          {sub}
        </p>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

export function WhyCareCliqStep({ onContinue }: { onContinue: () => void }) {
  const reduced = prefersReducedMotion();
  const [play, setPlay] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const id = setTimeout(() => setPlay(true), 900);
    return () => clearTimeout(id);
  }, [reduced]);
  const step = TRAVEL / (DAYS.length - 1);

  return (
    <GetStartedShell step={3}>
      <Reveal>
        <h1
          className="max-w-4xl text-[36px] sm:text-[52px] [@media(max-height:820px)]:sm:text-[42px] font-bold tracking-tight leading-[1.04]"
          style={{ color: INK, fontFamily: DISPLAY_FONT }}
        >
          Most providers run on a dozen tools that don't talk to each other.
        </h1>
      </Reveal>
      <Reveal delay={150}>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed" style={{ color: QUIET_INK }}>
          {TOOLS.map((t, i) => (
            <span key={t}>
              <span
                className="transition-[text-decoration-color] duration-500"
                style={{
                  textDecoration: "line-through",
                  textDecorationThickness: "2px",
                  textDecorationColor: play ? SIGNATURE : "transparent",
                  transitionDelay: `${i * 140}ms`,
                }}
              >
                {t}
              </span>
              {i < TOOLS.length - 1 ? ", " : ". "}
            </span>
          ))}
          So coordinators spend the week chasing corrections instead of reviewing finished work.
          Here's one shift note's week.
        </p>
      </Reveal>

      <Reveal delay={300} className="mt-8 [@media(max-height:820px)]:mt-5">
        {/* Day labels */}
        <div className="hidden md:grid grid-cols-[200px_1fr] gap-x-8 pb-3">
          <span />
          <div className="grid grid-cols-5">
            {DAYS.map((d) => (
              <span key={d} className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: QUIET_INK }}>
                {d}
              </span>
            ))}
          </div>
        </div>

        <Track label="Without CareCliQ" sub="5 days" subColor={QUIET_INK} play={play}>
          <div className="relative h-[3px] mt-3 mr-[20%] rounded-full" style={{ background: RULE }}>
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: play ? "100%" : "0%",
                background: QUIET_INK,
                opacity: 0.45,
                transition: `width ${TRAVEL}ms linear`,
              }}
            />
          </div>
          <div className="grid grid-cols-5 -mt-[9px]">
            {WITHOUT.map((label, i) => (
              <div
                key={label}
                className="pr-2 transition-opacity duration-500"
                style={{ opacity: play ? 1 : 0, transitionDelay: `${i * step}ms` }}
              >
                <span
                  className="block h-[15px] w-[15px] rounded-full"
                  style={{
                    background: i === WITHOUT.length - 1 ? INK : PAPER,
                    border: `2px solid ${i === WITHOUT.length - 1 ? INK : QUIET_INK}`,
                  }}
                />
                <p className="md:hidden mt-2 text-[11px] font-semibold uppercase" style={{ color: QUIET_INK }}>
                  {DAYS[i]}
                </p>
                <p className="mt-2 md:mt-3 text-[12px] sm:text-[14px] leading-snug" style={{ color: i === WITHOUT.length - 1 ? INK : QUIET_INK }}>
                  {label}
                </p>
              </div>
            ))}
          </div>
        </Track>

        <div style={{ borderBottom: `1px solid ${RULE}` }}>
          <Track label="With CareCliQ" sub="Same day" subColor={SIGNATURE} play={play}>
            <div className="grid grid-cols-5 mt-[3px]">
              <div className="pr-2 transition-opacity duration-500" style={{ opacity: play ? 1 : 0, transitionDelay: "300ms" }}>
                <span className="block h-[15px] w-[15px] rounded-full" style={{ background: SIGNATURE }} />
                <p className="md:hidden mt-2 text-[11px] font-semibold uppercase" style={{ color: QUIET_INK }}>
                  Mon
                </p>
                <p className="mt-2 md:mt-3 text-[12px] sm:text-[14px] font-semibold leading-snug" style={{ color: INK }}>
                  Written, signed off, filed
                </p>
              </div>
              <div
                className="col-span-4 pl-2 transition-all duration-1000"
                style={{
                  opacity: play ? 1 : 0,
                  transform: play ? "none" : "translateX(-12px)",
                  transitionDelay: `${TRAVEL + 300}ms`,
                }}
              >
                <p className="text-[18px] sm:text-[24px] font-semibold leading-snug" style={{ color: INK, fontFamily: DISPLAY_FONT }}>
                  Tuesday to Friday, back with the people you support.
                </p>
              </div>
            </div>
          </Track>
        </div>
      </Reveal>

      <Reveal delay={500} className="mt-8 [@media(max-height:820px)]:mt-5">
        <PrimaryButton onClick={onContinue}>Tell us about your team</PrimaryButton>
      </Reveal>
    </GetStartedShell>
  );
}
