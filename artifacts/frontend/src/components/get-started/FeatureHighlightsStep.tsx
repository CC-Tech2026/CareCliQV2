import { useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import {
  SIGNATURE,
  INK,
  QUIET_INK,
  RULE,
  PAPER,
  DISPLAY_FONT,
  GetStartedShell,
  PrimaryButton,
  Reveal,
  prefersReducedMotion,
} from "./shared";

/** One illustrative shift. The participant and times are made up. */
const MOMENTS = [
  { time: "9:02 am", title: "The shift starts", body: "Liam's goals are already on the support worker's phone." },
  { time: "10:40 am", title: "The note is written on the spot", body: "Linked to the goal it's about, while the detail is fresh." },
  { time: "12:34 pm", title: "The coordinator signs it off", body: "From wherever they are. No email chain, no chasing." },
  { time: "12:35 pm", title: "It's in the record", body: "Ready for a plan review or an audit, the same day." },
];

const NOTE =
  "Liam planned the route on his phone and tapped on without a prompt. One reminder at the interchange, then walked the last stretch to campus on his own.";

const STATUS = [
  { label: "Shift in progress", done: false },
  { label: "Draft · saving as you type", done: false },
  { label: "Signed off by Sarah, coordinator", done: true },
  { label: "Filed to Liam's record · audit ready", done: true },
];

function Phone({ stage, typed }: { stage: number; typed: number }) {
  const text = stage >= 2 ? NOTE : NOTE.slice(0, typed);
  const status = STATUS[stage];
  return (
    <div
      className="relative mx-auto w-[290px] sm:w-[310px] rounded-[44px] p-[10px]"
      style={{ background: "#1A1A2E", boxShadow: "0 40px 80px -30px rgba(26,26,46,0.45)" }}
    >
      <div className="rounded-[34px] overflow-hidden" style={{ background: "#FFFFFF" }}>
        <div className="flex justify-center pt-2.5">
          <span className="h-[22px] w-[92px] rounded-full" style={{ background: "#1A1A2E" }} />
        </div>
        <div className="px-5 pt-5 pb-6 min-h-[470px] flex flex-col" style={{ color: "#2D2D3D" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6A6A77" }}>
            Today · Community access
          </p>
          <p className="mt-1 text-[22px] font-bold" style={{ fontFamily: DISPLAY_FONT }}>
            Liam M.
          </p>

          <div className="mt-4 pb-4" style={{ borderBottom: "1px solid rgba(26,26,46,0.1)" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#6A6A77" }}>
              Goal
            </p>
            <p className="mt-0.5 text-[14px] font-semibold">Catch the bus to TAFE on my own</p>
          </div>

          <p className="mt-4 text-[11px] font-semibold" style={{ color: "#6A6A77" }}>
            Progress note
          </p>
          <p className="mt-1 text-[14px] leading-relaxed flex-1">
            {stage === 0 ? (
              <span style={{ color: "#9CA3AF" }}>Notes go here during the shift...</span>
            ) : (
              <>
                {text}
                {stage === 1 && (
                  <span
                    className="inline-block w-[2px] h-[16px] align-[-2px] ml-[1px] animate-pulse"
                    style={{ background: "#E8457A" }}
                  />
                )}
              </>
            )}
          </p>

          <div
            key={stage}
            className="mt-4 flex items-center gap-2 rounded-2xl px-3.5 py-3 text-[12.5px] font-semibold animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none"
            style={{
              background: status.done ? "rgba(22,101,52,0.08)" : "rgba(26,26,46,0.05)",
              color: status.done ? "#166534" : "#2D2D3D",
            }}
          >
            {status.done ? (
              <Check size={15} strokeWidth={3} />
            ) : (
              <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#E8457A" }} />
            )}
            {status.label}
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  onContinue: () => void;
};

export function FeatureHighlightsStep({ onContinue }: Props) {
  const reduced = prefersReducedMotion();
  const [stage, setStage] = useState(reduced ? 3 : 0);
  const [typed, setTyped] = useState(reduced ? NOTE.length : 0);
  const finished = stage === MOMENTS.length - 1;

  // Plays the shift once: a pause, the note typing itself, sign-off, filed.
  useEffect(() => {
    if (stage === 0) {
      const id = setTimeout(() => setStage(1), 1600);
      return () => clearTimeout(id);
    }
    if (stage === 1) {
      if (typed < NOTE.length) {
        const id = setTimeout(() => setTyped((t) => Math.min(NOTE.length, t + 2)), 28);
        return () => clearTimeout(id);
      }
      const id = setTimeout(() => setStage(2), 700);
      return () => clearTimeout(id);
    }
    if (stage === 2) {
      const id = setTimeout(() => setStage(3), 1800);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [stage, typed]);

  function jumpTo(i: number) {
    setTyped(i >= 2 ? NOTE.length : 0);
    setStage(i);
  }

  return (
    <GetStartedShell step={2}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-12 lg:gap-20 items-center">
        <div>
          <Reveal>
            <h1
              className="text-[40px] sm:text-[56px] font-bold tracking-tight leading-[1.02]"
              style={{ color: INK, fontFamily: DISPLAY_FONT }}
            >
              One shift.
              <br />
              <span style={{ color: QUIET_INK }}>Done before lunch.</span>
            </h1>
          </Reveal>

          <Reveal delay={200}>
            <ol className="mt-10 relative">
              {MOMENTS.map((m, i) => {
                const reached = i <= stage;
                const current = i === stage;
                return (
                  <li key={m.time} className="relative pl-8 pb-6 last:pb-0">
                    {i < MOMENTS.length - 1 && (
                      <span className="absolute left-[5px] top-4 bottom-0 w-px" style={{ background: RULE }}>
                        <span
                          className="block w-full transition-[height] duration-700 ease-out"
                          style={{ height: i < stage ? "100%" : "0%", background: SIGNATURE }}
                        />
                      </span>
                    )}
                    <span
                      className="absolute left-0 top-[5px] h-[11px] w-[11px] rounded-full transition-all duration-500"
                      style={{
                        background: reached ? SIGNATURE : PAPER,
                        border: `1.5px solid ${reached ? SIGNATURE : RULE}`,
                        boxShadow: current ? "0 0 0 5px var(--cc-plum-ring)" : "none",
                      }}
                    />
                    <button type="button" onClick={() => jumpTo(i)} className="text-left block">
                      <span
                        className="flex items-baseline gap-3 transition-opacity duration-500"
                        style={{ opacity: reached ? 1 : 0.4 }}
                      >
                        <span className="w-[64px] shrink-0 text-[12.5px] font-semibold tabular-nums" style={{ color: QUIET_INK }}>
                          {m.time}
                        </span>
                        <span className="text-[17px] font-semibold" style={{ color: INK }}>
                          {m.title}
                        </span>
                      </span>
                      <span
                        className="block pl-[76px] mt-1 text-[14px] leading-relaxed transition-opacity duration-500"
                        style={{ color: QUIET_INK, opacity: reached ? 1 : 0.4 }}
                      >
                        {m.body}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Reveal>

          <Reveal delay={400}>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              <PrimaryButton onClick={onContinue}>Why that matters</PrimaryButton>
              {finished && !reduced && (
                <button
                  type="button"
                  onClick={() => jumpTo(0)}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline animate-in fade-in duration-500"
                  style={{ color: QUIET_INK }}
                >
                  <RotateCcw size={13} /> Play it again
                </button>
              )}
            </div>
          </Reveal>
        </div>

        <Reveal delay={300}>
          <Phone stage={stage} typed={typed} />
        </Reveal>
      </div>
    </GetStartedShell>
  );
}
