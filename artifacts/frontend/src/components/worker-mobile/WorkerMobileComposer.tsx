import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, ChevronRight, Languages, Loader2, Mic, MicOff, Paperclip } from "lucide-react";
import { WM } from "@/lib/worker-mobile-tokens";
import { SESSION_NOTE_MAX } from "@/lib/task-evidence-status";
import {
  enqueuePendingSessionNote,
  newClientNoteId,
  removePendingSessionNote,
} from "@/lib/session-notes-storage";
import {
  syncSessionNotes,
  type SessionNoteRecord,
  type SessionNoteType,
} from "@/services/sessionNotesService";
import { mirrorSessionNoteToTaskEvidence } from "@/lib/merge-session-evidence";
import { translateToEnglish } from "@/services/translationService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const LANGUAGE_OPTIONS = [
  { value: "auto", labelKey: "shift.session.lang.auto" },
  { value: "en", labelKey: "shift.session.lang.en" },
  { value: "es", labelKey: "shift.session.lang.es" },
  { value: "fr", labelKey: "shift.session.lang.fr" },
  { value: "ar", labelKey: "shift.session.lang.ar" },
  { value: "tl", labelKey: "shift.session.lang.tl" },
  { value: "zh", labelKey: "shift.session.lang.zh" },
  { value: "hi", labelKey: "shift.session.lang.hi" },
] as const;

const SPEECH_LANGUAGE_CODES: Record<string, string> = {
  en: "en-AU",
  es: "es-ES",
  fr: "fr-FR",
  ar: "ar-SA",
  tl: "fil-PH",
  zh: "zh-CN",
  hi: "hi-IN",
};

type Props = {
  sessionId?: string | null;
  taskId?: string | null;
  taskLabel?: string;
  disabled?: boolean;
  onNoteSaved?: (note: SessionNoteRecord) => void;
};

async function toEnglishNote(text: string, language: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const source = language === "auto" ? "auto" : language;
  if (source === "en") return trimmed;
  const result = await translateToEnglish(trimmed, source);
  if (result.translated && result.status !== "failed" && result.status !== "unsupported") {
    return result.translated;
  }
  return trimmed;
}

export function WorkerMobileComposer({
  sessionId,
  taskId,
  taskLabel,
  disabled,
  onNoteSaved,
}: Props) {
  const { translate } = useAccessibility();
  const [value, setValue] = useState("");
  const [language, setLanguage] = useState("auto");
  const [listening, setListening] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const placeholder = taskLabel ?? translate("worker.composer.placeholder");
  const showSubmit = Boolean(taskId) && inputFocused && !listening && !submitting;
  const showTranslateBadge = value.trim().length > 0 && language !== "en";

  const saveNote = useCallback(
    async (content: string, noteType: SessionNoteType = "text", fileName?: string) => {
      if (!sessionId || !content.trim() || disabled) return;
      const noteId = newClientNoteId();
      const now = new Date().toISOString();
      const payload: SessionNoteRecord = {
        note_id: noteId,
        session_id: sessionId,
        task_id: taskId ?? undefined,
        content: content.trim().slice(0, SESSION_NOTE_MAX),
        created_at: now,
        auto_saved_at: now,
        note_type: noteType,
        file_name: fileName,
        synced: false,
      };

      onNoteSaved?.(payload);
      setValue("");
      setInputFocused(false);
      inputRef.current?.blur();

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        enqueuePendingSessionNote(sessionId, payload);
        return;
      }

      try {
        const result = await syncSessionNotes(sessionId, [payload]);
        const synced = result.notes?.[0];
        if (synced) {
          const finalNote = { ...synced, synced: true };
          onNoteSaved?.(finalNote);
          removePendingSessionNote(sessionId, noteId);
          await mirrorSessionNoteToTaskEvidence(sessionId, finalNote);
          return;
        }
      } catch {
        enqueuePendingSessionNote(sessionId, payload);
      }
    },
    [sessionId, taskId, disabled, onNoteSaved],
  );

  const handleSend = async () => {
    if (!value.trim() || !taskId || submitting) return;
    setSubmitting(true);
    try {
      const english = await toEnglishNote(value, language);
      await saveNote(english, "text");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  useEffect(() => {
    if (!listening) return;
    const w = window as Window & {
      SpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        start: () => void;
        stop: () => void;
        onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string }; isFinal: boolean } } }) => void) | null;
        onend: (() => void) | null;
      };
      webkitSpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        start: () => void;
        stop: () => void;
        onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string }; isFinal: boolean } } }) => void) | null;
        onend: (() => void) | null;
      };
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang =
      language === "auto"
        ? "en-AU"
        : SPEECH_LANGUAGE_CODES[language] ?? "en-AU";
    let final = "";
    rec.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      final = text;
      setValue(text);
    };
    rec.onend = () => {
      setListening(false);
      if (final.trim()) {
        void (async () => {
          const english = await toEnglishNote(final, language);
          await saveNote(english, "voice");
        })();
      }
    };
    rec.start();
    return () => {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    };
  }, [listening, saveNote, language]);

  return (
    <div
      className="shrink-0 border-t px-3 py-3 pb-safe"
      style={{ borderColor: WM.border, background: WM.surface }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="shrink-0 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: WM.muted }}
        >
          {translate("shift.session.inputLanguage")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {showTranslateBadge && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold"
              style={{ background: WM.infoBg, color: WM.purple, border: `1px solid ${WM.infoBorder}` }}
            >
              <Languages size={13} />
              {translate("worker.composer.translateToEn")}
            </span>
          )}
          <label className="relative shrink-0">
          <span className="sr-only">{translate("shift.session.inputLanguage")}</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={disabled}
            className="h-8 min-w-[7rem] appearance-none rounded-full border py-0 pl-3 pr-8 text-[12px] font-semibold"
            style={{ borderColor: WM.border, background: WM.bg, color: WM.text }}
            aria-label={translate("shift.session.inputLanguage")}
          >
            {LANGUAGE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {translate(item.labelKey)}
              </option>
            ))}
          </select>
          <ChevronRight
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
            style={{ color: WM.muted }}
            aria-hidden
          />
        </label>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="flex min-h-[44px] flex-1 items-center rounded-2xl border px-3"
          style={{ borderColor: WM.border, background: WM.bg }}
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={handleKeyDown}
            disabled={disabled || !taskId}
            placeholder={taskId ? placeholder : translate("worker.composer.selectTask")}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: WM.text }}
          />
          <button
            type="button"
            disabled={disabled || !taskId}
            onClick={() => fileRef.current?.click()}
            className="flex h-8 w-8 shrink-0 items-center justify-center"
            style={{ color: WM.muted }}
            aria-label={translate("shift.session.attachFile")}
          >
            <Paperclip size={17} />
          </button>
          <button
            type="button"
            disabled={disabled || !taskId}
            onClick={() => cameraRef.current?.click()}
            className="flex h-8 w-8 shrink-0 items-center justify-center"
            style={{ color: WM.muted }}
            aria-label={translate("shift.session.capturePhoto")}
          >
            <Camera size={17} />
          </button>
        </div>

        <button
          type="button"
          disabled={disabled || !taskId || submitting}
          onPointerDown={() => {
            if (!showSubmit && !value.trim()) setListening(true);
          }}
          onClick={() => {
            if (showSubmit) {
              void handleSend();
            } else if (listening) {
              setListening(false);
            } else if (!value.trim()) {
              setListening(true);
            }
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-md disabled:opacity-50"
          style={{ background: showSubmit ? WM.purple : WM.pink }}
          aria-label={
            showSubmit
              ? translate("worker.composer.sendNote")
              : listening
                ? translate("shift.session.stopDictation")
                : translate("shift.session.startDictation")
          }
        >
          {submitting ? (
            <Loader2 size={22} className="animate-spin" />
          ) : showSubmit ? (
            <ArrowUp size={22} strokeWidth={2.5} />
          ) : listening ? (
            <MicOff size={22} />
          ) : (
            <Mic size={22} />
          )}
        </button>
      </div>

      <p className="mt-2 text-center text-[11px] font-medium" style={{ color: WM.muted }}>
        {showTranslateBadge
          ? translate("worker.composer.submitHint")
          : translate("worker.composer.submitHintEn")}
      </p>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void saveNote(`[Attachment: ${f.name}]`, "file", f.name);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void saveNote(`[Attachment: ${f.name}]`, "photo", f.name);
          e.target.value = "";
        }}
      />
    </div>
  );
}
