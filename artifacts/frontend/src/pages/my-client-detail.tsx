import { useEffect, useRef, useState } from "react";
import type { ComponentType, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  GripVertical,
  Languages,
  ListChecks,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Target,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  createMyClientNote,
  createMyClientSession,
  getMyClientDetail,
  getMyClientNdisPlan,
  type GoalDetail,
  type GoalProgressNote,
  type WorkerClientDetail,
} from "@/services/workerService";
import { ActiveGoalsPanel } from "@/components/ActiveGoalsPanel";
import { useToast } from "@/hooks/use-toast";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

type TabKey = "overview" | "plan" | "sessions" | "notes" | "compliance";
type ClientSummary = WorkerClientDetail["participant"];
type LiveSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
};
type LiveSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: LiveSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type LiveSpeechWindow = Window & {
  SpeechRecognition?: new () => LiveSpeechRecognition;
  webkitSpeechRecognition?: new () => LiveSpeechRecognition;
};

const INPUT_LANGUAGES = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
  { value: "sw", label: "Swahili" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "pt", label: "Portuguese" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "vi", label: "Vietnamese" },
  { value: "tl", label: "Tagalog" },
  { value: "ur", label: "Urdu" },
  { value: "fa", label: "Persian" },
  { value: "ru", label: "Russian" },
  { value: "uk", label: "Ukrainian" },
  { value: "nl", label: "Dutch" },
  { value: "tr", label: "Turkish" },
  { value: "id", label: "Indonesian" },
  { value: "ms", label: "Malay" },
  { value: "th", label: "Thai" },
  { value: "pl", label: "Polish" },
  { value: "ro", label: "Romanian" },
  { value: "el", label: "Greek" },
] as const;

const SPEECH_LANGUAGE_CODES: Record<string, string> = {
  en: "en-AU",
  es: "es-ES",
  fr: "fr-FR",
  ar: "ar-SA",
  sw: "sw-KE",
  zh: "zh-CN",
  hi: "hi-IN",
  pt: "pt-PT",
  de: "de-DE",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  vi: "vi-VN",
  tl: "tl-PH",
  ur: "ur-PK",
  fa: "fa-IR",
  ru: "ru-RU",
  uk: "uk-UA",
  nl: "nl-NL",
  tr: "tr-TR",
  id: "id-ID",
  ms: "ms-MY",
  th: "th-TH",
  pl: "pl-PL",
  ro: "ro-RO",
  el: "el-GR",
};

function safeDate(value?: string | null) {
  if (!value) return "Not recorded";
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function statusClass(status?: string) {
  if (status === "compliant") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "non_compliant") return "border-red-200 bg-red-50 text-red-700";
  if (status === "draft") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function restrictivePracticeWarning(text: string) {
  const normalized = text.toLowerCase();
  if (/\b(lock|locked|locking)\b.*\b(door|room|outside|inside)\b/.test(normalized)) {
    return "Possible restrictive practice language detected: locked door or room restriction.";
  }
  if (/\b(restrain|restrained|restraint|seclusion|chemical restraint|blocked exit)\b/.test(normalized)) {
    return "Possible restrictive practice language detected. Review before saving.";
  }
  return "";
}

function Section({ title, icon: Icon, children }: { title: string; icon: ComponentType<{ size?: number }>; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center gap-2">
        <Icon size={18} />
        <h2 className="text-lg font-black" style={{ color: TEXT }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function activeGoals(goals?: Array<Record<string, unknown>>) {
  if (!goals || goals.length === 0) return [];
  return goals.filter((goal) => {
    const status = String(goal.status || "active").toLowerCase();
    return status !== "completed" && status !== "achieved" && status !== "archived";
  });
}

function ProminentAlertCard({
  title,
  icon: Icon,
  text,
}: {
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  text: string;
}) {
  return (
    <section className="rounded-lg border-2 border-red-200 bg-red-50 p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-red-700">
        <Icon size={18} />
        <h2 className="text-lg font-black">{title}</h2>
      </div>
      <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-red-800">{text}</p>
    </section>
  );
}

function ParticipantSnapshotCard({ client }: { client: ClientSummary }) {
  return (
    <Section title="Participant Snapshot" icon={ClipboardList}>
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ["Name", client.full_name],
          ["NDIS Number", client.ndis_number],
          ["Date of Birth", client.date_of_birth ? safeDate(client.date_of_birth) : ""],
          ["Plan Status", client.plan_status],
          ["Plan Start", client.plan_start_date ? safeDate(client.plan_start_date) : ""],
          ["Plan End", client.plan_end_date ? safeDate(client.plan_end_date) : ""],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[#F8F6FE] p-3">
            <dt className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>{label}</dt>
            <dd className="mt-1 text-sm font-bold" style={{ color: TEXT }}>{value || "Not recorded"}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function SessionConfidenceCard({ client }: { client: ClientSummary }) {
  const goals = activeGoals(client.goals);
  const items: Array<{ label: string; ready: boolean }> = [
    { label: "NDIS goals reviewed", ready: goals.length > 0 },
    { label: "Allergies checked", ready: Boolean(client.allergies?.trim()) },
    { label: "Support preferences reviewed", ready: Boolean(client.communication_preferences?.trim()) },
    {
      label: "Behaviour support reviewed",
      ready: Boolean(client.behaviour_support_plan?.trim() || client.restricted_behavioural_notes?.trim()),
    },
  ];
  const readyCount = items.filter((item) => item.ready).length;
  return (
    <Section title="Session Confidence" icon={ListChecks}>
      <p className="mb-3 text-sm font-medium" style={{ color: MUTED }}>
        {readyCount} of {items.length} key participant details on file. Review before you begin.
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-sm font-bold" style={{ color: item.ready ? TEXT : MUTED }}>
            {item.ready ? (
              <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
            ) : (
              <Circle size={18} className="shrink-0" style={{ color: BORDER }} />
            )}
            <span>{item.label}</span>
            {!item.ready && <span className="text-xs font-bold" style={{ color: MUTED }}>· Not recorded</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ParticipantReadiness({ client, columns = 1 }: { client: ClientSummary; columns?: 1 | 2 }) {
  const goals = activeGoals(client.goals);

  const medicalCard = client.primary_disability?.trim() ? (
    <ProminentAlertCard title="Medical Alerts" icon={ShieldAlert} text={client.primary_disability} />
  ) : null;

  const allergiesCard = client.allergies?.trim() ? (
    <ProminentAlertCard title="Allergies" icon={AlertTriangle} text={client.allergies} />
  ) : null;

  const preferencesCard = client.communication_preferences?.trim() ? (
    <Section title="Support Preferences & Sensitivities" icon={MessageCircle}>
      <p className="whitespace-pre-wrap text-sm font-medium leading-6" style={{ color: TEXT }}>
        {client.communication_preferences}
      </p>
    </Section>
  ) : null;

  const behaviourCard = client.behaviour_support_plan?.trim() || client.restricted_behavioural_notes?.trim() ? (
    <Section title="Behaviour Support" icon={ShieldCheck}>
      <div className="space-y-3">
        {client.behaviour_support_plan?.trim() && (
          <div className="rounded-lg bg-[#F8F6FE] p-3">
            <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>Behaviour Support Plan</p>
            <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-6" style={{ color: TEXT }}>
              {client.behaviour_support_plan}
            </p>
          </div>
        )}
        {client.restricted_behavioural_notes?.trim() && (
          <div className="rounded-lg bg-[#F8F6FE] p-3">
            <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>Behavioural Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-6" style={{ color: TEXT }}>
              {client.restricted_behavioural_notes}
            </p>
          </div>
        )}
      </div>
    </Section>
  ) : null;

  const goalsCard = (
    <ActiveGoalsPanel goals={goals as GoalDetail[]} showCompletedToggle compact />
  );


  const confidenceCard = <SessionConfidenceCard client={client} />;

  const safetyGroup = (medicalCard || allergiesCard || preferencesCard || behaviourCard) ? (
    <div className="space-y-6">
      {medicalCard}
      {allergiesCard}
      {preferencesCard}
      {behaviourCard}
    </div>
  ) : null;

  const goalsGroup = (
    <div className="space-y-6">
      {goalsCard}
      {confidenceCard}
    </div>
  );

  if (columns === 1) {
    return (
      <div className="space-y-6">
        <ParticipantSnapshotCard client={client} />
        {safetyGroup}
        {goalsGroup}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ParticipantSnapshotCard client={client} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {safetyGroup ?? <div className="hidden lg:block" />}
        {goalsGroup}
      </div>
    </div>
  );
}

function SplitSessionLayout({
  split,
  onSplitChange,
  left,
  right,
}: {
  split: number;
  onSplitChange: (value: number) => void;
  left: ReactNode;
  right: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    function move(pointerEvent: PointerEvent) {
      const raw = ((pointerEvent.clientX - rect.left) / rect.width) * 100;
      onSplitChange(Math.min(62, Math.max(34, raw)));
    }

    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div
      ref={containerRef}
      className="grid grid-cols-1 gap-4 xl:grid-cols-[var(--client-panel)_14px_var(--session-panel)] xl:gap-0"
      style={{
        "--client-panel": `minmax(320px, ${split}fr)`,
        "--session-panel": `minmax(360px, ${100 - split}fr)`,
      } as CSSProperties}
    >
      <div className="min-w-0 space-y-6">{left}</div>
      <button
        type="button"
        onPointerDown={startDrag}
        className="hidden cursor-col-resize items-center justify-center rounded-full border bg-white shadow-sm transition hover:bg-[#F8F6FE] xl:flex"
        style={{ borderColor: BORDER, color: MUTED }}
        aria-label="Resize client overview and live session panels"
      >
        <GripVertical size={18} />
      </button>
      <div className="min-w-0">{right}</div>
    </div>
  );
}

type ComposerStep = "record" | "goals" | "choice" | "review";

function GoalSelector({
  goals,
  selected,
  notes,
  onToggle,
  onNoteChange,
}: {
  goals: GoalDetail[];
  selected: Set<string>;
  notes: Record<string, GoalProgressNote>;
  onToggle: (goal: GoalDetail) => void;
  onNoteChange: (goalId: string, field: keyof GoalProgressNote, value: string) => void;
}) {
  if (goals.length === 0) {
    return (
      <p className="text-sm font-medium py-4" style={{ color: MUTED }}>
        No active goals found for this participant. You can still save the session.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {goals.map((goal, index) => {
        const isSelected = selected.has(goal.id);
        const title = goal.title || goal.description || `Goal ${index + 1}`;
        const note = notes[goal.id];
        return (
          <div key={goal.id} className="rounded-lg border" style={{ borderColor: isSelected ? PLUM : "#EEEAFB" }}>
            <button
              type="button"
              onClick={() => onToggle(goal)}
              className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-[#F8F6FE]"
            >
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2"
                style={{
                  borderColor: isSelected ? PLUM : "#C4B8E8",
                  background: isSelected ? PLUM : "transparent",
                }}
              >
                {isSelected && <CheckCircle2 size={13} className="text-white" />}
              </span>
              <span className="flex-1">
                <span className="text-sm font-black" style={{ color: TEXT }}>{title}</span>
                {goal.why_it_matters && (
                  <span className="block text-xs font-medium mt-0.5" style={{ color: MUTED }}>
                    {goal.why_it_matters}
                  </span>
                )}
              </span>
            </button>
            {isSelected && (
              <div className="border-t px-3 pb-3 pt-2 space-y-2" style={{ borderColor: "#EEEAFB" }}>
                {(["evidence_provided", "outcome", "observation"] as const).map((field) => (
                  <div key={field}>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1" style={{ color: MUTED }}>
                      {field === "evidence_provided" ? "Evidence Provided" : field === "outcome" ? "Outcome" : "Observation"}
                    </label>
                    <textarea
                      value={note?.[field] || ""}
                      onChange={(e) => onNoteChange(goal.id, field, e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border bg-white px-3 py-2 text-sm font-medium outline-none focus:border-[#5533CC]"
                      style={{ borderColor: "#E2DEF2", color: TEXT }}
                      placeholder={
                        field === "evidence_provided"
                          ? "What did you do to support this goal?"
                          : field === "outcome"
                          ? "What result was observed?"
                          : "Describe the participant's response or behaviour."
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InlineSessionComposer({
  clientName,
  goals,
  draft,
  inputValue,
  generated,
  attachmentName,
  isListening,
  language,
  ended,
  isGenerating,
  isTranslating,
  translatedFromLang,
  isSaving,
  error,
  selectedGoals,
  goalNotes,
  choiceControl,
  onInputChange,
  onCommitInput,
  onGeneratedChange,
  onLanguageChange,
  onAttach,
  onToggleDictation,
  onEnd,
  onTranslate,
  onGenerate,
  onSave,
  onClose,
  onToggleGoal,
  onGoalNoteChange,
  onChoiceControlChange,
}: {
  clientName: string;
  goals: GoalDetail[];
  draft: string;
  inputValue: string;
  generated: string;
  attachmentName: string;
  isListening: boolean;
  language: string;
  ended: boolean;
  isGenerating: boolean;
  isTranslating: boolean;
  translatedFromLang: string;
  isSaving: boolean;
  error?: string;
  selectedGoals: Set<string>;
  goalNotes: Record<string, GoalProgressNote>;
  choiceControl: string;
  onInputChange: (value: string) => void;
  onCommitInput: () => void;
  onGeneratedChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onAttach: (file: File | null) => void;
  onToggleDictation: () => void;
  onEnd: () => void;
  onTranslate: () => void;
  onGenerate: () => void;
  onSave: () => void;
  onClose: () => void;
  onToggleGoal: (goal: GoalDetail) => void;
  onGoalNoteChange: (goalId: string, field: keyof GoalProgressNote, value: string) => void;
  onChoiceControlChange: (value: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [composerStep, setComposerStep] = useState<ComposerStep>("record");
  const canSave = ended && Boolean((generated || draft).trim()) && !isSaving;
  const warning = restrictivePracticeWarning(draft);
  const activeGoals = goals.filter((g) => {
    const s = String(g.status || "active").toLowerCase();
    return s !== "completed" && s !== "achieved" && s !== "archived";
  });

  const STEPS: Array<{ key: ComposerStep; label: string }> = [
    { key: "record", label: "Notes" },
    { key: "goals", label: "Goals Worked On" },
    { key: "choice", label: "Choice & Control" },
  ];
  return (
    <section
      className="flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm"
      style={{
        borderColor: BORDER,
        height: "clamp(520px, calc(100vh - 250px), 720px)",
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "#EEEAFB" }}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ color: MUTED }}>
              Live Progress Note
            </p>
            <span
              className="rounded-full border px-2.5 py-1 text-[11px] font-black"
              style={{
                borderColor: ended ? "#E2DEF2" : "#A7F3D0",
                background: ended ? "#F5F3FC" : "#ECFDF5",
                color: ended ? MUTED : "#047857",
              }}
            >
              {ended ? "Ended" : "In progress"}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-black" style={{ color: TEXT }}>{clientName}</h2>
        </div>
        <div className="flex items-center gap-2">
          {!ended && (
            <button
              type="button"
              onClick={() => { onEnd(); setComposerStep("goals"); }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black text-white shadow-sm"
              style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
            >
              <StopCircle size={15} />
              End Session
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 transition hover:bg-[#F5F3FC]"
            style={{ color: MUTED }}
            aria-label="Close session composer"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Step tabs — only visible after session ended */}
      {ended && (
        <div className="shrink-0 flex gap-1 border-b px-4 py-2" style={{ borderColor: "#EEEAFB" }}>
          {STEPS.map((step) => (
            <button
              key={step.key}
              type="button"
              onClick={() => setComposerStep(step.key)}
              className="rounded-full px-3 py-1.5 text-xs font-black transition"
              style={{
                background: composerStep === step.key ? PLUM : "transparent",
                color: composerStep === step.key ? "#fff" : MUTED,
              }}
            >
              {step.label}
            </button>
          ))}
        </div>
      )}

      {/* Step: record (always shown while recording; also accessible after end) */}
      {composerStep === "record" && (
        <>
          <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: "#EEEAFB" }}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
                <Languages size={15} />
                Input language
              </label>
              <select
                value={language}
                onChange={(event) => onLanguageChange(event.target.value)}
                className="h-10 rounded-full border bg-[#F8F6FE] px-4 text-sm font-bold outline-none"
                style={{ borderColor: BORDER, color: TEXT }}
              >
                {INPUT_LANGUAGES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#FBFAFF] p-4">
            <div className="mx-auto max-w-3xl space-y-3">
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-bold shadow-sm" style={{ borderColor: BORDER, color: MUTED }}>
                {isListening && (
                  <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
                    <span className="h-2 w-1 animate-pulse rounded-full" style={{ background: PLUM }} />
                    <span className="h-3 w-1 animate-pulse rounded-full [animation-delay:120ms]" style={{ background: PLUM }} />
                    <span className="h-4 w-1 animate-pulse rounded-full [animation-delay:240ms]" style={{ background: PLUM }} />
                    <span className="h-2.5 w-1 animate-pulse rounded-full [animation-delay:360ms]" style={{ background: PLUM }} />
                  </span>
                )}
                <span>{isListening ? "Listening..." : ended ? "Session ended — review before saving" : "Ready to listen"}</span>
              </div>

              <div
                className="min-h-[150px] max-h-[260px] overflow-y-auto rounded-2xl border border-dashed bg-transparent p-4 text-base font-medium italic leading-7"
                style={{ borderColor: "#DCD6F1", color: TEXT }}
                aria-live="polite"
              >
                {draft.trim() ? (
                  <p className="whitespace-pre-wrap">{draft}</p>
                ) : (
                  <p style={{ color: MUTED }}>
                    {isListening ? "Listening..." : "Spoken or sent notes will appear here."}
                  </p>
                )}
              </div>

              {warning && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  {warning}
                </div>
              )}

              {ended && generated && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
                    <Sparkles size={14} />
                    Generated compliant note
                  </div>
                  <textarea
                    value={generated}
                    onChange={(event) => onGeneratedChange(event.target.value)}
                    className="min-h-28 w-full rounded-lg border bg-white p-4 text-sm font-medium leading-6 outline-none focus:border-[#5533CC]"
                    style={{ borderColor: BORDER, color: TEXT }}
                  />
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t bg-white p-3" style={{ borderColor: "#EEEAFB" }}>
            {ended ? (
              <div className="space-y-2">
                {translatedFromLang && (
                  <div
                    className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold w-fit"
                    style={{ borderColor: "#C4B8E8", color: PLUM, background: "#F5F3FC" }}
                  >
                    <Languages size={13} />
                    Translated from{" "}
                    {INPUT_LANGUAGES.find((l) => l.value === translatedFromLang)?.label ?? translatedFromLang.toUpperCase()}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={onTranslate}
                    disabled={!draft.trim() || isTranslating || isGenerating}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black transition disabled:opacity-50"
                    style={{ borderColor: PLUM, color: PLUM }}
                  >
                    {isTranslating ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
                    Translate
                  </button>
                  <button
                    type="button"
                    onClick={onGenerate}
                    disabled={!draft.trim() || isGenerating || isTranslating}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black transition disabled:opacity-50"
                    style={{ borderColor: PLUM, color: PLUM }}
                  >
                    {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    Clinical Rewrite
                  </button>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={!canSave}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black text-white transition disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
                  >
                    {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Save Draft
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border bg-white px-3 py-2 shadow-sm" style={{ borderColor: BORDER }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf,.doc,.docx"
                    className="hidden"
                    onChange={(event) => onAttach(event.target.files?.[0] ?? null)}
                  />
                  <input
                    value={inputValue}
                    onChange={(event) => onInputChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onCommitInput();
                      }
                    }}
                    className="min-h-11 flex-1 bg-transparent px-3 text-base font-medium outline-none"
                    style={{ color: TEXT }}
                    placeholder="Message"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-[#F5F3FC]"
                    style={{ color: PLUM }}
                    aria-label="Attach file"
                  >
                    <Paperclip size={22} />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-[#F5F3FC]"
                    style={{ color: PLUM }}
                    aria-label="Add photo evidence"
                  >
                    <Camera size={22} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onToggleDictation}
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-white text-white shadow-lg transition hover:scale-[1.02]"
                  style={{ background: isListening ? CORAL : PLUM }}
                  aria-label={isListening ? "Stop voice dictation" : "Start voice dictation"}
                >
                  {isListening ? <MicOff size={28} /> : <Mic size={30} />}
                </button>
              </div>
            )}
            {!ended && attachmentName && (
              <p className="mt-2 inline-flex max-w-full items-center rounded-full bg-[#F5F3FC] px-3 py-1 text-xs font-bold" style={{ color: PLUM }}>
                <Paperclip size={12} className="mr-1 shrink-0" />
                <span className="truncate">{attachmentName}</span>
              </p>
            )}
          </div>
        </>
      )}

      {/* Step: goals worked on (SCRUM-226) */}
      {composerStep === "goals" && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-3xl space-y-3">
              <p className="text-sm font-medium" style={{ color: MUTED }}>
                Select the goals you worked on during this session and document the evidence, outcome, and observation for each.
              </p>
              <GoalSelector
                goals={activeGoals}
                selected={selectedGoals}
                notes={goalNotes}
                onToggle={onToggleGoal}
                onNoteChange={onGoalNoteChange}
              />
            </div>
          </div>
          <div className="shrink-0 border-t bg-white p-3 flex items-center justify-between gap-3" style={{ borderColor: "#EEEAFB" }}>
            <button type="button" onClick={() => setComposerStep("record")} className="text-sm font-black px-4 py-2 rounded-full border" style={{ borderColor: BORDER, color: MUTED }}>
              ← Back
            </button>
            <div className="flex gap-3">
              <button type="button" onClick={() => setComposerStep("choice")} className="text-sm font-black px-4 py-2 rounded-full text-white" style={{ background: PLUM }}>
                Next: Choice & Control →
              </button>
            </div>
          </div>
        </>
      )}

      {/* Step: choice & control (SCRUM-227) */}
      {composerStep === "choice" && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="rounded-lg border border-purple-100 bg-purple-50 p-4">
                <p className="text-xs font-black uppercase tracking-wider mb-1" style={{ color: PLUM }}>NDIS Practice Standard</p>
                <p className="text-sm font-bold" style={{ color: TEXT }}>Choice and Control · Person-Centred Supports</p>
              </div>
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider mb-2" style={{ color: MUTED }}>
                  Participant Choice & Control
                </label>
                <textarea
                  value={choiceControl}
                  onChange={(e) => onChoiceControlChange(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg border bg-white p-4 text-sm font-medium leading-6 outline-none focus:border-[#5533CC]"
                  style={{ borderColor: BORDER, color: TEXT }}
                  placeholder="Describe how the participant exercised choice during the session. e.g., Participant chose the location for today's community outing."
                />
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t bg-white p-3 flex items-center justify-between gap-3" style={{ borderColor: "#EEEAFB" }}>
            <button type="button" onClick={() => setComposerStep("goals")} className="text-sm font-black px-4 py-2 rounded-full border" style={{ borderColor: BORDER, color: MUTED }}>
              ← Back
            </button>
            <div className="flex gap-3">
              <button type="button" onClick={() => setComposerStep("record")} className="text-sm font-black px-4 py-2 rounded-full border" style={{ borderColor: BORDER, color: MUTED }}>
                Back to Notes
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!canSave}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-5 text-sm font-black text-white transition disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Draft
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SessionRows({ rows }: { rows: WorkerClientDetail["sessions"] }) {
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm font-medium" style={{ color: MUTED }}>No worker-owned records returned.</p>}
      {rows.map((session) => (
        <div key={session.id} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-black capitalize" style={{ color: TEXT }}>{(session.session_type || "session").replace("_", " ")}</p>
              <p className="text-sm font-medium" style={{ color: MUTED }}>{safeDate(session.session_date)} · {session.duration_minutes || 0} min</p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${statusClass(session.compliance_status || session.status)}`}>
              {session.compliance_score ?? session.status ?? "draft"}
            </span>
          </div>
          {session.legal_record_text && (
            <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>{session.legal_record_text}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function MyClientDetail({ id }: { id: string }) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [noteText, setNoteText] = useState("");
  const [sessionComposerOpen, setSessionComposerOpen] = useState(false);
  const [sessionSplit, setSessionSplit] = useState(45);
  const [sessionDraft, setSessionDraft] = useState("");
  const [sessionInput, setSessionInput] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [sessionAttachmentName, setSessionAttachmentName] = useState("");
  const [sessionEnded, setSessionEnded] = useState(false);
  const [inputLanguage, setInputLanguage] = useState("auto");
  const [composerError, setComposerError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedFromLang, setTranslatedFromLang] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionEndTime, setSessionEndTime] = useState<Date | null>(null);
  const [isListening, setIsListening] = useState(false);
  // SCRUM-226: goals worked on during session
  const [selectedGoals, setSelectedGoals] = useState<Set<string>>(new Set());
  const [goalNotes, setGoalNotes] = useState<Record<string, GoalProgressNote>>({});
  // SCRUM-227: participant choice & control
  const [choiceControl, setChoiceControl] = useState("");
  const recognitionRef = useRef<LiveSpeechRecognition | null>(null);
  const dictationBaseRef = useRef("");
  const dictationFinalRef = useRef("");
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["worker", "my-client", id], queryFn: () => getMyClientDetail(id) });
  const planQuery = useQuery({ queryKey: ["worker", "my-client", id, "plan"], queryFn: () => getMyClientNdisPlan(id) });

  const saveSessionDraft = useMutation({
    mutationFn: () => {
      const goalProgressNotes: GoalProgressNote[] = Array.from(selectedGoals).map((goalId) => ({
        goal_id: goalId,
        goal_title: goalNotes[goalId]?.goal_title ?? "",
        evidence_provided: goalNotes[goalId]?.evidence_provided,
        outcome: goalNotes[goalId]?.outcome,
        observation: goalNotes[goalId]?.observation,
      }));
      const start = sessionStartTime ?? new Date();
      const end = sessionEndTime ?? new Date();
      const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
      const fmt = (d: Date) =>
        d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
      return createMyClientSession(id, {
        status: "draft",
        session_type: "support_work",
        duration_minutes: durationMinutes,
        start_time: fmt(start),
        end_time: fmt(end),
        notes: generatedNote.trim() || sessionDraft.trim(),
        goal_progress_notes: goalProgressNotes,
        participant_choice_control: choiceControl.trim() || undefined,
      });
    },
    onSuccess: () => {
      setSessionDraft("");
      setSessionInput("");
      setGeneratedNote("");
      setSessionAttachmentName("");
      setSessionEnded(false);
      setTranslatedFromLang("");
      setSessionStartTime(null);
      setSessionEndTime(null);
      setSelectedGoals(new Set());
      setGoalNotes({});
      setChoiceControl("");
      stopSessionDictation();
      setComposerError("");
      setSessionComposerOpen(false);
      queryClient.invalidateQueries({ queryKey: ["worker", "my-client", id] });
      queryClient.invalidateQueries({ queryKey: ["worker", "my-compliance"] });
      toast({ title: "Draft saved", description: "The session draft is saved against this client." });
    },
    onError: (error) => {
      setComposerError(error instanceof Error ? error.message : "Could not save the draft.");
    },
  });

  const createNote = useMutation({
    mutationFn: () => createMyClientNote(id, { notes: noteText }),
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["worker", "my-client", id] });
      queryClient.invalidateQueries({ queryKey: ["worker", "my-compliance"] });
    },
  });

  function resetSessionComposer() {
    stopSessionDictation();
    setSessionDraft("");
    setSessionInput("");
    setGeneratedNote("");
    setSessionAttachmentName("");
    setSessionEnded(false);
    setComposerError("");
    setTranslatedFromLang("");
    setSessionStartTime(null);
    setSessionEndTime(null);
    setSelectedGoals(new Set());
    setGoalNotes({});
    setChoiceControl("");
  }

  function openSessionComposer() {
    setActiveTab("overview");
    if (!sessionComposerOpen) {
      resetSessionComposer();
      setSessionStartTime(new Date());
    }
    setSessionComposerOpen(true);
  }

  function endSessionComposer() {
    stopSessionDictation();
    commitSessionInput();
    setSessionEnded(true);
    setSessionEndTime(new Date());
    setComposerError("");
  }

  function toggleGoal(goal: GoalDetail) {
    setSelectedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(goal.id)) {
        next.delete(goal.id);
      } else {
        next.add(goal.id);
        // Pre-populate goal_title when first selected
        setGoalNotes((n) => ({
          ...n,
          [goal.id]: {
            goal_id: goal.id,
            goal_title: goal.title || goal.description || "",
            ...(n[goal.id] || {}),
          },
        }));
      }
      return next;
    });
  }

  function handleGoalNoteChange(goalId: string, field: keyof GoalProgressNote, value: string) {
    setGoalNotes((prev) => ({
      ...prev,
      [goalId]: {
        ...(prev[goalId] || { goal_id: goalId, goal_title: "" }),
        [field]: value,
      },
    }));
  }

  function stopSessionDictation() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    dictationBaseRef.current = "";
    dictationFinalRef.current = "";
    setIsListening(false);
  }

  function appendSessionDraft(text: string) {
    const cleanText = text.trim();
    if (!cleanText) return;
    setSessionDraft((current) => [current.trim(), cleanText].filter(Boolean).join("\n\n"));
  }

  function commitSessionInput() {
    const cleanInput = sessionInput.trim();
    if (!cleanInput) return;
    appendSessionDraft(cleanInput);
    setSessionInput("");
    setComposerError("");
  }

  function attachSessionFile(file: File | null) {
    if (!file) return;
    setSessionAttachmentName(file.name);
    setSessionDraft((current) => {
      const attachmentLine = `[Attachment selected: ${file.name}]`;
      if (current.includes(attachmentLine)) return current;
      return [current.trim(), attachmentLine].filter(Boolean).join("\n\n");
    });
    setComposerError("");
  }

  function toggleSessionDictation() {
    if (sessionEnded) return;
    if (recognitionRef.current) {
      stopSessionDictation();
      return;
    }

    if (typeof window === "undefined") return;
    const speechWindow = window as unknown as LiveSpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setComposerError("Voice dictation is not supported in this browser. Use Chrome or Edge, or type the note.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LANGUAGE_CODES[inputLanguage] || "en-AU";
    dictationBaseRef.current = sessionDraft.trim();
    dictationFinalRef.current = "";

    recognition.onresult = (event) => {
      let finalPart = "";
      let interimPart = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript || "";
        if (result.isFinal) {
          finalPart = `${finalPart} ${transcript}`.trim();
        } else {
          interimPart = `${interimPart} ${transcript}`.trim();
        }
      }

      if (finalPart) {
        dictationFinalRef.current = `${dictationFinalRef.current} ${finalPart}`.trim();
      }

      const liveText = [dictationFinalRef.current, interimPart].filter(Boolean).join(" ").trim();
      setSessionDraft([dictationBaseRef.current, liveText].filter(Boolean).join("\n\n"));
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      dictationBaseRef.current = "";
      dictationFinalRef.current = "";
      setIsListening(false);
    };

    recognition.onerror = () => {
      recognitionRef.current = null;
      dictationBaseRef.current = "";
      dictationFinalRef.current = "";
      setIsListening(false);
      setComposerError("Voice dictation stopped. Please try again or type the note.");
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
    setComposerError("");
  }

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  async function translateNote() {
    if (!sessionEnded) {
      setComposerError("End the session before translating.");
      return;
    }
    if (!sessionDraft.trim() || isTranslating) return;
    setComposerError("");
    setTranslatedFromLang("");
    setIsTranslating(true);
    try {
      const response = await apiFetch("/api/ai/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sessionDraft.trim(),
          source_language: inputLanguage === "auto" ? "auto" : inputLanguage,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.detail ||
            "Translation service is currently unavailable. You can still save your original note."
        );
      }
      const data = await response.json();
      const translated = (data.translated || "").trim();
      if (translated) {
        setGeneratedNote(translated);
        setTranslatedFromLang(data.detected_language || "");
      }
    } catch (error) {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Translation service is currently unavailable. You can still save your original note."
      );
    } finally {
      setIsTranslating(false);
    }
  }

  async function generateCompliantNote() {
    if (!sessionEnded) {
      setComposerError("End the session before generating the compliant note.");
      return;
    }
    const baseText = generatedNote.trim() || sessionDraft.trim();
    if (!baseText || isGenerating) return;
    setComposerError("");
    setIsGenerating(true);
    try {
      // If a translation already exists the text is English; otherwise pass the original language
      const sourceLang = translatedFromLang ? "en" : (inputLanguage === "auto" ? "auto" : inputLanguage);
      const textPayload =
        sourceLang === "auto" || sourceLang === "en"
          ? baseText
          : `[Input language: ${sourceLang}]\n${baseText}`;
      const response = await apiFetch("/api/ai/clinical-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textPayload, source_language: sourceLang }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.detail ||
            "Clinical rewrite service is currently unavailable. You can still save your original note."
        );
      }
      const data = await response.json();
      const raw = data.clinical || data.note || data.text;
      let rewrittenText: string;
      if (typeof raw === "string") {
        rewrittenText = raw;
      } else if (raw && typeof raw === "object") {
        rewrittenText = Object.entries(raw as Record<string, string>)
          .filter(([, v]) => v && String(v).trim())
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n\n");
      } else {
        rewrittenText = baseText;
      }
      setGeneratedNote(rewrittenText);
      if (data.translated_from && !translatedFromLang) {
        setTranslatedFromLang(data.translated_from);
      }
    } catch (error) {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Clinical rewrite service is currently unavailable. You can still save your original note."
      );
    } finally {
      setIsGenerating(false);
    }
  }

  if (detailQuery.isLoading) return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>Loading client...</div>;
  if (detailQuery.error) return <div className="p-6 text-sm font-bold text-red-600">{(detailQuery.error as Error).message}</div>;

  const detail = detailQuery.data as WorkerClientDetail;
  const client = detail.participant;
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "Client Overview" },
    { key: "plan", label: "NDIS Plan" },
    { key: "sessions", label: "Sessions" },
    { key: "notes", label: "Notes" },
    { key: "compliance", label: "Compliance" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Worker</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
            {client.full_name} - Brief Overview
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={openSessionComposer}
            disabled={saveSessionDraft.isPending}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
          >
            {saveSessionDraft.isPending ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            Start Session
          </button>
          <button
            onClick={() => setActiveTab("notes")}
            className="inline-flex items-center gap-2 rounded-full border bg-white px-5 py-3 text-sm font-black shadow-sm"
            style={{ borderColor: BORDER, color: PLUM }}
          >
            <Plus size={16} />
            New Note
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-lg border bg-white p-2" style={{ borderColor: BORDER }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="shrink-0 rounded-full px-4 py-2 text-sm font-black transition"
            style={{ background: activeTab === tab.key ? SOFT : "transparent", color: activeTab === tab.key ? PLUM : MUTED }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        sessionComposerOpen ? (
          <SplitSessionLayout
            split={sessionSplit}
            onSplitChange={setSessionSplit}
            left={<ParticipantReadiness client={client} columns={1} />}
            right={
              <InlineSessionComposer
                clientName={client.full_name}
                goals={(client.goals as GoalDetail[]) ?? []}
                draft={sessionDraft}
                inputValue={sessionInput}
                generated={generatedNote}
                attachmentName={sessionAttachmentName}
                isListening={isListening}
                language={inputLanguage}
                ended={sessionEnded}
                isGenerating={isGenerating}
                isTranslating={isTranslating}
                translatedFromLang={translatedFromLang}
                isSaving={saveSessionDraft.isPending}
                error={composerError || (saveSessionDraft.error instanceof Error ? saveSessionDraft.error.message : "")}
                selectedGoals={selectedGoals}
                goalNotes={goalNotes}
                choiceControl={choiceControl}
                onInputChange={setSessionInput}
                onCommitInput={commitSessionInput}
                onGeneratedChange={setGeneratedNote}
                onLanguageChange={setInputLanguage}
                onAttach={attachSessionFile}
                onToggleDictation={toggleSessionDictation}
                onEnd={endSessionComposer}
                onTranslate={translateNote}
                onGenerate={generateCompliantNote}
                onSave={() => saveSessionDraft.mutate()}
                onClose={() => {
                  stopSessionDictation();
                  setSessionComposerOpen(false);
                }}
                onToggleGoal={toggleGoal}
                onGoalNoteChange={handleGoalNoteChange}
                onChoiceControlChange={setChoiceControl}
              />
            }
          />
        ) : (
          <ParticipantReadiness client={client} columns={2} />
        )
      )}

      {activeTab === "plan" && (
        <div className="space-y-6">
          {planQuery.isLoading && <p className="text-sm font-bold" style={{ color: MUTED }}>Loading plan...</p>}
          <ActiveGoalsPanel
            goals={(planQuery.data?.goals ?? client.goals ?? []) as GoalDetail[]}
            showCompletedToggle
          />
        </div>
      )}

      {activeTab === "sessions" && (
        <Section title="Assigned Sessions For This Worker" icon={CalendarDays}>
          <SessionRows rows={detail.sessions} />
        </Section>
      )}

      {activeTab === "notes" && (
        <div className="space-y-6">
          <Section title="New Note" icon={FileText}>
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="min-h-32 w-full rounded-lg border bg-white p-4 text-sm font-medium outline-none focus:border-[#5533CC]"
              style={{ borderColor: BORDER, color: TEXT }}
              placeholder="Write a worker-owned progress note..."
            />
            {createNote.error && <p className="mt-3 text-sm font-bold text-red-600">{(createNote.error as Error).message}</p>}
            <button
              disabled={!noteText.trim() || createNote.isPending}
              onClick={() => createNote.mutate()}
              className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              style={{ background: PLUM }}
            >
              {createNote.isPending && <Loader2 size={16} className="animate-spin" />}
              Save Note
            </button>
          </Section>
          <Section title="My Notes" icon={FileText}>
            <SessionRows rows={detail.notes} />
          </Section>
        </div>
      )}

      {activeTab === "compliance" && (
        <Section title="My Compliance For This Client" icon={ShieldCheck}>
          <SessionRows rows={detail.compliance} />
        </Section>
      )}
    </div>
  );
}
