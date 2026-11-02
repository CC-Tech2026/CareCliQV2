import { useContext, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
  SIGNATURE,
  INK,
  QUIET_INK,
  RULE,
  DISPLAY_FONT,
  Answers,
  FadeIn,
  GetStartedShell,
  PrimaryButton,
  Reveal,
  StepNavContext,
} from "./shared";

type QuestionKey = "teamSize" | "providerType" | "painPoint" | "currentTools";
type OtherKey = "teamSizeOther" | "providerTypeOther" | "painPointOther" | "currentToolsOther";

type QuestionDef = {
  key: QuestionKey;
  otherKey: OtherKey;
  prompt: string;
  options: { value: string; label: string }[];
};

export const QUESTIONS: QuestionDef[] = [
  {
    key: "teamSize",
    otherKey: "teamSizeOther",
    prompt: "How many people are on your team?",
    options: [
      { value: "1-4", label: "1 to 4 people" },
      { value: "5-10", label: "5 to 10 people" },
      { value: "11-25", label: "11 to 25 people" },
      { value: "25+", label: "More than 25 people" },
      { value: "other", label: "Something else" },
    ],
  },
  {
    key: "providerType",
    otherKey: "providerTypeOther",
    prompt: "Which best describes your organisation?",
    options: [
      { value: "registered", label: "Registered NDIS provider" },
      { value: "unregistered", label: "Unregistered NDIS provider" },
      { value: "applying", label: "Applying for NDIS registration" },
      { value: "sole-trader", label: "Sole trader delivering NDIS supports" },
      { value: "other", label: "Something else" },
    ],
  },
  {
    key: "painPoint",
    otherKey: "painPointOther",
    prompt: "What takes up the most time right now?",
    options: [
      { value: "notes", label: "Writing and chasing progress notes" },
      { value: "compliance", label: "Keeping compliance and audit records ready" },
      { value: "rostering", label: "Rosters and matching workers to participants" },
      { value: "medication", label: "Managing medication records safely" },
      { value: "too-many-tools", label: "Juggling too many separate tools" },
      { value: "other", label: "Something else" },
    ],
  },
  {
    key: "currentTools",
    otherKey: "currentToolsOther",
    prompt: "How do you keep records today?",
    options: [
      { value: "paper", label: "Paper forms" },
      { value: "spreadsheets", label: "Spreadsheets" },
      { value: "software", label: "Another software platform" },
      { value: "none", label: "No formal system yet" },
      { value: "other", label: "Something else" },
    ],
  },
];

const PROVIDER_PHRASE: Record<NonNullable<Answers["providerType"]>, string> = {
  registered: "A registered NDIS provider",
  unregistered: "An unregistered NDIS provider",
  applying: "A provider applying for NDIS registration",
  "sole-trader": "A sole trader delivering NDIS supports",
  other: "An NDIS provider",
};

const TEAM_PHRASE: Record<NonNullable<Answers["teamSize"]>, string> = {
  "1-4": "with 1 to 4 people",
  "5-10": "with 5 to 10 people",
  "11-25": "with 11 to 25 people",
  "25+": "with more than 25 people",
  other: "",
};

const PAIN_PHRASE: Record<NonNullable<Answers["painPoint"]>, string> = {
  notes: "losing the most time to progress notes",
  compliance: "keeping audit records ready",
  rostering: "wrestling with rosters",
  medication: "managing medication records",
  "too-many-tools": "juggling too many tools",
  other: "",
};

const TOOLS_PHRASE: Record<NonNullable<Answers["currentTools"]>, string> = {
  paper: "on paper today",
  spreadsheets: "on spreadsheets today",
  software: "on another platform today",
  none: "without a formal system yet",
  other: "",
};

/** The visitor's answers read back as one sentence, built up as they go. */
export function profileSentence(a: Answers): string {
  const subject = a.providerType ? PROVIDER_PHRASE[a.providerType] : a.teamSize ? "A team" : "";
  if (!subject) return "";
  const parts = [
    subject,
    a.teamSize ? TEAM_PHRASE[a.teamSize] : "",
    a.painPoint ? PAIN_PHRASE[a.painPoint] : "",
    a.currentTools ? TOOLS_PHRASE[a.currentTools] : "",
  ].filter(Boolean);
  const [first, second, ...rest] = parts;
  return [first, second].filter(Boolean).join(" ") + (rest.length ? `, ${rest.join(", ")}` : "") + ".";
}

const LETTERS = "ABCDEF";

type Props = {
  answers: Answers;
  onChange: (next: Answers) => void;
  onComplete: () => void;
};

export function QuestionnaireStep({ answers, onChange, onComplete }: Props) {
  const nav = useContext(StepNavContext);
  const [qIndex, setQIndex] = useState(0);
  const question = QUESTIONS[qIndex];
  const selected = answers[question.key];
  const otherText = answers[question.otherKey] ?? "";
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  function next() {
    clearTimeout(advanceTimer.current);
    if (qIndex < QUESTIONS.length - 1) setQIndex(qIndex + 1);
    else onComplete();
  }

  function selectOption(value: string) {
    onChange({ ...answers, [question.key]: value as never });
    clearTimeout(advanceTimer.current);
    // A short beat so the choice registers, then on to the next question.
    // "Something else" waits for them to type.
    if (value !== "other") advanceTimer.current = setTimeout(next, 420);
  }

  function back() {
    clearTimeout(advanceTimer.current);
    if (qIndex > 0) setQIndex(qIndex - 1);
    else nav?.back?.();
  }

  // Letter keys pick an option and Enter moves on, except while typing.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = LETTERS.indexOf(e.key.toUpperCase());
    if (e.key.length === 1 && i >= 0 && i < question.options.length) {
      e.preventDefault();
      selectOption(question.options[i].value);
    } else if (e.key === "Enter" && selected && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      next();
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const sentence = profileSentence(answers);

  return (
    <GetStartedShell step={4} onBack={back}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,640px)_1fr] gap-12 lg:gap-20 items-start">
        <div key={question.key} className="animate-in fade-in slide-in-from-right-4 duration-500 motion-reduce:animate-none">
          <p className="text-[13px] font-semibold tabular-nums" style={{ color: QUIET_INK }}>
            <span style={{ color: SIGNATURE }}>{qIndex + 1}</span> / {QUESTIONS.length}
          </p>
          <h1
            className="mt-3 text-[32px] sm:text-[46px] font-bold tracking-tight leading-[1.08]"
            style={{ color: INK, fontFamily: DISPLAY_FONT }}
          >
            {question.prompt}
          </h1>

          <div className="mt-8" style={{ borderTop: `1px solid ${RULE}` }}>
            {question.options.map((opt, i) => {
              const isSelected = selected === opt.value;
              return (
                <div key={opt.value} style={{ borderBottom: `1px solid ${RULE}` }}>
                  <button
                    type="button"
                    onClick={() => selectOption(opt.value)}
                    aria-pressed={isSelected}
                    className="group w-full flex items-center gap-5 py-4 text-left transition-[padding] duration-300 hover:pl-2"
                  >
                    <span
                      className="h-8 w-8 shrink-0 rounded-full grid place-items-center text-[12px] font-bold transition-colors duration-300"
                      style={{
                        border: `1.5px solid ${isSelected ? SIGNATURE : RULE}`,
                        background: isSelected ? SIGNATURE : "transparent",
                        color: isSelected ? "#FFFFFF" : QUIET_INK,
                      }}
                    >
                      {isSelected ? <Check size={15} strokeWidth={3} /> : LETTERS[i]}
                    </span>
                    <span
                      className="flex-1 text-[17px] sm:text-[19px] transition-colors duration-300"
                      style={{ color: isSelected ? INK : QUIET_INK, fontWeight: isSelected ? 600 : 500 }}
                    >
                      <span className="group-hover:text-[var(--cc-text)]">{opt.label}</span>
                    </span>
                  </button>
                  {opt.value === "other" && isSelected && (
                    <div className="pb-5 pl-[52px] flex flex-wrap items-center gap-4">
                      <input
                        type="text"
                        autoFocus
                        value={otherText}
                        onChange={(e) => onChange({ ...answers, [question.otherKey]: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && next()}
                        placeholder="In your own words (optional)"
                        className="flex-1 min-w-[220px] bg-transparent py-2 text-[17px] outline-none"
                        style={{ color: INK, borderBottom: `1.5px solid ${SIGNATURE}` }}
                      />
                      <PrimaryButton onClick={next}>{qIndex < QUESTIONS.length - 1 ? "Next" : "See our suggestion"}</PrimaryButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-4 hidden sm:block text-[12.5px]" style={{ color: QUIET_INK }}>
            Press {LETTERS[0]} to {LETTERS[question.options.length - 1]} to answer.
          </p>
        </div>

        <Reveal delay={300} className="lg:pt-24">
          <div className="lg:pl-10" style={{ borderLeft: `3px solid ${sentence ? SIGNATURE : RULE}` }}>
            <p className="pl-5 lg:pl-0 text-[12px] font-semibold uppercase tracking-wider" style={{ color: QUIET_INK }}>
              Your organisation
            </p>
            <p
              className="pl-5 lg:pl-0 mt-3 text-[22px] sm:text-[30px] font-semibold tracking-tight leading-snug"
              style={{ color: sentence ? INK : QUIET_INK, fontFamily: DISPLAY_FONT, opacity: sentence ? 1 : 0.5 }}
            >
              {sentence ? <FadeIn animKey={sentence}>{sentence}</FadeIn> : "Builds up here as you answer."}
            </p>
          </div>
        </Reveal>
      </div>
    </GetStartedShell>
  );
}
