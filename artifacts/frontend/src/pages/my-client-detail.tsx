import { useEffect, useRef, useState } from "react";
import type { ComponentType, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { useLocation } from "wouter";
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
  Siren,
  Sparkles,
  StopCircle,
  Target,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { complyIncident, createIncident, getIncidentsByParticipant } from "@/services/incidentService";
import type { IncidentComplyResult } from "@/services/incidentService";
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
  activeGoals: composerGoals,
  goalsAddressed,
  outcome,
  choiceAndControl,
  recommendations,
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
  onGoalsAddressedChange,
  onOutcomeChange,
  onChoiceAndControlChange,
  onRecommendationsChange,
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
  activeGoals?: Array<Record<string, unknown>>;
  goalsAddressed?: string[];
  outcome?: string;
  choiceAndControl?: string;
  recommendations?: string;
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
  onGoalsAddressedChange?: (ids: string[]) => void;
  onOutcomeChange?: (value: string) => void;
  onChoiceAndControlChange?: (value: string) => void;
  onRecommendationsChange?: (value: string) => void;
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

          {ended && (
            <div className="space-y-4 border-t pt-4" style={{ borderColor: "#EEEAFB" }}>

              {composerGoals && composerGoals.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
                    <Target size={12} />
                    Goals Addressed This Session
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {composerGoals.map((goal, idx) => {
                      const gid = String(goal.id ?? idx);
                      const selected = Boolean(goalsAddressed?.includes(gid));
                      return (
                        <button
                          key={gid}
                          type="button"
                          onClick={() => {
                            if (!onGoalsAddressedChange) return;
                            onGoalsAddressedChange(
                              selected
                                ? (goalsAddressed || []).filter((id) => id !== gid)
                                : [...(goalsAddressed || []), gid],
                            );
                          }}
                          className="rounded-full border px-3 py-1.5 text-xs font-bold transition"
                          style={{
                            borderColor: selected ? PLUM : BORDER,
                            background: selected ? SOFT : "white",
                            color: selected ? PLUM : MUTED,
                          }}
                        >
                          {goalLabel(goal, idx)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
                  <CheckCircle2 size={12} />
                  Session Outcome *
                </p>
                <textarea
                  value={outcome ?? ""}
                  onChange={(event) => onOutcomeChange?.(event.target.value)}
                  placeholder="What was achieved? Describe measurable progress and participant response..."
                  rows={3}
                  className="w-full rounded-lg border bg-white p-3 text-sm font-medium leading-6 outline-none focus:border-[#5533CC]"
                  style={{ borderColor: BORDER, color: TEXT }}
                />
              </div>

              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
                  <MessageCircle size={12} />
                  Participant Choice &amp; Control *
                </p>
                <textarea
                  value={choiceAndControl ?? ""}
                  onChange={(event) => onChoiceAndControlChange?.(event.target.value)}
                  placeholder="How did the participant direct this session? What choices did they make regarding their supports?"
                  rows={3}
                  className="w-full rounded-lg border bg-white p-3 text-sm font-medium leading-6 outline-none focus:border-[#5533CC]"
                  style={{ borderColor: BORDER, color: TEXT }}
                />
              </div>

              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
                  <Sparkles size={12} />
                  Recommendations
                </p>
                <textarea
                  value={recommendations ?? ""}
                  onChange={(event) => onRecommendationsChange?.(event.target.value)}
                  placeholder="Recommendations for coordinator or next session (optional)..."
                  rows={2}
                  className="w-full rounded-lg border bg-white p-3 text-sm font-medium leading-6 outline-none focus:border-[#5533CC]"
                  style={{ borderColor: BORDER, color: TEXT }}
                />
              </div>

            </div>
          )}
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

const INCIDENT_TYPES_LIST = [
  { value: "injury", label: "Injury" },
  { value: "medication_error", label: "Medication Error" },
  { value: "behaviour_of_concern", label: "Behaviour of Concern" },
  { value: "property_damage", label: "Property Damage" },
  { value: "abuse_neglect", label: "Abuse / Neglect" },
  { value: "restrictive_practice", label: "Restrictive Practice" },
  { value: "environmental", label: "Environmental Hazard" },
  { value: "elopement", label: "Elopement" },
  { value: "near_miss", label: "Near Miss" },
  { value: "other", label: "Other" },
] as const;

const INCIDENT_SEVERITIES_LIST = [
  { value: "low", label: "Low — minimal impact" },
  { value: "medium", label: "Medium — some impact" },
  { value: "high", label: "High — significant impact" },
  { value: "critical", label: "Critical — life-threatening" },
] as const;

function IncidentReportModal({
  participantId,
  participantName,
  onClose,
}: {
  participantId: string;
  participantName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    incident_type: "injury",
    severity: "medium",
    title: "",
    description: "",
    location: "",
    worker_actions: "",
  });

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const ndisReportable =
    form.incident_type === "abuse_neglect" ||
    form.incident_type === "restrictive_practice" ||
    form.severity === "critical";

  const [comply, setComply] = useState<{ loading: boolean; result: IncidentComplyResult | null }>({
    loading: false,
    result: null,
  });

  async function handleComply() {
    if (!form.description.trim()) {
      toast({ title: "Add a description first", variant: "destructive" });
      return;
    }
    setComply({ loading: true, result: null });
    try {
      const result = await complyIncident({
        incident_type: form.incident_type,
        severity: form.severity,
        title: form.title.trim() || "Incident",
        description: form.description,
        worker_actions: form.worker_actions,
        participant_name: participantName,
      });
      setComply({ loading: false, result });
    } catch {
      setComply({ loading: false, result: null });
      toast({ title: "Compliance check failed", description: "Please try again.", variant: "destructive" });
    }
  }

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast({ title: "Incident title is required", variant: "destructive" });
      return;
    }
    if (!form.description.trim()) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createIncident({
        participant_id: participantId || undefined,
        incident_type: form.incident_type,
        severity: form.severity,
        title: form.title.trim(),
        description: form.description.trim(),
        location: form.location.trim() || undefined,
        worker_actions: form.worker_actions.trim() || undefined,
        incident_date: new Date().toISOString(),
      });
      toast({
        title: "Incident logged",
        description: "The incident has been recorded against this participant.",
        action: (
          <button
            onClick={() => { onClose(); navigate("/incidents"); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/20 px-3 py-1.5 text-xs font-black text-white hover:bg-white/30 transition"
          >
            <Siren size={12} />
            View Incidents
          </button>
        ) as unknown as import("react").ReactElement,
      });
      onClose();
    } catch (err: unknown) {
      const apiErr = err as Error & { status?: number };
      let title = "Incident not saved";
      let description = "An unexpected error occurred. Please try again.";
      if (apiErr.status === 403) {
        description = "You don't have permission to report incidents for this participant. Check your allocation.";
      } else if (apiErr.status === 404) {
        description = "Participant not found — please refresh the page and try again.";
      } else if (apiErr.status === 422) {
        description = "The report could not be processed. Please write the incident in English and try again.";
      } else if (apiErr.message && !apiErr.message.includes("status")) {
        description = apiErr.message;
      }
      toast({ title, description, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: BORDER, maxHeight: "92vh" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-4" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50">
              <Siren size={18} className="text-red-600" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>NDIS Practice Standard 2.3</p>
              <h2 className="text-base font-black" style={{ color: TEXT }}>Report Incident — {participantName}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 transition hover:bg-[#F5F3FC]"
            style={{ color: MUTED }}
            aria-label="Close incident form"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {ndisReportable && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-600" />
              <p className="text-sm font-bold text-red-800">
                NDIS Reportable — notify the NDIS Quality &amp; Safeguards Commission.
                {form.severity === "critical" && " Critical incidents must be reported within 24 hours."}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>Incident Type *</p>
              <select
                value={form.incident_type}
                onChange={(event) => setField("incident_type", event.target.value)}
                className="h-10 w-full rounded-xl border bg-[#F8F6FE] px-3 text-sm font-bold outline-none"
                style={{ borderColor: BORDER, color: TEXT }}
              >
                {INCIDENT_TYPES_LIST.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>Severity *</p>
              <select
                value={form.severity}
                onChange={(event) => setField("severity", event.target.value)}
                className="h-10 w-full rounded-xl border bg-[#F8F6FE] px-3 text-sm font-bold outline-none"
                style={{ borderColor: BORDER, color: TEXT }}
              >
                {INCIDENT_SEVERITIES_LIST.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>Incident Title *</p>
            <input
              value={form.title}
              onChange={(event) => setField("title", event.target.value)}
              placeholder="Brief description of what occurred..."
              className="h-10 w-full rounded-xl border bg-white px-3 text-sm font-medium outline-none focus:border-[#5533CC]"
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>What happened? *</p>
              <button
                type="button"
                onClick={handleComply}
                disabled={comply.loading || !form.description.trim()}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black transition hover:bg-[#F0EDFB] disabled:opacity-40"
                style={{ borderColor: "#C4B8F0", color: PLUM }}
              >
                {comply.loading
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Sparkles size={11} />}
                {comply.loading ? "Checking…" : "Check NDIS Compliance"}
              </button>
            </div>
            <textarea
              value={form.description}
              onChange={(event) => { setField("description", event.target.value); setComply({ loading: false, result: null }); }}
              placeholder="Describe the incident in full — who, what, when, where, how..."
              rows={4}
              className="w-full rounded-xl border bg-white p-3 text-sm font-medium leading-6 outline-none focus:border-[#5533CC]"
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </div>

          {comply.result && (() => {
            const r = comply.result;
            const scoreColor = r.compliance_score >= 75 ? "#10B981" : r.compliance_score >= 50 ? "#F59E0B" : "#EF4444";
            const criteriaLabels: Record<string, string> = {
              factual_completeness: "Factual completeness",
              clinical_language: "Clinical language",
              action_documented: "Actions documented",
              ndis_standard_alignment: "Practice Standard alignment",
              follow_up_indicators: "Follow-up clarity",
            };
            return (
              <div className="space-y-3 rounded-xl border bg-[#F8F6FE] p-4" style={{ borderColor: "#DDD8F5" }}>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>NDIS Compliance Score</p>
                  <span className="text-sm font-black" style={{ color: scoreColor }}>{r.compliance_score}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/70">
                  <div className="h-full rounded-full transition-all" style={{ width: `${r.compliance_score}%`, background: scoreColor }} />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border px-2.5 py-0.5 text-[10px] font-bold" style={{ borderColor: "#C4B8F0", color: PLUM, background: "white" }}>
                    {r.practice_standard}
                  </span>
                  {r.ndis_reportable && (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10px] font-bold text-red-700">
                      NDIS Reportable · notify within {r.notification_hours}h
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-y-2">
                  {Object.entries(r.compliance_criteria).map(([key, val]) => {
                    const c = val >= 75 ? "#10B981" : val >= 50 ? "#F59E0B" : "#EF4444";
                    return (
                      <div key={key}>
                        <div className="mb-0.5 flex justify-between">
                          <span className="text-[10px] font-bold" style={{ color: MUTED }}>{criteriaLabels[key] ?? key}</span>
                          <span className="text-[10px] font-black" style={{ color: c }}>{val}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
                          <div className="h-full rounded-full" style={{ width: `${val}%`, background: c }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {r.compliance_flags.length > 0 && (
                  <div className="space-y-1">
                    {r.compliance_flags.map((flag, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-600" />
                        <p className="text-xs font-medium text-amber-800">{flag}</p>
                      </div>
                    ))}
                  </div>
                )}

                {r.reporting_requirements && (
                  <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-red-700 mb-0.5">Reporting Requirement</p>
                    <p className="text-xs font-medium text-red-800">{r.reporting_requirements}</p>
                  </div>
                )}

                {r.suggested_follow_up && (
                  <div className="rounded-lg bg-white px-3 py-2" style={{ border: `1px solid ${BORDER}` }}>
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] mb-0.5" style={{ color: MUTED }}>Suggested Next Steps</p>
                    <p className="text-xs font-medium" style={{ color: TEXT }}>{r.suggested_follow_up}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setForm(prev => ({
                      ...prev,
                      description: r.compliant_description,
                      worker_actions: r.compliant_worker_actions || prev.worker_actions,
                    }));
                    setComply({ loading: false, result: null });
                    toast({ title: "NDIS-compliant text applied", description: "Review it before submitting." });
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-sm font-black transition hover:bg-white"
                  style={{ borderColor: "#C4B8F0", color: PLUM, background: "rgba(255,255,255,0.5)" }}
                >
                  <Sparkles size={13} />
                  Apply NDIS-Compliant Text to Report
                </button>
              </div>
            );
          })()}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>Location</p>
              <input
                value={form.location}
                onChange={(event) => setField("location", event.target.value)}
                placeholder="Where did it occur?"
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm font-medium outline-none focus:border-[#5533CC]"
                style={{ borderColor: BORDER, color: TEXT }}
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>Immediate Actions</p>
              <input
                value={form.worker_actions}
                onChange={(event) => setField("worker_actions", event.target.value)}
                placeholder="First aid, supervisor notified..."
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm font-medium outline-none focus:border-[#5533CC]"
                style={{ borderColor: BORDER, color: TEXT }}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t px-6 py-4" style={{ borderColor: BORDER }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border px-5 py-2.5 text-sm font-black transition hover:bg-[#F8F6FE]"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-black text-white disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Siren size={15} />}
            Log Incident
          </button>
        </div>
      </div>
    </div>
  );
}

const SEVERITY_ROW_CLASSES: Record<string, string> = {
  low:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium:   "border-amber-200 bg-amber-50 text-amber-700",
  high:     "border-orange-200 bg-orange-50 text-orange-700",
  critical: "border-red-200 bg-red-50 text-red-700",
};

function ParticipantIncidentPanel({ incidents }: { incidents: Array<Record<string, unknown>> }) {
  const [, navigate] = useLocation();
  const recent = incidents.slice(0, 3);
  return (
    <section className="rounded-xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <Siren size={14} className="text-red-600" />
          <p className="text-sm font-black" style={{ color: TEXT }}>Reported Incidents</p>
          <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "#FEF2F2", color: "#DC2626" }}>
            {incidents.length}
          </span>
        </div>
        <button
          onClick={() => navigate("/incidents")}
          className="text-xs font-black underline underline-offset-2 transition hover:opacity-70"
          style={{ color: PLUM }}
        >
          View all
        </button>
      </div>
      <div className="divide-y" style={{ borderColor: "#EEEAFB" }}>
        {recent.map((inc, idx) => {
          const sev = String(inc.severity || "medium");
          const incDate = inc.incident_date ? (() => { try { return formatDistanceToNow(parseISO(String(inc.incident_date)), { addSuffix: true }); } catch { return ""; } })() : "";
          return (
            <button
              key={String(inc.id || idx)}
              onClick={() => navigate(`/incidents/${String(inc.id || "")}`)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-[#F8F6FE]"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>{String(inc.title || "Incident")}</p>
                {incDate && <p className="mt-0.5 text-xs font-medium" style={{ color: MUTED }}>{incDate}</p>}
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold capitalize ${SEVERITY_ROW_CLASSES[sev] ?? SEVERITY_ROW_CLASSES.medium}`}>
                {sev}
              </span>
              {inc.ndis_pending && (
                <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                  NDIS Alert
                </span>
              )}
            </button>
          );
        })}
      </div>
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
  const [sessionOutcome, setSessionOutcome] = useState("");
  const [sessionChoiceAndControl, setSessionChoiceAndControl] = useState("");
  const [sessionRecommendations, setSessionRecommendations] = useState("");
  const [sessionGoalsAddressed, setSessionGoalsAddressed] = useState<string[]>([]);
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  const recognitionRef = useRef<LiveSpeechRecognition | null>(null);
  const dictationBaseRef = useRef("");
  const dictationFinalRef = useRef("");
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["worker", "my-client", id], queryFn: () => getMyClientDetail(id) });
  const planQuery = useQuery({ queryKey: ["worker", "my-client", id, "plan"], queryFn: () => getMyClientNdisPlan(id) });
  const incidentsQuery = useQuery({
    queryKey: ["worker", "participant-incidents", id],
    queryFn: () => getIncidentsByParticipant<Array<Record<string, unknown>>>(id),
    enabled: !!id,
  });

  const saveSessionDraft = useMutation({
    mutationFn: () => createMyClientSession(id, {
      status: "draft",
      session_type: "support_work",
      duration_minutes: 60,
      notes: generatedNote.trim() || sessionDraft.trim(),
      outcomes: sessionOutcome.trim() || undefined,
      participant_response: sessionChoiceAndControl.trim() || undefined,
      progress_toward_goals: sessionRecommendations.trim() || undefined,
      goals_addressed: sessionGoalsAddressed.length > 0 ? sessionGoalsAddressed : undefined,
    }),
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
    setSessionOutcome("");
    setSessionChoiceAndControl("");
    setSessionRecommendations("");
    setSessionGoalsAddressed([]);
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
          <button
            onClick={() => setIncidentModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border bg-white px-5 py-3 text-sm font-black shadow-sm transition hover:bg-red-50"
            style={{ borderColor: "#FECACA", color: CORAL }}
          >
            <Siren size={16} />
            Report Incident
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
                activeGoals={activeGoals(client.goals)}
                goalsAddressed={sessionGoalsAddressed}
                outcome={sessionOutcome}
                choiceAndControl={sessionChoiceAndControl}
                recommendations={sessionRecommendations}
                onGoalsAddressedChange={setSessionGoalsAddressed}
                onOutcomeChange={setSessionOutcome}
                onChoiceAndControlChange={setSessionChoiceAndControl}
                onRecommendationsChange={setSessionRecommendations}
              />
            }
          />
        ) : (
          <div className="space-y-4">
            <ParticipantReadiness client={client} columns={2} />
            {(incidentsQuery.data?.length ?? 0) > 0 && (
              <ParticipantIncidentPanel incidents={incidentsQuery.data!} />
            )}
          </div>
        )
      )}

      {activeTab === "plan" && (
        <div className="space-y-6">
          {planQuery.isLoading && <p className="text-sm font-bold" style={{ color: MUTED }}>Loading plan...</p>}
          {(planQuery.data?.goals || client.goals || []).length === 0 && !planQuery.isLoading && (
            <p className="text-sm font-medium" style={{ color: MUTED }}>No goals recorded for this participant yet.</p>
          )}
          <div className="space-y-3">
            {(planQuery.data?.goals || client.goals || []).map((goal, index) => {
              const g = goal as Record<string, unknown>;
              const title = String(g.title || g.name || `Goal ${index + 1}`);
              const description = String(g.description || g.instructions || g.goal_instructions || "");
              const status = String(g.status || "active");
              const category = String(g.category || g.support_category || "");
              const isActive = !["completed", "achieved", "archived"].includes(status.toLowerCase());
              return (
                <div key={String(g.id || index)} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-black" style={{ color: TEXT }}>{title}</p>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${
                        isActive
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                  {category.trim() && (
                    <p className="mt-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: PLUM }}>
                      {category}
                    </p>
                  )}
                  {description.trim() && (
                    <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6" style={{ color: MUTED }}>
                      {description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
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

      {incidentModalOpen && (
        <IncidentReportModal
          participantId={String(client.id ?? "")}
          participantName={client.full_name}
          onClose={() => setIncidentModalOpen(false)}
        />
      )}
    </div>
  );
}
