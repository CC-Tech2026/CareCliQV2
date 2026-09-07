import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Camera, Languages, Mic, MicOff, Paperclip, StopCircle, X } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  SessionNoteHistoryCard,
  isImageName,
  sortNotesLatestFirst,
} from "@/components/shifts/SessionNoteHistoryCard";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import {
  enqueuePendingSessionNote,
  loadPendingSessionNotes,
  newClientNoteId,
  removePendingSessionNote,
} from "@/lib/session-notes-storage";
import { SESSION_NOTE_MAX } from "@/lib/task-evidence-status";
import {
  deleteSessionNote,
  editSessionNote,
  listSessionNotes,
  syncSessionNotes,
  type SessionNoteRecord,
  type SessionNoteType,
} from "@/services/sessionNotesService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import type { ShiftTask } from "@/services/shiftService";

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

const INPUT_LANGUAGE_KEYS = [
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
  tl: "tl-PH",
  zh: "zh-CN",
  hi: "hi-IN",
};

const MAX_IMAGE_DATA_URL_BYTES = 900_000;

type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

type Props = {
  shiftId: string;
  participantName?: string;
  participantFirstName?: string;
  sessionId?: string | null;
  tasks?: ShiftTask[];
  activeTaskId?: string | null;
  onClose?: () => void;
  /** Skip server sync when previewing the walkthrough. */
  tutorialDemo?: boolean;
};

function readImageDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/") && !isImageName(file.name)) {
    return Promise.resolve(null);
  }
  if (file.size > MAX_IMAGE_DATA_URL_BYTES) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function LiveProgressNotePanel({
  participantName,
  participantFirstName,
  sessionId,
  tasks = [],
  activeTaskId,
  onClose,
  tutorialDemo,
}: Props) {
  const { translate } = useAccessibility();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<LiveSpeechRecognition | null>(null);
  const dictationFinalRef = useRef("");
  const dictationInterimRef = useRef("");
  const voiceSaveOnEndRef = useRef(false);

  const [notes, setNotes] = useState<SessionNoteRecord[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [language, setLanguage] = useState("auto");
  const [isListening, setIsListening] = useState(false);
  const [liveDictation, setLiveDictation] = useState("");
  const [ended, setEnded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<SessionNoteRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [noteToEdit, setNoteToEdit] = useState<SessionNoteRecord | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [offlineVoiceOpen, setOfflineVoiceOpen] = useState(false);

  const refreshNotes = useCallback(async () => {
    if (!sessionId || tutorialDemo) return;
    try {
      const rows = await listSessionNotes(sessionId);
      const sessionNotes = sortNotesLatestFirst((rows ?? []).filter((n) => !n.task_id));
      setNotes(sessionNotes);
    } catch {
      /* keep optimistic list */
    }
  }, [sessionId, tutorialDemo]);

  const appendNote = useCallback(
    async (params: {
      content: string;
      note_type: SessionNoteType;
      file_name?: string;
      attachment_urls?: string[];
    }) => {
      const clean = params.content.trim().slice(0, SESSION_NOTE_MAX);
      if (!clean || !sessionId || ended || tutorialDemo) return;

      const noteId = newClientNoteId();
      const now = new Date().toISOString();
      const payload: SessionNoteRecord = {
        note_id: noteId,
        session_id: sessionId,
        task_id: activeTaskId ?? undefined,
        content: clean,
        created_at: now,
        auto_saved_at: now,
        note_type: params.note_type,
        file_name: params.file_name,
        attachment_urls: params.attachment_urls,
        synced: false,
      };

      setNotes((prev) => sortNotesLatestFirst([payload, ...prev]));

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        enqueuePendingSessionNote(sessionId, payload);
        setSaveStatus("offline");
        return;
      }

      setSaveStatus("saving");
      try {
        const result = await syncSessionNotes(sessionId, [payload]);
        const synced = result.notes?.[0];
        if (synced) {
          setNotes((prev) =>
            sortNotesLatestFirst(
              prev.map((row) => (row.note_id === noteId ? { ...synced, synced: true } : row)),
            ),
          );
          removePendingSessionNote(sessionId, noteId);
        }
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        enqueuePendingSessionNote(sessionId, payload);
        setSaveStatus("error");
      }
    },
    [ended, sessionId, tutorialDemo, activeTaskId],
  );

  const flushPendingQueue = useCallback(async () => {
    if (!sessionId || tutorialDemo || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const pending = loadPendingSessionNotes(sessionId);
    if (!pending.length) return;
    try {
      const result = await syncSessionNotes(sessionId, pending);
      for (const row of result.notes ?? []) {
        removePendingSessionNote(sessionId, row.note_id);
      }
      await refreshNotes();
    } catch {
      /* retry on next online tick */
    }
  }, [refreshNotes, sessionId, tutorialDemo]);

  useEffect(() => {
    if (!sessionId) return;
    void refreshNotes();
    void flushPendingQueue();
  }, [sessionId, refreshNotes, flushPendingQueue]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flushPendingQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushPendingQueue]);

  useEffect(() => () => stopDictation(false), []);

  const saveVoiceNote = useCallback(
    (transcript: string) => {
      const clean = transcript.trim();
      if (!clean) return;
      void appendNote({ content: clean, note_type: "voice" });
    },
    [appendNote],
  );

  function stopDictation(saveVoice: boolean) {
    const transcript = [dictationFinalRef.current, dictationInterimRef.current]
      .filter(Boolean)
      .join(" ")
      .trim();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    dictationFinalRef.current = "";
    dictationInterimRef.current = "";
    setLiveDictation("");
    setIsListening(false);
    if (saveVoice && voiceSaveOnEndRef.current && transcript) {
      saveVoiceNote(transcript);
    }
    voiceSaveOnEndRef.current = false;
  }

  function commitInput() {
    const clean = inputValue.trim();
    if (!clean) return;
    setInputValue("");
    void appendNote({ content: clean, note_type: "text" });
  }

  async function attachFile(file: File | null, source: "file" | "camera") {
    if (!file) return;
    const dataUrl = await readImageDataUrl(file);
    const note_type: SessionNoteType = source === "camera" ? "photo" : "file";
    const content = `[Attachment${source === "file" ? " selected" : ""}: ${file.name}]`;
    void appendNote({
      content,
      note_type,
      file_name: file.name,
      attachment_urls: dataUrl ? [dataUrl] : undefined,
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  function toggleDictation() {
    if (ended) return;
    if (recognitionRef.current) {
      stopDictation(true);
      return;
    }

    if (typeof window === "undefined") return;
    if (!online || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setOfflineVoiceOpen(true);
      return;
    }
    const speechWindow = window as unknown as LiveSpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language === "auto" ? "en-AU" : SPEECH_LANGUAGE_CODES[language] || "en-AU";
    dictationFinalRef.current = "";
    setLiveDictation("");
    voiceSaveOnEndRef.current = true;

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
      dictationInterimRef.current = interimPart;
      setLiveDictation(
        [dictationFinalRef.current, interimPart].filter(Boolean).join(" ").trim(),
      );
    };

    recognition.onend = () => {
      const transcript = [dictationFinalRef.current, dictationInterimRef.current]
        .filter(Boolean)
        .join(" ")
        .trim();
      recognitionRef.current = null;
      dictationFinalRef.current = "";
      dictationInterimRef.current = "";
      setLiveDictation("");
      setIsListening(false);
      if (voiceSaveOnEndRef.current && transcript) {
        saveVoiceNote(transcript);
      }
      voiceSaveOnEndRef.current = false;
    };

    recognition.onerror = () => {
      recognitionRef.current = null;
      dictationFinalRef.current = "";
      dictationInterimRef.current = "";
      setLiveDictation("");
      setIsListening(false);
      voiceSaveOnEndRef.current = false;
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInput();
    }
  }

  async function confirmDelete() {
    if (!sessionId || !noteToDelete) return;
    const note = noteToDelete;
    setDeleting(true);
    setNotes((prev) => prev.filter((row) => row.note_id !== note.note_id));
    try {
      await deleteSessionNote(sessionId, note.note_id);
      removePendingSessionNote(sessionId, note.note_id);
      setNoteToDelete(null);
    } catch {
      await refreshNotes();
    } finally {
      setDeleting(false);
    }
  }

  async function confirmEdit() {
    if (!sessionId || !noteToEdit?.id) return;
    const clean = editValue.trim().slice(0, SESSION_NOTE_MAX);
    if (!clean) return;
    setSavingEdit(true);
    try {
      const updated = await editSessionNote(sessionId, noteToEdit.id, clean);
      setNotes((prev) =>
        sortNotesLatestFirst(
          prev.map((row) => (row.id === noteToEdit.id ? { ...updated, synced: true } : row)),
        ),
      );
      setNoteToEdit(null);
    } catch {
      /* leave the note as-is; the dialog stays open so the worker can retry */
    } finally {
      setSavingEdit(false);
    }
  }

  function handleEndSession() {
    stopDictation(true);
    if (inputValue.trim()) {
      const clean = inputValue.trim();
      setInputValue("");
      void appendNote({ content: clean, note_type: "text" });
    }
    setEnded(true);
  }

  const listeningLabel = (() => {
    if (isListening) return translate("shift.session.listening");
    if (ended) return translate("shift.session.reviewBeforeSave");
    if (saveStatus === "saving") return translate("common.saving");
    if (saveStatus === "saved") return translate("shift.evidence.saved");
    if (saveStatus === "offline" || !online) return translate("shift.session.offlineNotes");
    if (saveStatus === "error") return translate("shift.session.syncRetry");
    return translate("shift.session.readyListen");
  })();

  const livePreview = liveDictation;

  return (
    <aside
      className="flex h-full flex-col overflow-hidden rounded-lg border border-cc-border bg-card shadow-sm"
      data-tutorial="live-progress-note"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cc-border px-5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ color: MUTED }}>
              {translate("shift.session.liveNote")}
            </p>
            <span
              className="rounded-full border px-2.5 py-1 text-[11px] font-black"
              style={{
                borderColor: ended ? "var(--cc-border)" : "#A7F3D0",
                background: ended ? "var(--cc-soft)" : "var(--cc-status-success-bg)",
                color: ended ? MUTED : "#047857",
              }}
            >
              {ended ? translate("shift.session.ended") : translate("shift.session.inProgress")}
            </span>
          </div>
          <h2 className="mt-1 truncate text-lg font-black" style={{ color: TEXT }}>
            {participantName || translate("common.participant")}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!ended && (
            <button
              type="button"
              onClick={handleEndSession}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black text-white shadow-sm"
              style={{ background: PLUM }}
            >
              <StopCircle size={15} />
              {translate("shift.session.endSession")}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 transition hover:bg-cc-soft"
              style={{ color: MUTED }}
              aria-label={translate("shift.session.closeComposer")}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 border-b border-cc-border px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
            <Languages size={15} />
            {translate("shift.session.inputLanguage")}
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={ended}
            className="h-10 w-full rounded-full border border-cc-border bg-cc-soft px-4 text-sm font-bold outline-none sm:w-auto sm:min-w-[160px]"
            style={{ color: TEXT }}
          >
            {INPUT_LANGUAGE_KEYS.map((item) => (
              <option key={item.value} value={item.value}>
                {translate(item.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-cc-bg p-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <div
            className="mx-auto flex w-fit items-center gap-2 rounded-full border border-cc-border bg-card px-3 py-1 text-xs font-bold shadow-sm"
            style={{ color: MUTED }}
          >
            {isListening && (
              <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
                <span className="h-2 w-1 animate-pulse rounded-full" style={{ background: PLUM }} />
                <span className="h-3 w-1 animate-pulse rounded-full [animation-delay:120ms]" style={{ background: PLUM }} />
                <span className="h-4 w-1 animate-pulse rounded-full [animation-delay:240ms]" style={{ background: PLUM }} />
                <span className="h-2.5 w-1 animate-pulse rounded-full [animation-delay:360ms]" style={{ background: PLUM }} />
              </span>
            )}
            <span>{listeningLabel}</span>
          </div>

          {isListening && livePreview && (
            <div
              className="rounded-lg border border-cc-border bg-card px-3 py-2 text-sm italic"
              style={{ color: MUTED }}
              aria-live="polite"
            >
              {livePreview}
            </div>
          )}

          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
              {translate("shift.session.lastSaved")}
            </p>
            {notes.length === 0 ? (
              <p className="rounded-lg border border-dashed border-cc-border px-4 py-8 text-center text-sm font-medium italic" style={{ color: MUTED }}>
                {translate("shift.session.notesEmpty")}
              </p>
            ) : (
              <ul className="space-y-2">
                {notes.map((note) => (
                  <SessionNoteHistoryCard
                    key={note.note_id}
                    note={note}
                    onDelete={() => setNoteToDelete(note)}
                    onEdit={
                      note.id && note.synced
                        ? () => {
                            setNoteToEdit(note);
                            setEditValue(note.content);
                          }
                        : undefined
                    }
                    onViewImage={(url, title) => setPreviewImage({ url, title })}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {!ended && (
        <div className="shrink-0 border-t border-cc-border bg-card p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-cc-border bg-card px-3 py-2 shadow-sm"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx"
                className="hidden"
                onChange={(e) => void attachFile(e.target.files?.[0] ?? null, "file")}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void attachFile(e.target.files?.[0] ?? null, "camera")}
              />
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleInputKeyDown}
                disabled={ended}
                maxLength={SESSION_NOTE_MAX}
                className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base font-medium outline-none"
                style={{ color: TEXT }}
                placeholder={translate("shift.session.notePlaceholder")}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-cc-soft"
                style={{ color: PLUM }}
                aria-label={translate("shift.session.attachFile")}
              >
                <Paperclip size={22} />
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-cc-soft"
                style={{ color: PLUM }}
                aria-label={translate("shift.session.capturePhoto")}
              >
                <Camera size={22} />
              </button>
            </div>
            <button
              type="button"
              onClick={toggleDictation}
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-cc-surface text-white shadow-lg transition hover:scale-[1.02]"
              style={{
                background: isListening ? CORAL : PLUM,
                opacity: !online && !isListening ? 0.45 : 1,
              }}
              aria-label={
                isListening
                  ? translate("shift.session.stopDictation")
                  : !online
                    ? translate("composer.voice.offlineTitle")
                    : translate("shift.session.startDictation")
              }
            >
              {isListening ? <MicOff size={28} /> : <Mic size={30} />}
            </button>
          </div>
        </div>
      )}

      <AlertDialog open={offlineVoiceOpen} onOpenChange={setOfflineVoiceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{translate("composer.voice.offlineTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {translate("composer.voice.offlineBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setOfflineVoiceOpen(false)}>
              {translate("common.close")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(noteToDelete)} onOpenChange={(open) => !open && !deleting && setNoteToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{translate("shift.session.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {translate("shift.session.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{translate("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? translate("shift.session.deleting") : translate("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(noteToEdit)}
        onOpenChange={(open) => !open && !savingEdit && (setNoteToEdit(null), setEditValue(""))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{translate("shift.session.noteEdit")}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value.slice(0, SESSION_NOTE_MAX))}
            rows={4}
            maxLength={SESSION_NOTE_MAX}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" disabled={savingEdit} onClick={() => (setNoteToEdit(null), setEditValue(""))}>
              {translate("common.cancel")}
            </Button>
            <Button disabled={savingEdit || !editValue.trim()} onClick={() => void confirmEdit()}>
              {translate("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewImage?.title || translate("shift.session.imagePreview")}</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img
              src={previewImage.url}
              alt={previewImage.title}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
