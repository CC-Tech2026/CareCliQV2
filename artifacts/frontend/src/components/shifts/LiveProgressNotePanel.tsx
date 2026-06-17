import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Camera, Languages, Mic, MicOff, Paperclip, StopCircle, X } from "lucide-react";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

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
  { value: "tl", label: "Tagalog" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
] as const;

const SPEECH_LANGUAGE_CODES: Record<string, string> = {
  en: "en-AU",
  es: "es-ES",
  fr: "fr-FR",
  ar: "ar-SA",
  tl: "tl-PH",
  zh: "zh-CN",
  hi: "hi-IN",
};

type Props = {
  participantName?: string;
  sessionId?: string | null;
  onClose?: () => void;
};

export function LiveProgressNotePanel({ participantName, sessionId, onClose }: Props) {
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<LiveSpeechRecognition | null>(null);
  const dictationBaseRef = useRef("");
  const dictationFinalRef = useRef("");

  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [language, setLanguage] = useState("auto");
  const [isListening, setIsListening] = useState(false);
  const [ended, setEnded] = useState(false);
  const [attachmentName, setAttachmentName] = useState("");

  useEffect(() => () => stopDictation(), []);

  function stopDictation() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    dictationBaseRef.current = "";
    dictationFinalRef.current = "";
    setIsListening(false);
  }

  function appendDraft(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setDraft((current) => [current.trim(), clean].filter(Boolean).join("\n\n"));
  }

  function commitMessage() {
    const clean = message.trim();
    if (!clean) return;
    appendDraft(clean);
    setMessage("");
  }

  function attachFile(file: File | null) {
    if (!file) return;
    setAttachmentName(file.name);
    appendDraft(`[Attachment selected: ${file.name}]`);
  }

  function toggleDictation() {
    if (ended) return;
    if (recognitionRef.current) {
      stopDictation();
      return;
    }

    if (typeof window === "undefined") return;
    const speechWindow = window as unknown as LiveSpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language === "auto" ? "en-AU" : SPEECH_LANGUAGE_CODES[language] || "en-AU";
    dictationBaseRef.current = draft.trim();
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
      setDraft([dictationBaseRef.current, liveText].filter(Boolean).join("\n\n"));
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
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }

  function handleEndSession() {
    stopDictation();
    setEnded(true);
    if (sessionId) {
      // navigate(`/sessions/${sessionId}/live`);
    }
  }

  const statusLabel = ended
    ? "Ended"
    : isListening
      ? "Listening..."
      : "Ready to listen";

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "#EEEAFB" }}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ color: MUTED }}>
              Live Progress Note
            </p>
            <span
              className="rounded-full border px-2.5 py-1 text-[11px] font-black"
              style={{
                borderColor: ended ? BORDER : "#A7F3D0",
                background: ended ? "#F5F3FC" : "#ECFDF5",
                color: ended ? MUTED : "#047857",
              }}
            >
              {ended ? "Ended" : "In progress"}
            </span>
          </div>
          <h2 className="mt-1 truncate text-lg font-black" style={{ color: TEXT }}>
            {participantName || "Participant"}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!ended && (
            <button
              type="button"
              onClick={handleEndSession}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black text-white shadow-sm"
              style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
            >
              <StopCircle size={15} />
              End Session
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 transition hover:bg-[#F5F3FC]"
              style={{ color: MUTED }}
              aria-label="Close live note panel"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </header>

      {/* Input language */}
      <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: "#EEEAFB" }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
            <Languages size={15} />
            Input language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={ended}
            className="h-10 w-full rounded-full border bg-[#F8F6FE] px-4 text-sm font-bold outline-none sm:w-auto sm:min-w-[160px]"
            style={{ borderColor: BORDER, color: TEXT }}
          >
            {INPUT_LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Note area */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#FBFAFF] p-4">
        <div className="mx-auto flex h-full max-w-3xl flex-col space-y-3">
          <div
            className="mx-auto flex w-fit items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-bold shadow-sm"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            {isListening && (
              <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
                <span className="h-2 w-1 animate-pulse rounded-full" style={{ background: PLUM }} />
                <span className="h-3 w-1 animate-pulse rounded-full [animation-delay:120ms]" style={{ background: PLUM }} />
                <span className="h-4 w-1 animate-pulse rounded-full [animation-delay:240ms]" style={{ background: PLUM }} />
                <span className="h-2.5 w-1 animate-pulse rounded-full [animation-delay:360ms]" style={{ background: PLUM }} />
              </span>
            )}
            <span>{statusLabel}</span>
          </div>

          <div
            className="min-h-[180px] flex-1 overflow-y-auto rounded-2xl border border-dashed bg-transparent p-4 text-base font-medium italic leading-7"
            style={{ borderColor: "#DCD6F1", color: TEXT }}
            aria-live="polite"
          >
            {draft.trim() ? (
              <p className="whitespace-pre-wrap not-italic">{draft}</p>
            ) : (
              <p style={{ color: MUTED }}>
                {isListening ? "Listening..." : "Spoken or sent notes will appear here."}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Composer footer */}
      {!ended && (
        <footer className="shrink-0 border-t bg-white p-3" style={{ borderColor: "#EEEAFB" }}>
          <div className="flex items-center gap-3">
            <div
              className="flex min-w-0 flex-1 items-center gap-1 rounded-full border bg-white px-3 py-2 shadow-sm"
              style={{ borderColor: BORDER }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx"
                className="hidden"
                onChange={(e) => attachFile(e.target.files?.[0] ?? null)}
              />
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitMessage();
                  }
                }}
                placeholder={`What progress did ${participantName || "the participant"} make today?`}
                className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-base font-medium outline-none placeholder:text-[#9A8BC4]"
                style={{ color: TEXT }}
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
                aria-label="Add photo"
              >
                <Camera size={22} />
              </button>
            </div>
            <button
              type="button"
              onClick={toggleDictation}
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-white text-white shadow-lg transition hover:scale-[1.02]"
              style={{ background: isListening ? CORAL : PLUM }}
              aria-label={isListening ? "Stop voice dictation" : "Start voice dictation"}
            >
              {isListening ? <MicOff size={28} /> : <Mic size={30} />}
            </button>
          </div>
          {attachmentName && (
            <p className="mt-2 inline-flex max-w-full items-center rounded-full bg-[#F5F3FC] px-3 py-1 text-xs font-bold" style={{ color: PLUM }}>
              <Paperclip size={12} className="mr-1 shrink-0" />
              <span className="truncate">{attachmentName}</span>
            </p>
          )}
        </footer>
      )}
    </aside>
  );
}
