import { useEffect, useState } from "react";
import { Keyboard, Mic, RotateCcw } from "lucide-react";
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
import { DEMO_LANGUAGES, ShiftPhone, VOICE_TICKS, type DemoLanguage, type NoteMode } from "./ShiftPhone";

/** One illustrative shift. The participant and times are made up. */
const MOMENTS = [
  { time: "9:02 am", title: "The shift starts", body: "Liam's goals are already on the support worker's phone." },
  {
    time: "10:40 am",
    title: "The note is written on the spot",
    body: "Typed or spoken, in whatever language the worker thinks in. Saved in English, linked to the goal.",
  },
  { time: "12:34 pm", title: "The coordinator signs it off", body: "From wherever they are. No email chain, no chasing." },
  { time: "12:35 pm", title: "It's in the record", body: "Ready for a plan review or an audit, the same day." },
];

const LANGUAGE_ORDER: DemoLanguage[] = ["en", "vi", "zh", "ar"];

/** Outer size of the ShiftPhone frame, in px. */
const PHONE_W = 318;
const PHONE_H = 662;

/** Shrinks the phone on short laptop screens so the step fits the window
 * without scrolling. Phones and tablets keep it full size and scroll. */
function usePhoneScale() {
  const compute = () =>
    typeof window === "undefined" || window.innerWidth < 1024
      ? 1
      : Math.max(0.7, Math.min(1, (window.innerHeight - 120) / PHONE_H));
  const [scale, setScale] = useState(compute);
  useEffect(() => {
    const onResize = () => setScale(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
}

type Props = {
  onContinue: () => void;
};

export function FeatureHighlightsStep({ onContinue }: Props) {
  const reduced = prefersReducedMotion();
  const [language, setLanguage] = useState<DemoLanguage>("vi");
  const [mode, setMode] = useState<NoteMode>("type");
  const [stage, setStage] = useState(reduced ? 3 : 0);
  const [typed, setTyped] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [sent, setSent] = useState(reduced);
  const length = mode === "voice" ? VOICE_TICKS : Array.from(DEMO_LANGUAGES[language].typed).length;
  const finished = stage === MOMENTS.length - 1;
  const phoneScale = usePhoneScale();

  // Plays the shift once: a pause, the note typed (or recorded, then
  // transcribed) and sent, sign-off, filed.
  useEffect(() => {
    if (stage === 0) {
      const id = setTimeout(() => setStage(1), 1600);
      return () => clearTimeout(id);
    }
    if (stage === 1 && processing) {
      const id = setTimeout(() => {
        setProcessing(false);
        setSent(true);
      }, 1400);
      return () => clearTimeout(id);
    }
    if (stage === 1 && !sent) {
      if (typed < length) {
        const id = setTimeout(() => setTyped((t) => Math.min(length, t + 1)), mode === "voice" ? 200 : 30);
        return () => clearTimeout(id);
      }
      const id = setTimeout(() => (mode === "voice" ? setProcessing(true) : setSent(true)), 600);
      return () => clearTimeout(id);
    }
    if (stage === 1 && sent) {
      const id = setTimeout(() => setStage(2), 1600);
      return () => clearTimeout(id);
    }
    if (stage === 2) {
      const id = setTimeout(() => setStage(3), 1800);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [stage, typed, sent, processing, length, mode]);

  function jumpTo(i: number) {
    setTyped(0);
    setProcessing(false);
    setSent(i >= 2);
    setStage(i);
  }

  // Watch the note written again with the new language or input.
  function replayNote() {
    setTyped(0);
    setProcessing(false);
    setSent(reduced);
    setStage(reduced ? 3 : 1);
  }

  function chooseLanguage(next: DemoLanguage) {
    setLanguage(next);
    replayNote();
  }

  function chooseMode(next: NoteMode) {
    setMode(next);
    replayNote();
  }

  return (
    <GetStartedShell step={2}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-12 lg:gap-16 items-center">
        <div>
          <Reveal>
            <h1
              className="text-[40px] sm:text-[52px] [@media(max-height:820px)]:sm:text-[42px] font-bold tracking-tight leading-[1.02]"
              style={{ color: INK, fontFamily: DISPLAY_FONT }}
            >
              One shift.
              <br />
              <span style={{ color: QUIET_INK }}>Done before lunch.</span>
            </h1>
          </Reveal>

          <Reveal delay={200}>
            <ol className="mt-8 [@media(max-height:820px)]:mt-5 relative">
              {MOMENTS.map((m, i) => {
                const reached = i <= stage;
                const current = i === stage;
                return (
                  <li key={m.time} className="relative pl-8 pb-5 [@media(max-height:820px)]:pb-3 last:pb-0">
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
                        <span className="text-[16.5px] font-semibold" style={{ color: INK }}>
                          {m.title}
                        </span>
                      </span>
                      <span
                        className="block pl-[76px] mt-0.5 text-[14px] leading-relaxed transition-opacity duration-500"
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

          <Reveal delay={300}>
            <div className="mt-7 [@media(max-height:820px)]:mt-5 pt-5 [@media(max-height:820px)]:pt-4" style={{ borderTop: `1px solid ${RULE}` }}>
              <p className="text-[13px] font-semibold" style={{ color: INK }}>
                Try it: watch the note
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex rounded-full p-1"
                  style={{ border: `1px solid ${RULE}` }}
                  role="radiogroup"
                  aria-label="How the note is written"
                >
                  {(
                    [
                      { value: "type", label: "Typed", icon: Keyboard },
                      { value: "voice", label: "Spoken", icon: Mic },
                    ] as const
                  ).map(({ value, label, icon: Icon }) => {
                    const active = mode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => chooseMode(value)}
                        className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[13px] font-semibold transition-colors"
                        style={{ background: active ? INK : "transparent", color: active ? PAPER : QUIET_INK }}
                      >
                        <Icon size={14} /> {label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[13px] font-semibold px-1" style={{ color: QUIET_INK }}>
                  in
                </span>
                <div className="inline-flex flex-wrap gap-1.5" role="radiogroup" aria-label="Note language">
                  {LANGUAGE_ORDER.map((code) => {
                    const active = code === language;
                    return (
                      <button
                        key={code}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        lang={DEMO_LANGUAGES[code].htmlLang}
                        onClick={() => chooseLanguage(code)}
                        className="rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors"
                        style={{
                          background: active ? INK : "transparent",
                          color: active ? PAPER : QUIET_INK,
                          border: `1px solid ${active ? INK : RULE}`,
                        }}
                      >
                        {DEMO_LANGUAGES[code].chip}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="mt-2.5 max-w-xl text-[12.5px] leading-relaxed" style={{ color: QUIET_INK }}>
                Workers type, or hold the mic and talk. The app runs in English, Vietnamese, Chinese and
                Arabic, notes can be written or spoken in many more, and every one is saved in English.
              </p>
            </div>
          </Reveal>

          <Reveal delay={400}>
            <div className="mt-7 [@media(max-height:820px)]:mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
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

        <Reveal delay={300} className="justify-self-center">
          <div style={{ width: PHONE_W * phoneScale, height: PHONE_H * phoneScale }}>
            <div style={{ width: PHONE_W, transform: `scale(${phoneScale})`, transformOrigin: "top left" }}>
              <ShiftPhone stage={stage} progress={typed} processing={processing} sent={sent} language={language} mode={mode} />
            </div>
          </div>
        </Reveal>
      </div>
    </GetStartedShell>
  );
}
