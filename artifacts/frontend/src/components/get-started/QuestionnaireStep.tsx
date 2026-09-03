import { useState } from "react";
import {
  SIGNATURE,
  INK,
  QUIET_INK,
  RULE,
  DISPLAY_FONT,
  Answers,
  GetStartedShell,
  FadeIn,
  SkipToPricingLink,
} from "./shared";

type QuestionKey = "teamSize" | "providerType" | "painPoint" | "currentTools";
type OtherKey = "teamSizeOther" | "providerTypeOther" | "painPointOther" | "currentToolsOther";

type QuestionDef = {
  key: QuestionKey;
  otherKey: OtherKey;
  panelLabel: string;
  prompt: string;
  options: { value: string; label: string }[];
};

const QUESTIONS: QuestionDef[] = [
  {
    key: "teamSize",
    otherKey: "teamSizeOther",
    panelLabel: "Team size",
    prompt: "How many people are on your team, including coordinators, support workers, and allied health staff?",
    options: [
      { value: "1-4", label: "1 to 4 people" },
      { value: "5-10", label: "5 to 10 people" },
      { value: "11-25", label: "11 to 25 people" },
      { value: "25+", label: "More than 25 people" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "providerType",
    otherKey: "providerTypeOther",
    panelLabel: "Organisation type",
    prompt: "Which best describes your organisation?",
    options: [
      { value: "registered", label: "Registered NDIS provider" },
      { value: "unregistered", label: "Unregistered NDIS provider" },
      { value: "sole-trader", label: "Sole trader or independent support worker" },
      { value: "allied-health", label: "Allied health practice" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "painPoint",
    otherKey: "painPointOther",
    panelLabel: "Main pain point",
    prompt: "What takes up the most time right now?",
    options: [
      { value: "notes", label: "Writing and chasing progress notes" },
      { value: "compliance", label: "Keeping compliance and audit records ready" },
      { value: "rostering", label: "Coordinating rosters and matching workers to participants" },
      { value: "medication", label: "Managing medication records safely" },
      { value: "too-many-tools", label: "Juggling too many separate tools" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "currentTools",
    otherKey: "currentToolsOther",
    panelLabel: "Current tools",
    prompt: "How do you currently manage documentation?",
    options: [
      { value: "paper", label: "Paper forms" },
      { value: "spreadsheets", label: "Spreadsheets" },
      { value: "software", label: "Another software platform" },
      { value: "none", label: "No formal system yet" },
      { value: "other", label: "Other" },
    ],
  },
];

function answerDisplay(q: QuestionDef, answers: Answers): string | null {
  const value = answers[q.key];
  if (!value) return null;
  if (value === "other") {
    const other = answers[q.otherKey];
    return other && other.trim() ? other.trim() : "Other";
  }
  return q.options.find((o) => o.value === value)?.label ?? null;
}

function ProfilePanel({ answers, upToIndex }: { answers: Answers; upToIndex: number }) {
  return (
    <div className="pl-6 border-l" style={{ borderColor: RULE }}>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: QUIET_INK }}>
        Your organisation, so far
      </p>
      <div className="mt-3">
        {QUESTIONS.map((q, i) => {
          const answered = i <= upToIndex ? answerDisplay(q, answers) : null;
          return (
            <div key={q.key} className="py-3" style={{ borderTop: i === 0 ? undefined : `1px solid ${RULE}` }}>
              <p className="text-[11.5px] font-semibold" style={{ color: QUIET_INK }}>
                {q.panelLabel}
              </p>
              <p className="mt-0.5 text-[14px]" style={{ color: answered ? INK : QUIET_INK }}>
                {answered ? (
                  <FadeIn animKey={answered}>{answered}</FadeIn>
                ) : (
                  <span style={{ color: RULE }}>—</span>
                )}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  answers: Answers;
  onChange: (next: Answers) => void;
  onComplete: () => void;
  onSkip: () => void;
};

export function QuestionnaireStep({ answers, onChange, onComplete, onSkip }: Props) {
  const [qIndex, setQIndex] = useState(0);
  const question = QUESTIONS[qIndex];
  const selected = answers[question.key];
  const otherText = answers[question.otherKey] ?? "";
  const canAdvance = Boolean(selected);

  function selectOption(value: string) {
    onChange({ ...answers, [question.key]: value as never });
  }

  function next() {
    if (!canAdvance) return;
    if (qIndex < QUESTIONS.length - 1) {
      setQIndex(qIndex + 1);
    } else {
      onComplete();
    }
  }

  function back() {
    if (qIndex > 0) setQIndex(qIndex - 1);
  }

  return (
    <GetStartedShell step={4} wide>
      <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-10">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: QUIET_INK }}>
            Question {qIndex + 1} of {QUESTIONS.length}
          </p>
          <h1
            className="mt-2 text-xl font-black leading-snug max-w-md"
            style={{ color: INK, fontFamily: DISPLAY_FONT }}
          >
            {question.prompt}
          </h1>

          <div className="mt-6">
            {question.options.map((opt, i) => {
              const isSelected = selected === opt.value;
              const isOther = opt.value === "other";
              return (
                <div
                  key={opt.value}
                  className="py-2.5"
                  style={{ borderTop: i === 0 ? undefined : `1px solid ${RULE}` }}
                >
                  <button
                    type="button"
                    onClick={() => selectOption(opt.value)}
                    className="w-full text-left pl-3 text-[14px]"
                    style={{
                      color: isSelected ? INK : QUIET_INK,
                      fontWeight: isSelected ? 600 : 500,
                      borderLeft: isSelected ? `2px solid ${SIGNATURE}` : "2px solid transparent",
                    }}
                  >
                    {opt.label}
                  </button>
                  {isOther && isSelected && (
                    <div className="pl-3 mt-2">
                      <input
                        type="text"
                        autoFocus
                        value={otherText}
                        onChange={(e) => onChange({ ...answers, [question.otherKey]: e.target.value })}
                        placeholder="Tell us in your own words (optional)"
                        className="w-full text-[14px] pb-1.5 outline-none bg-transparent border-0 border-b"
                        style={{ color: INK, borderColor: RULE }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex items-center justify-between gap-4 max-w-md">
            <button
              type="button"
              onClick={back}
              disabled={qIndex === 0}
              className="text-[13px] font-semibold disabled:opacity-30 disabled:pointer-events-none"
              style={{ color: INK }}
            >
              Back
            </button>
            <div className="flex items-center gap-5">
              <SkipToPricingLink onSkip={onSkip} />
              <button
                type="button"
                onClick={next}
                disabled={!canAdvance}
                className="h-10 px-4 rounded-md text-white text-[13px] font-semibold disabled:opacity-40 disabled:pointer-events-none"
                style={{ background: SIGNATURE }}
              >
                {qIndex < QUESTIONS.length - 1 ? "Next" : "See my recommendation"}
              </button>
            </div>
          </div>
        </div>

        <ProfilePanel answers={answers} upToIndex={qIndex} />
      </div>
    </GetStartedShell>
  );
}
