import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Languages, Mic, MicOff, Paperclip, StopCircle, Trash2, X } from "lucide-react";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  clearSessionNoteDraft,
  enqueuePendingSessionNote,
  loadPendingSessionNotes,
  loadSessionNoteDraft,
  newClientNoteId,
  removePendingSessionNote,
  saveSessionNoteDraft,
} from "@/lib/session-notes-storage";
import { SESSION_NOTE_MAX } from "@/lib/task-evidence-status";
import { handleNoteTextareaKeyDown } from "@/lib/note-textarea-keyboard";
import {
  deleteSessionNote,
  listSessionNotes,
  syncSessionNotes,
  type SessionNoteRecord,
} from "@/services/sessionNotesService";

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

type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

/** Phase 1: one rolling session progress note per session (upsert, not append). */
function latestSessionProgressNote(notes: SessionNoteRecord[]): SessionNoteRecord | null {
  const sessionNotes = notes.filter((n) => !n.task_id);
  if (!sessionNotes.length) return null;
  return sessionNotes.reduce((latest, row) => {
    const latestTs = Date.parse(latest.auto_saved_at || latest.created_at || "0");
    const rowTs = Date.parse(row.auto_saved_at || row.created_at || "0");
    return rowTs > latestTs ? row : latest;
  });
}

function singleSessionProgressList(note: SessionNoteRecord | null): SessionNoteRecord[] {
  return note ? [note] : [];
}

type Props = {
  shiftId: string;
  participantName?: string;
  sessionId?: string | null;
  onClose?: () => void;
};

export function LiveProgressNotePanel({ participantName, sessionId, onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<LiveSpeechRecognition | null>(null);
  const dictationBaseRef = useRef("");
  const dictationFinalRef = useRef("");
  const autosaveTimerRef = useRef<number | null>(null);
  const noteIdRef = useRef<string>(newClientNoteId());
  const lastSyncedRef = useRef("");

  const [draft, setDraft] = useState("");
  const [language, setLanguage] = useState("auto");
  const [isListening, setIsListening] = useState(false);
  const [ended, setEnded] = useState(false);
  const [attachmentName, setAttachmentName] = useState("");
  const [savedNotes, setSavedNotes] = useState<SessionNoteRecord[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [noteToDelete, setNoteToDelete] = useState<SessionNoteRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const firstName = participantName?.split(" ")[0] || "the participant";
  const placeholder = `What progress did ${firstName} make today?`;

  const buildNotePayload = useCallback(
    (content: string): SessionNoteRecord => {
      const now = new Date().toISOString();
      return {
        note_id: noteIdRef.current,
        session_id: sessionId ?? undefined,
        content: content.trim().slice(0, SESSION_NOTE_MAX),
        created_at: now,
        auto_saved_at: now,
        synced: false,
      };
    },
    [sessionId],
  );

  const persistDraftLocally = useCallback(
    (text: string) => {
      if (!sessionId) return;
      saveSessionNoteDraft(sessionId, {
        noteId: noteIdRef.current,
        content: text,
        updatedAt: new Date().toISOString(),
      });
    },
    [sessionId],
  );

  const flushToServer = useCallback(
    async (text: string) => {
      const clean = text.trim().slice(0, SESSION_NOTE_MAX);
      if (!clean || !sessionId) return;
      if (clean === lastSyncedRef.current) return;

      const payload = buildNotePayload(clean);
      persistDraftLocally(clean);

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        enqueuePendingSessionNote(sessionId, payload);
        setSaveStatus("offline");
        return;
      }

      setSaveStatus("saving");
      try {
        const result = await syncSessionNotes(sessionId, [payload]);
        const synced = result.notes?.[0];
        if (synced?.note_id) noteIdRef.current = synced.note_id;
        lastSyncedRef.current = clean;
        removePendingSessionNote(sessionId, payload.note_id);
        setSavedNotes(singleSessionProgressList(synced ?? payload));
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        enqueuePendingSessionNote(sessionId, payload);
        setSaveStatus("error");
      }
    },
    [buildNotePayload, persistDraftLocally, sessionId],
  );

  const flushPendingQueue = useCallback(async () => {
    if (!sessionId || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const pending = loadPendingSessionNotes(sessionId);
    if (!pending.length) return;
    try {
      const result = await syncSessionNotes(sessionId, pending);
      for (const row of result.notes ?? []) {
        removePendingSessionNote(sessionId, row.note_id);
      }
      const rows = await listSessionNotes(sessionId);
      setSavedNotes(singleSessionProgressList(latestSessionProgressNote(rows ?? [])));
    } catch {
      /* retry on next online tick */
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const stored = loadSessionNoteDraft(sessionId);
    if (stored?.noteId) noteIdRef.current = stored.noteId;
    if (stored?.content) {
      setDraft(stored.content);
      lastSyncedRef.current = "";
    }

    void listSessionNotes(sessionId)
      .then((rows) => {
        const list = rows ?? [];
        const latest = latestSessionProgressNote(list);
        setSavedNotes(singleSessionProgressList(latest));
        if (latest?.content?.trim() && !stored?.content) {
          setDraft(latest.content.trim());
          if (latest.note_id) noteIdRef.current = latest.note_id;
          lastSyncedRef.current = latest.content.trim();
        }
      })
      .catch(() => undefined);

    void flushPendingQueue();
  }, [sessionId, flushPendingQueue]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flushPendingQueue();
      if (draft.trim()) void flushToServer(draft);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [draft, flushPendingQueue, flushToServer]);

  useEffect(() => {
    if (!draft.trim() || ended) return;
    persistDraftLocally(draft);
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      void flushToServer(draft);
    }, 30_000);
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [draft, ended, flushToServer, persistDraftLocally]);

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
    setDraft((current) => {
      const merged = [current.trim(), clean].filter(Boolean).join("\n\n");
      return merged.slice(0, SESSION_NOTE_MAX);
    });
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
      const merged = [dictationBaseRef.current, liveText].filter(Boolean).join("\n\n");
      setDraft(merged.slice(0, SESSION_NOTE_MAX));
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

  async function handleDeleteNote(note: SessionNoteRecord) {
    if (!sessionId) return;
    const serverId = note.id;
    const clientId = note.note_id;
    const matchesCurrent =
      clientId === noteIdRef.current ||
      serverId === noteIdRef.current ||
      note.content.trim() === draft.trim();

    setDeleting(true);
    try {
      if (online) {
        if (serverId) {
          await deleteSessionNote(sessionId, serverId);
        } else if (clientId) {
          await deleteSessionNote(sessionId, clientId);
        }
      }
      setSavedNotes((prev) =>
        prev.filter((row) => {
          if (serverId && row.id === serverId) return false;
          if (clientId && row.note_id === clientId) return false;
          return true;
        }),
      );
      if (clientId) removePendingSessionNote(sessionId, clientId);
      if (matchesCurrent) {
        setDraft("");
        lastSyncedRef.current = "";
        noteIdRef.current = newClientNoteId();
        clearSessionNoteDraft(sessionId);
      }
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteNote() {
    if (!noteToDelete) return;
    await handleDeleteNote(noteToDelete);
    setNoteToDelete(null);
  }

  function handleEndSession() {
    stopDictation();
    void flushToServer(draft);
    setEnded(true);
  }

  const statusLabel = (() => {
    if (ended) return "Ended";
    if (saveStatus === "saving") return "⟳ Saving...";
    if (saveStatus === "saved") return "✓ Saved";
    if (saveStatus === "offline" || !online) return "⚠️ Offline";
    if (saveStatus === "error") return "Could not sync";
    if (isListening) return "Listening...";
    return "Notes";
  })();

  return (
    <>
    <aside className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "#EEEAFB" }}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ color: MUTED }}>
              Notes
            </p>
            <span
              className="rounded-full border px-2.5 py-1 text-[11px] font-black"
              style={{
                borderColor: ended ? BORDER : saveStatus === "offline" || !online ? "#FDE68A" : "#A7F3D0",
                background: ended ? "#F5F3FC" : saveStatus === "offline" || !online ? "#FFFBEB" : "#ECFDF5",
                color: ended ? MUTED : saveStatus === "offline" || !online ? "#B45309" : "#047857",
              }}
            >
              {statusLabel}
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
              aria-label="Close notes panel"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </header>

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

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#FBFAFF] p-4">
        <div className="mx-auto flex h-full max-w-3xl flex-col space-y-3">
          <textarea
            value={draft}
            disabled={ended}
            maxLength={SESSION_NOTE_MAX}
            rows={8}
            placeholder={placeholder}
            className="min-h-[180px] w-full resize-none rounded-2xl border bg-white p-4 text-base font-medium leading-7 outline-none"
            style={{ borderColor: "#DCD6F1", color: TEXT }}
            onChange={(e) => setDraft(e.target.value.slice(0, SESSION_NOTE_MAX))}
            onBlur={() => void flushToServer(draft)}
            onKeyDown={(e) =>
              handleNoteTextareaKeyDown(e, {
                maxLength: SESSION_NOTE_MAX,
                setValue: setDraft,
                onSave: (value) => void flushToServer(value),
              })
            }
          />
          <p className="text-right text-[10px] font-semibold" style={{ color: MUTED }}>
            {draft.length}/{SESSION_NOTE_MAX} · Enter to save · Ctrl+Enter for new line
          </p>

          {savedNotes.length > 0 && (
            <div className="rounded-xl border bg-white p-3" style={{ borderColor: BORDER }}>
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                Last saved
              </p>
              <ul className="max-h-32 space-y-2 overflow-y-auto text-xs" style={{ color: TEXT }}>
                {savedNotes.slice(0, 8).map((note) => (
                  <li key={note.id ?? note.note_id} className="flex gap-2 rounded-lg bg-[#F8F6FE] px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <span className="font-bold">
                        {note.created_at ? new Date(note.created_at).toLocaleString() : "Saved"}
                      </span>
                      <p className="mt-0.5 whitespace-pre-wrap">{note.content}</p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50"
                      aria-label="Delete note"
                      onClick={() => setNoteToDelete(note)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

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
              <span className="min-w-0 flex-1 truncate px-2 text-xs font-medium" style={{ color: MUTED }}>
                Voice or type in the note area above
              </span>
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

    <AlertDialog open={Boolean(noteToDelete)} onOpenChange={(open) => !open && !deleting && setNoteToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this note?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>This note will be removed from your session history and cannot be undone.</p>
              {noteToDelete?.content && (
                <p className="rounded-lg bg-[#F8F6FE] px-3 py-2 text-xs italic text-foreground line-clamp-3">
                  {noteToDelete.content}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              void confirmDeleteNote();
            }}
          >
            {deleting ? "Deleting…" : "Delete note"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
  );
}
