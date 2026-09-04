import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import {
  ACCENTS,
  SIGNATURE,
  INK,
  QUIET_INK,
  RULE,
  DISPLAY_FONT,
  Answers,
  Card,
  GetStartedShell,
  Pill,
  PrimaryButton,
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
    <Card className="h-fit">
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
                  <span style={{ color: RULE }}>&mdash;</span>
                )}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
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
      <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-8">
        <div>
          <Pill accent={ACCENTS[qIndex]}>
            Question {qIndex + 1} of {QUESTIONS.length}
          </Pill>
          <h1
            className="mt-4 text-xl font-black leading-snug max-w-md"
            style={{ color: INK, fontFamily: DISPLAY_FONT }}
          >
            {question.prompt}
          </h1>

          <div className="mt-6 flex flex-col gap-2.5">
            {question.options.map((opt) => {
              const isSelected = selected === opt.value;
              const isOther = opt.value === "other";
              return (
                <div key={opt.value}>
                  <button
                    type="button"
                    onClick={() => selectOption(opt.value)}
                    className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px]"
                    style={{
                      border: isSelected ? `2px solid ${SIGNATURE}` : `1px solid ${RULE}`,
                      background: isSelected ? "var(--cc-plum-subtle)" : "var(--cc-surface)",
                      color: isSelected ? INK : QUIET_INK,
                      fontWeight: isSelected ? 700 : 500,
                    }}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full grid place-items-center"
                      style={{ border: `2px solid ${isSelected ? SIGNATURE : RULE}` }}
                    >
                      {isSelected && <span className="h-2 w-2 rounded-full" style={{ background: SIGNATURE }} />}
                    </span>
                    {opt.label}
                  </button>
                  {isOther && isSelected && (
                    <div className="mt-2 pl-4">
                      <input
                        type="text"
                        autoFocus
                        value={otherText}
                        onChange={(e) => onChange({ ...answers, [question.otherKey]: e.target.value })}
                        placeholder="Tell us in your own words (optional)"
                        className="w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none"
                        style={{ color: INK, border: `1px solid ${RULE}`, background: "var(--cc-surface)" }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-7 flex items-center justify-between gap-4 max-w-md">
            <button
              type="button"
              onClick={back}
              disabled={qIndex === 0}
              className="h-10 w-10 rounded-full grid place-items-center disabled:opacity-30 disabled:pointer-events-none"
              style={{ border: `1px solid ${RULE}`, color: INK }}
            >
              <ChevronLeft size={17} />
            </button>
            <div className="flex items-center gap-3">
              <SkipToPricingLink onSkip={onSkip} />
              <PrimaryButton onClick={next} disabled={!canAdvance}>
                {qIndex < QUESTIONS.length - 1 ? "Next" : "See my recommendation"}
              </PrimaryButton>
            </div>
          </div>
        </div>

        <ProfilePanel answers={answers} upToIndex={qIndex} />
      </div>
    </GetStartedShell>
  );
}
