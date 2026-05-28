import { useEffect, useRef, useState } from "react";
import type { ComponentType, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  ClipboardList,
  FileText,
  GripVertical,
  HeartPulse,
  Languages,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  StopCircle,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  createMyClientNote,
  createMyClientSession,
  getMyClientDetail,
  getMyClientNdisPlan,
  type WorkerClientDetail,
} from "@/services/workerService";
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

function BasicProfilePanel({ client }: { client: ClientSummary }) {
  return (
    <Section title="Basic Profile" icon={ClipboardList}>
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ["NDIS Number", client.ndis_number],
          ["Date of Birth", safeDate(client.date_of_birth)],
          ["Plan Status", client.plan_status],
          ["Plan Management", client.plan_management_type],
          ["Plan Start", safeDate(client.plan_start_date)],
          ["Plan End", safeDate(client.plan_end_date)],
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

function LimitedMedicalPanel({ client }: { client: ClientSummary }) {
  return (
    <Section title="Limited Medical History" icon={HeartPulse}>
      <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4">
        <p className="text-sm font-bold text-amber-900">Limited clinical profile access</p>
        <p className="mt-1 text-sm leading-6 text-amber-800">
          {client.primary_disability || "No primary disability has been recorded for the limited worker view."}
        </p>
      </div>
    </Section>
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

function InlineSessionComposer({
  clientName,
  draft,
  inputValue,
  generated,
  attachmentName,
  isListening,
  language,
  ended,
  isGenerating,
  isSaving,
  error,
  onInputChange,
  onCommitInput,
  onGeneratedChange,
  onLanguageChange,
  onAttach,
  onToggleDictation,
  onEnd,
  onGenerate,
  onSave,
  onClose,
}: {
  clientName: string;
  draft: string;
  inputValue: string;
  generated: string;
  attachmentName: string;
  isListening: boolean;
  language: string;
  ended: boolean;
  isGenerating: boolean;
  isSaving: boolean;
  error?: string;
  onInputChange: (value: string) => void;
  onCommitInput: () => void;
  onGeneratedChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onAttach: (file: File | null) => void;
  onToggleDictation: () => void;
  onEnd: () => void;
  onGenerate: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canSave = ended && Boolean((generated || draft).trim()) && !isSaving;
  const warning = restrictivePracticeWarning(draft);
  return (
    <section
      className="flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm"
      style={{
        borderColor: BORDER,
        height: "clamp(520px, calc(100vh - 250px), 680px)",
      }}
    >
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
              onClick={onEnd}
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
            <span>{isListening ? "Listening..." : ended ? "Session ended - review before saving" : "Ready to listen"}</span>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onGenerate}
              disabled={!draft.trim() || isGenerating}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black transition disabled:opacity-50"
              style={{ borderColor: PLUM, color: PLUM }}
            >
              {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Generate Compliant Note
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black text-white transition disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Draft
            </button>
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
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<LiveSpeechRecognition | null>(null);
  const dictationBaseRef = useRef("");
  const dictationFinalRef = useRef("");
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["worker", "my-client", id], queryFn: () => getMyClientDetail(id) });
  const planQuery = useQuery({ queryKey: ["worker", "my-client", id, "plan"], queryFn: () => getMyClientNdisPlan(id) });

  const saveSessionDraft = useMutation({
    mutationFn: () => createMyClientSession(id, {
      status: "draft",
      session_type: "support_work",
      duration_minutes: 60,
      notes: generatedNote.trim() || sessionDraft.trim(),
    }),
    onSuccess: () => {
      setSessionDraft("");
      setSessionInput("");
      setGeneratedNote("");
      setSessionAttachmentName("");
      setSessionEnded(false);
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
  }

  function openSessionComposer() {
    setActiveTab("overview");
    if (!sessionComposerOpen) {
      resetSessionComposer();
    }
    setSessionComposerOpen(true);
  }

  function endSessionComposer() {
    stopSessionDictation();
    commitSessionInput();
    setSessionEnded(true);
    setComposerError("");
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

  async function generateCompliantNote() {
    if (!sessionEnded) {
      setComposerError("End the session before generating the compliant note.");
      return;
    }
    if (!sessionDraft.trim() || isGenerating) return;
    setComposerError("");
    setIsGenerating(true);
    try {
      const response = await apiFetch("/api/ai/clinical-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputLanguage === "auto"
            ? sessionDraft.trim()
            : `[Input language: ${inputLanguage}]\n${sessionDraft.trim()}`,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Could not generate a compliant note.");
      }
      const data = await response.json();
      setGeneratedNote(String(data.clinical || data.note || data.text || sessionDraft.trim()));
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not generate a compliant note.");
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
            left={
              <>
                <BasicProfilePanel client={client} />
                <LimitedMedicalPanel client={client} />
              </>
            }
            right={
              <InlineSessionComposer
                clientName={client.full_name}
                draft={sessionDraft}
                inputValue={sessionInput}
                generated={generatedNote}
                attachmentName={sessionAttachmentName}
                isListening={isListening}
                language={inputLanguage}
                ended={sessionEnded}
                isGenerating={isGenerating}
                isSaving={saveSessionDraft.isPending}
                error={composerError || (saveSessionDraft.error instanceof Error ? saveSessionDraft.error.message : "")}
                onInputChange={setSessionInput}
                onCommitInput={commitSessionInput}
                onGeneratedChange={setGeneratedNote}
                onLanguageChange={setInputLanguage}
                onAttach={attachSessionFile}
                onToggleDictation={toggleSessionDictation}
                onEnd={endSessionComposer}
                onGenerate={generateCompliantNote}
                onSave={() => saveSessionDraft.mutate()}
                onClose={() => {
                  stopSessionDictation();
                  setSessionComposerOpen(false);
                }}
              />
            }
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
            <BasicProfilePanel client={client} />
            <LimitedMedicalPanel client={client} />
          </div>
        )
      )}

      {activeTab === "plan" && (
        <Section title="NDIS Plan" icon={ClipboardList}>
          {planQuery.isLoading && <p className="text-sm font-bold" style={{ color: MUTED }}>Loading plan...</p>}
          <div className="space-y-3">
            {(planQuery.data?.goals || client.goals || []).map((goal, index) => (
              <div key={String((goal as any).id || index)} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
                <p className="font-black" style={{ color: TEXT }}>{String((goal as any).title || (goal as any).description || `Goal ${index + 1}`)}</p>
                <p className="mt-1 text-sm font-medium capitalize" style={{ color: MUTED }}>{String((goal as any).status || "active")}</p>
              </div>
            ))}
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
    </div>
  );
}
