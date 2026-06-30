import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Mic, MicOff, Paperclip } from "lucide-react";
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

type Props = {
  sessionId?: string | null;
  taskId?: string | null;
  taskLabel?: string;
  disabled?: boolean;
  onNoteSaved?: (note: SessionNoteRecord) => void;
};

export function WorkerMobileComposer({
  sessionId,
  taskId,
  taskLabel,
  disabled,
  onNoteSaved,
}: Props) {
  const [value, setValue] = useState("");
  const [language, setLanguage] = useState("en");
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const placeholder = taskLabel ?? "Start typing a note…";

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

  const handleSend = () => {
    if (!value.trim()) return;
    if (!taskId) return;
    void saveNote(value, "text");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
    rec.lang = language === "tl" ? "fil-PH" : language === "ar" ? "ar-SA" : "en-AU";
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
      if (final.trim()) void saveNote(final, "voice");
    };
    rec.start();
    return () => {
      try { rec.stop(); } catch { /* noop */ }
    };
  }, [listening, saveNote, language]);

  return (
    <div
      className="shrink-0 border-t px-3 py-3 pb-safe"
      style={{ borderColor: WM.border, background: WM.surface }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium" style={{ color: WM.muted }}>
          Input language
        </span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="h-8 rounded-full border px-3 text-[12px] font-semibold"
          style={{ borderColor: WM.infoBorder, background: WM.infoBg, color: WM.infoTitle }}
          aria-label="Input language"
        >
          <option value="en">English</option>
          <option value="tl">Tagalog</option>
          <option value="ar">Arabic</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="flex min-h-[44px] flex-1 items-center rounded-2xl border px-3"
          style={{ borderColor: WM.border, background: WM.bg }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: WM.text }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="flex h-8 w-8 shrink-0 items-center justify-center"
            style={{ color: WM.muted }}
            aria-label="Attach file"
          >
            <Paperclip size={17} />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => cameraRef.current?.click()}
            className="flex h-8 w-8 shrink-0 items-center justify-center"
            style={{ color: WM.muted }}
            aria-label="Take photo"
          >
            <Camera size={17} />
          </button>
        </div>

        <button
          type="button"
          disabled={disabled}
          onPointerDown={() => {
            if (!value.trim()) setListening(true);
          }}
          onClick={() => {
            if (value.trim()) {
              handleSend();
            } else if (listening) {
              setListening(false);
            }
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-md"
          style={{ background: WM.pink }}
          aria-label={listening ? "Stop recording" : value.trim() ? "Send note" : "Record voice note"}
        >
          {listening ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
      </div>

      <p className="mt-2 text-center text-[11px] font-medium" style={{ color: WM.muted }}>
        Hold mic to record · tap to send when typing
      </p>

      <input ref={fileRef} type="file" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void saveNote(`[Attachment: ${f.name}]`, "file", f.name);
        e.target.value = "";
      }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void saveNote(`[Attachment: ${f.name}]`, "photo", f.name);
        e.target.value = "";
      }} />
    </div>
  );
}
