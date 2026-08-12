import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowUp,
  Camera,
  Check,
  ChevronRight,
  FileText,
  Languages,
  Loader2,
  MessageCircle,
  Mic,
  Paperclip,
  Pause,
  Play,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildRecordsFromShiftTask,
  compressImageFile,
  deleteTaskEvidence,
  newEvidenceId,
  saveTaskEvidence,
  type TaskEvidenceRecord,
} from "@/lib/task-evidence-storage";
import { listMergedSessionEvidence, mirrorTaskEvidenceToSessionNotes, SESSION_NOTES_UPDATED_EVENT } from "@/lib/merge-session-evidence";
import { syncSessionEvidence } from "@/services/taskEvidenceService";
import { syncEvidenceUploadQueue } from "@/lib/evidence-upload-queue";
import type { ShiftTask } from "@/services/shiftService";
import {
  MUTED,
  PLUM,
  SOFT,
  TEXT,
  canMarkTaskComplete,
  hasStrongTaskEvidence,
  isMandatoryTask,
  isReadyToMarkTaskComplete,
  resolveEffectiveTaskNote,
} from "@/lib/shift-utils";
import { notifyTaskEvidenceUpdated } from "@/components/shifts/SessionTimeline";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { translateToEnglish } from "@/services/translationService";

const NOTE_MAX = 500;
const VOICE_MAX_SECONDS = 60;
const MAX_PHOTOS = 2;
const MAX_FILES = 3;
const SAVED_STATUS_MS = 1500;

const INPUT_LANGUAGE_OPTIONS = [
  { value: "auto", labelKey: "shift.session.lang.auto" },
  { value: "en", labelKey: "shift.session.lang.en" },
  { value: "es", labelKey: "shift.session.lang.es" },
  { value: "fr", labelKey: "shift.session.lang.fr" },
  { value: "ar", labelKey: "shift.session.lang.ar" },
  { value: "tl", labelKey: "shift.session.lang.tl" },
  { value: "zh", labelKey: "shift.session.lang.zh" },
  { value: "hi", labelKey: "shift.session.lang.hi" },
] as const;

async function noteToEnglish(text: string, language: string): Promise<string> {
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

type SaveState = "idle" | "saving" | "saved" | "offline";

type Props = {
  task: ShiftTask;
  sessionId: string;
  participantName?: string;
  disabled?: boolean;
  onTaskPatch: (patch: Partial<ShiftTask>) => void | Promise<void>;
  onStrongEvidence?: (patch: Partial<ShiftTask>) => void | Promise<void>;
  onMarkComplete: (merge?: Partial<ShiftTask>) => void | Promise<void>;
  onReadyChange?: (ready: boolean) => void;
  variant?: "full" | "thread";
  tutorialDemo?: boolean;
};

function formatVoiceTimer(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function taskPlaceholder(
  task: ShiftTask,
  participantName: string | undefined,
  translate: (k: string) => string,
  translateParams: (k: string, p: Record<string, string>) => string,
) {
  const name = participantName || translate("shift.evidence.theParticipant");
  const label = task.label.toLowerCase();
  if (label.includes("community")) {
    return translateParams("shift.evidence.communityPlaceholder", { name });
  }
  return translateParams("shift.evidence.taskPlaceholder", { label: task.label, name });
}

export function ShiftTaskEvidencePanel({
  task,
  sessionId,
  participantName,
  disabled,
  onTaskPatch,
  onStrongEvidence,
  onMarkComplete,
  onReadyChange,
  variant = "full",
  tutorialDemo = false,
}: Props) {
  const { translate, translateParams } = useAccessibility();
  const [note, setNote] = useState(task.note ?? "");
  const [records, setRecords] = useState<TaskEvidenceRecord[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [evidenceAddedFlash, setEvidenceAddedFlash] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState(false);
  const [inputLanguage, setInputLanguage] = useState("auto");
  const [inputFocused, setInputFocused] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const noteInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordSecondsRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const photos = records.filter((r) => r.type === "photo");
  const fileRecords = records.filter((r) => r.type === "file");
  const voiceRecord = records.find((r) => r.type === "voice");
  const textNoteContents = records.filter((r) => r.type === "text").map((r) => r.content ?? "");
  const hasStrongEvidence = photos.length > 0 || Boolean(voiceRecord);
  const weakNoteOnly = !hasStrongEvidence;
  const effectiveNote = resolveEffectiveTaskNote(note, task, textNoteContents);
  const readyToMarkComplete = isReadyToMarkTaskComplete(task, effectiveNote, {
    hasLocalStrongEvidence: hasStrongEvidence,
  });

  const clearSavedStatusTimer = () => {
    if (savedStatusTimerRef.current != null) {
      window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
  };

  const scheduleSavedStatusClear = useCallback(() => {
    clearSavedStatusTimer();
    savedStatusTimerRef.current = window.setTimeout(() => {
      setSaveState("idle");
      savedStatusTimerRef.current = null;
    }, SAVED_STATUS_MS);
  }, []);

  const markThreadSaved = useCallback(() => {
    setSaveState("saved");
    scheduleSavedStatusClear();
  }, [scheduleSavedStatusClear]);

  const loadRecords = useCallback(async () => {
    try {
      let rows = await listMergedSessionEvidence(sessionId, task.task_id);
      if (!rows.length) {
        const seeded = buildRecordsFromShiftTask(task, sessionId);
        if (seeded.length) {
          for (const row of seeded) {
            await saveTaskEvidence(row);
          }
          rows = seeded;
        }
      }
      setRecords(rows);
      const voice = rows.find((r) => r.type === "voice");
      if (voice?.content?.startsWith("data:audio")) {
        setVoiceUrl(voice.content);
      } else if (voice?.file_url) {
        setVoiceUrl(voice.file_url);
      }
    } catch {
      setRecords([]);
    }
  }, [sessionId, task]);

  const queueSync = useCallback(
    async (batch: TaskEvidenceRecord[]) => {
      if (!batch.length) return;
      setSaveState("saving");
      if (tutorialDemo) {
        for (const row of batch) {
          await saveTaskEvidence({
            ...row,
            synced: true,
            upload_status: "uploaded",
          });
        }
        setSaveState("saved");
        await loadRecords();
        if (variant === "thread") markThreadSaved();
        return;
      }
      try {
        if (!navigator.onLine) {
          setSaveState("offline");
          return;
        }
        const textOnly = batch.filter((r) => r.type === "text" && !r.synced);
        const media = batch.filter((r) => r.type === "photo" || r.type === "voice");

        if (textOnly.length) {
          await syncSessionEvidence(sessionId, textOnly);
          for (const row of textOnly) {
            await saveTaskEvidence({ ...row, synced: true, upload_status: "uploaded" });
          }
          await mirrorTaskEvidenceToSessionNotes(sessionId, textOnly);
        }

        if (media.length) {
          for (const row of media) {
            await saveTaskEvidence({
              ...row,
              upload_status: row.upload_status ?? "pending",
              synced: false,
            });
          }
          await syncEvidenceUploadQueue(sessionId);
        }

        setSaveState("saved");
        await loadRecords();
      } catch {
        setSaveState("offline");
      }
    },
    [sessionId, loadRecords, tutorialDemo, variant, markThreadSaved],
  );

  useEffect(() => {
    if (variant === "thread") {
      setNote("");
    } else {
      setNote(task.note ?? "");
    }
    clearSavedStatusTimer();
    void loadRecords();
  }, [task.task_id, task.note, loadRecords, variant]);

  useEffect(() => {
    onReadyChange?.(readyToMarkComplete);
  }, [onReadyChange, readyToMarkComplete]);

  // Sync saved thread notes to parent so header status updates without checkbox click.
  useEffect(() => {
    if (variant !== "thread") return;
    const saved = resolveEffectiveTaskNote("", task, textNoteContents);
    if (saved.length >= 20 && saved !== (task.note ?? "").trim()) {
      void onTaskPatch({ note: saved });
    }
  }, [onTaskPatch, task, textNoteContents, variant]);

  // Debounce draft note to parent while typing (≥20 chars).
  useEffect(() => {
    if (variant !== "thread" || disabled) return;
    const inputDraft = note.trim();
    if (inputDraft.length < 20) return;
    const timer = window.setTimeout(() => {
      if (inputDraft !== (task.note ?? "").trim()) {
        void onTaskPatch({ note: inputDraft });
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [disabled, note, onTaskPatch, task.note, variant]);

  useEffect(() => {
    const retry = async () => {
      try {
        await syncEvidenceUploadQueue(sessionId);
      } catch {
        /* ignore offline storage errors */
      }
    };
    const handler = () => void retry();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [sessionId]);

  useEffect(() => {
    const handler = () => void loadRecords();
    window.addEventListener(SESSION_NOTES_UPDATED_EVENT, handler);
    window.addEventListener("task-evidence-updated", handler);
    return () => {
      window.removeEventListener(SESSION_NOTES_UPDATED_EVENT, handler);
      window.removeEventListener("task-evidence-updated", handler);
    };
  }, [loadRecords]);

  const markEvidenceAdded = useCallback(() => {
    setEvidenceAddedFlash(true);
    clearSavedStatusTimer();
    savedStatusTimerRef.current = window.setTimeout(() => {
      setEvidenceAddedFlash(false);
      savedStatusTimerRef.current = null;
    }, 2000);
  }, []);

  const applyStrongEvidence = useCallback(
    (patch: Partial<ShiftTask>) => {
      if (onStrongEvidence) {
        onStrongEvidence(patch);
      } else {
        onTaskPatch(patch);
        if (!task.completed) onMarkComplete();
      }
      markEvidenceAdded();
    },
    [markEvidenceAdded, onMarkComplete, onStrongEvidence, onTaskPatch, task.completed],
  );

  const appendThreadEvidence = useCallback(
    async (record: TaskEvidenceRecord) => {
      await saveTaskEvidence(record);
      await queueSync([record]);
      notifyTaskEvidenceUpdated();
      await loadRecords();
      if (variant === "thread") markThreadSaved();
    },
    [loadRecords, markThreadSaved, queueSync, variant],
  );

  const submitProgressUpdate = useCallback(async () => {
    const trimmed = note.trim();
    if (!trimmed || disabled || submittingNote) return;
    if (isMandatoryTask(task) && trimmed.length < 20) return;

    setSubmittingNote(true);
    try {
      const english = await noteToEnglish(trimmed, inputLanguage);
      const record: TaskEvidenceRecord = {
        evidence_id: newEvidenceId(),
        task_id: task.task_id,
        goal_id: task.goal_id ?? null,
        session_id: sessionId,
        type: "text",
        content: english.slice(0, NOTE_MAX),
        created_at: new Date().toISOString(),
        synced: false,
      };

      await onTaskPatch({ note: english });
      setNote("");
      setInputFocused(false);
      noteInputRef.current?.blur();
      await appendThreadEvidence(record);

      if (!task.completed && canMarkTaskComplete({ ...task, note: english })) {
        await onMarkComplete({ note: english });
      }
    } finally {
      setSubmittingNote(false);
    }
  }, [
    appendThreadEvidence,
    disabled,
    inputLanguage,
    note,
    onMarkComplete,
    onTaskPatch,
    sessionId,
    submittingNote,
    task,
    task.goal_id,
    task.task_id,
  ]);

  const persistText = useCallback(
    async (text: string) => {
      const trimmed = text.slice(0, NOTE_MAX);
      await onTaskPatch({ note: trimmed });
      const existing = records.find((r) => r.type === "text");
      const record: TaskEvidenceRecord = {
        evidence_id: existing?.evidence_id ?? newEvidenceId(),
        task_id: task.task_id,
        goal_id: task.goal_id ?? null,
        session_id: sessionId,
        type: "text",
        content: trimmed,
        created_at: existing?.created_at ?? new Date().toISOString(),
        synced: false,
      };
      await saveTaskEvidence(record);
      await queueSync([record]);
      notifyTaskEvidenceUpdated();
    },
    [onTaskPatch, queueSync, records, sessionId, task.goal_id, task.task_id],
  );

  useEffect(() => {
    if (variant === "thread") return;
    if (saveTimerRef.current) window.clearInterval(saveTimerRef.current);
    saveTimerRef.current = window.setInterval(() => {
      if (note !== (task.note ?? "")) void persistText(note);
    }, 5000);
    return () => {
      if (saveTimerRef.current) window.clearInterval(saveTimerRef.current);
    };
  }, [note, task.note, persistText, variant]);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled || uploadingFile) return;
    if (!file.type.startsWith("image/")) {
      setCameraError(translate("shift.evidence.onlyImages"));
      return;
    }
    if (photos.length >= MAX_PHOTOS) {
      setCameraError(translateParams("shift.evidence.maxPhotosPerTask", { max: String(MAX_PHOTOS) }));
      return;
    }

    setCameraError(null);
    setUploadingFile(true);
    setSaveState("saving");
    try {
      const { dataUrl, bytes } = await compressImageFile(file);
      const record: TaskEvidenceRecord = {
        evidence_id: newEvidenceId(),
        task_id: task.task_id,
        goal_id: task.goal_id ?? null,
        session_id: sessionId,
        type: "photo",
        content: dataUrl,
        file_name: file.name,
        file_size_bytes: bytes,
        mime_type: file.type || "image/jpeg",
        created_at: new Date().toISOString(),
        synced: false,
        upload_status: "pending",
        retry_count: 0,
      };
      await saveTaskEvidence(record);
      const thumbs = [...(task.photo_thumbnails ?? []), dataUrl].slice(-MAX_PHOTOS);
      applyStrongEvidence({ photo_evidence: record.evidence_id, photo_thumbnails: thumbs });
      await queueSync([record]);
      notifyTaskEvidenceUpdated();
      if (variant === "thread") markThreadSaved();
    } catch (err) {
      setCameraError((err as Error).message || translate("shift.evidence.attachFailed"));
      setSaveState("idle");
    } finally {
      setUploadingFile(false);
    }
  };

  const startCamera = async () => {
    if (disabled || photos.length >= MAX_PHOTOS) return;
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOpen(true);
    } catch {
      setCameraError(translate("shift.evidence.cameraDenied"));
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return;
    const file = new File([blob], `task-${task.task_id}-${Date.now()}.jpg`, { type: "image/jpeg" });
    const { dataUrl, bytes } = await compressImageFile(file);
    const record: TaskEvidenceRecord = {
      evidence_id: newEvidenceId(),
      task_id: task.task_id,
      goal_id: task.goal_id ?? null,
      session_id: sessionId,
      type: "photo",
      content: dataUrl,
      file_size_bytes: bytes,
      mime_type: "image/jpeg",
      created_at: new Date().toISOString(),
      synced: false,
      upload_status: "pending",
      retry_count: 0,
    };
    await saveTaskEvidence(record);
    const thumbs = [...(task.photo_thumbnails ?? []), dataUrl].slice(-MAX_PHOTOS);
    applyStrongEvidence({ photo_evidence: record.evidence_id, photo_thumbnails: thumbs });
    await queueSync([record]);
    stopCamera();
    await loadRecords();
    notifyTaskEvidenceUpdated();
    if (variant === "thread") markThreadSaved();
  };

  const removePhoto = async (evidenceId: string) => {
    await deleteTaskEvidence(evidenceId);
    const next = records.filter((r) => r.evidence_id !== evidenceId);
    setRecords(next);
    onTaskPatch({
      photo_thumbnails: next.filter((r) => r.type === "photo").map((r) => r.content),
      photo_evidence: next.find((r) => r.type === "photo")?.evidence_id ?? null,
    });
  };

  const stopRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const startRecording = async () => {
    if (disabled || voiceRecord) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setCameraError(translate("composer.voice.offlineBody"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 },
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const duration = recordSecondsRef.current;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = String(reader.result || "");
          const record: TaskEvidenceRecord = {
            evidence_id: newEvidenceId(),
            task_id: task.task_id,
            goal_id: task.goal_id ?? null,
            session_id: sessionId,
            type: "voice",
            content: dataUrl,
            duration_seconds: duration,
            file_size_bytes: blob.size,
            mime_type: mimeType.split(";")[0],
            created_at: new Date().toISOString(),
            synced: false,
            upload_status: "pending",
            retry_count: 0,
          };
          await saveTaskEvidence(record);
          setVoiceUrl(dataUrl);
          applyStrongEvidence({
            voice_evidence: record.evidence_id,
            voice_duration_seconds: duration,
          });
          await queueSync([record]);
          await loadRecords();
          notifyTaskEvidenceUpdated();
          if (variant === "thread") markThreadSaved();
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recordSecondsRef.current = 0;
      setRecordSeconds(0);
      setRecording(true);
      recorder.start();
      recordTimerRef.current = window.setInterval(() => {
        recordSecondsRef.current += 1;
        setRecordSeconds(recordSecondsRef.current);
        if (recordSecondsRef.current >= VOICE_MAX_SECONDS) {
          stopRecording();
        }
      }, 1000);
    } catch {
      setCameraError(translate("shift.evidence.micDenied"));
    }
  };

  const removeVoice = async () => {
    if (!voiceRecord) return;
    await deleteTaskEvidence(voiceRecord.evidence_id);
    setVoiceUrl(null);
    onTaskPatch({ voice_evidence: null, voice_duration_seconds: null });
    await loadRecords();
  };

  const togglePlayVoice = () => {
    if (!voiceUrl) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(voiceUrl);
      audioRef.current.onended = () => setPlayingVoice(false);
    }
    if (playingVoice) {
      audioRef.current.pause();
      setPlayingVoice(false);
    } else {
      void audioRef.current.play();
      setPlayingVoice(true);
    }
  };

  const handleMarkComplete = useCallback(async () => {
    const trimmed = resolveEffectiveTaskNote(note, task, textNoteContents);
    if (
      !isReadyToMarkTaskComplete(task, trimmed, { hasLocalStrongEvidence: hasStrongEvidence })
    ) {
      setCameraError(
        isMandatoryTask(task)
          ? translate("tasks.evidenceRequiredHint")
          : translate("shift.evidence.optionalEvidence"),
      );
      return;
    }

    setCameraError(null);
    setSaveState("saving");
    try {
      const merge: Partial<ShiftTask> = {};
      if (trimmed) merge.note = trimmed;

      const inputDraft = note.trim();
      if (trimmed) {
        await onTaskPatch({ note: trimmed });
        if (variant === "thread" && inputDraft) {
          const record: TaskEvidenceRecord = {
            evidence_id: newEvidenceId(),
            task_id: task.task_id,
            goal_id: task.goal_id ?? null,
            session_id: sessionId,
            type: "text",
            content: trimmed.slice(0, NOTE_MAX),
            created_at: new Date().toISOString(),
            synced: false,
          };
          await appendThreadEvidence(record);
          setNote("");
        } else if (variant === "full" && inputDraft) {
          await persistText(trimmed);
        }
      }

      await onMarkComplete(Object.keys(merge).length ? merge : undefined);
      if (variant === "full") {
        setSaveState("saved");
        scheduleSavedStatusClear();
      }
    } catch (err) {
      setCameraError((err as Error).message || translate("shift.evidence.completeFailed"));
      setSaveState("idle");
    }
  }, [
    appendThreadEvidence,
    hasStrongEvidence,
    note,
    onMarkComplete,
    onTaskPatch,
    persistText,
    scheduleSavedStatusClear,
    sessionId,
    task,
    textNoteContents,
    task.goal_id,
    task.task_id,
    variant,
  ]);

  useEffect(() => () => {
    stopCamera();
    stopRecording();
    clearSavedStatusTimer();
    if (saveTimerRef.current) window.clearInterval(saveTimerRef.current);
  }, []);

  if (variant === "thread") {
    const hasSavedEvidence =
      records.some(
        (r) =>
          (r.type === "text" && (r.content?.trim().length ?? 0) >= 20)
          || r.type === "photo"
          || r.type === "voice",
      ) || saveState === "saved";
    const showTranslateBadge = note.trim().length > 0 && inputLanguage !== "en";

    return (
      <div className="relative border-t border-cc-border bg-cc-soft p-3" data-tutorial="task-evidence-panel">
        {task.description && (
          <p className="mb-2 text-xs font-semibold italic leading-relaxed" style={{ color: MUTED }}>
            {task.description}
          </p>
        )}

        <div className="mb-3 min-h-[120px] rounded-xl border border-dashed border-cc-border bg-cc-soft p-3">
          {records.length === 0 ? (
            <div className="flex h-full min-h-[96px] flex-col items-center justify-center text-center">
              <span className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-[#F1EAFF]">
                <MessageCircle size={18} className="text-[#8B75D9]" />
              </span>
              <p className="text-xs font-black" style={{ color: TEXT }}>
                {translate("shift.evidence.noUpdates")}
              </p>
              <p className="mt-1 max-w-[220px] text-[11px] font-semibold" style={{ color: MUTED }}>
                {translate("shift.evidence.addHint")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {records.map((record) => (
                <div
                  key={record.evidence_id}
                  className="rounded-lg border border-cc-border bg-card/90 px-3 py-2 text-xs font-semibold"
                  style={{ color: TEXT }}
                >
                  {record.type === "photo" && (
                    <div className="flex items-center gap-2">
                      <Camera size={14} className="text-[#8B75D9]" />
                      <span>{translate("shift.evidence.photoAdded")}</span>
                    </div>
                  )}
                  {record.type === "voice" && (
                    record.content?.startsWith("data:audio") ? (
                      <div className="flex items-center gap-2">
                        <Mic size={14} className="text-[#8B75D9]" />
                        <span>
                          {translate("shift.evidence.voiceNote")}
                          {record.duration_seconds
                            ? ` (${formatVoiceTimer(record.duration_seconds)})`
                            : ""}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="whitespace-pre-wrap leading-relaxed">{record.content}</p>
                        <p className="flex items-center gap-1.5 text-[11px]" style={{ color: MUTED }}>
                          <Mic size={12} className="text-[#8B75D9]" />
                          <span>
                            {translate("shift.evidence.voiceNote")}
                            {record.duration_seconds
                              ? ` (${formatVoiceTimer(record.duration_seconds)})`
                              : ""}
                          </span>
                        </p>
                      </div>
                    )
                  )}
                  {record.type === "text" && (
                    <p className="whitespace-pre-wrap leading-relaxed">{record.content}</p>
                  )}
                  {record.type === "file" && (
                    <div className="flex items-center gap-2">
                      <Paperclip size={14} className="text-[#8B75D9]" />
                      {record.file_url ? (
                        <a
                          href={record.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate underline-offset-2 hover:underline"
                        >
                          {record.file_name || record.content}
                        </a>
                      ) : (
                        <span className="truncate">{record.file_name || record.content}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {cameraError && (
          <p
            data-tutorial="task-evidence-error"
            className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
          >
            {cameraError}
          </p>
        )}

        {cameraOpen && (
          <div className="mb-2 space-y-2 rounded-xl border border-[#E8E8EA] bg-white p-2">
            <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black object-cover" playsInline muted />
            <div className="flex gap-2">
              <Button
                className="flex-1 rounded-xl font-bold text-white"
                style={{ background: PLUM }}
                onClick={() => void capturePhoto()}
              >
                {translate("shift.evidence.capture")}
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={stopCamera}>
                <X size={16} />
              </Button>
            </div>
          </div>
        )}

        {recording && (
          <div className="mb-2 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <span className="text-sm font-bold text-red-700">
              {formatVoiceTimer(recordSeconds)} / {formatVoiceTimer(VOICE_MAX_SECONDS)}
            </span>
            <Button size="sm" variant="outline" className="rounded-lg" onClick={stopRecording}>
              <Square size={14} className="mr-1" /> {translate("shift.evidence.stop")}
            </Button>
          </div>
        )}

        <div className="mb-2 flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-cc-muted">
            {translate("shift.session.inputLanguage")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {showTranslateBadge && (
              <span className="cc-plum-panel inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold text-cc-plum">
                <Languages size={13} />
                {translate("worker.composer.translateToEn")}
              </span>
            )}
            <label className="relative shrink-0">
            <span className="sr-only">{translate("shift.session.inputLanguage")}</span>
            <select
              value={inputLanguage}
              onChange={(e) => setInputLanguage(e.target.value)}
              disabled={disabled}
              className="h-8 min-w-[7rem] appearance-none rounded-full border border-cc-border bg-card py-0 pl-3 pr-8 text-[12px] font-semibold text-cc-text"
              aria-label={translate("shift.session.inputLanguage")}
            >
              {INPUT_LANGUAGE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {translate(item.labelKey)}
                </option>
              ))}
            </select>
            <ChevronRight size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-cc-muted" aria-hidden />
          </label>
          </div>
        </div>

        <div className="flex items-center gap-2" data-tutorial="task-evidence-actions">
          <button
            type="button"
            disabled={disabled || photos.length >= MAX_PHOTOS}
            onClick={() => void startCamera()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cc-border bg-card text-[#8B75D9]"
            aria-label={translate("shift.evidence.addPhoto")}
          >
            <Camera size={14} />
          </button>
          <button
            type="button"
            disabled={disabled || uploadingFile || photos.length >= MAX_PHOTOS}
            onClick={() => fileInputRef.current?.click()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cc-border bg-card text-[#8B75D9]"
            aria-label={translate("shift.evidence.attachImage")}
          >
            <Paperclip size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            onChange={(e) => void handleFileUpload(e)}
          />
          <input
            ref={noteInputRef}
            data-tutorial="task-evidence-note"
            value={note}
            disabled={disabled}
            maxLength={NOTE_MAX}
            placeholder={translate("shift.evidence.progressPlaceholder")}
            className="h-9 min-w-0 flex-1 rounded-full border border-cc-border bg-card px-4 text-sm text-cc-text"
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitProgressUpdate();
              }
            }}
          />
          <button
            type="button"
            disabled={disabled || Boolean(voiceRecord) || submittingNote}
            onPointerDown={() => {
              if (!inputFocused && !note.trim()) void startRecording();
            }}
            onClick={() => {
              if (inputFocused && !submittingNote) {
                void submitProgressUpdate();
              } else if (recording) {
                stopRecording();
              } else if (!note.trim()) {
                void startRecording();
              }
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
            style={{ background: inputFocused && !recording ? PLUM : "#6D4BDA" }}
            aria-label={
              inputFocused
                ? translate("worker.composer.sendNote")
                : recording
                  ? translate("shift.evidence.stop")
                  : translate("shift.evidence.recordVoice")
            }
          >
            {submittingNote ? (
              <Loader2 size={14} className="animate-spin" />
            ) : inputFocused && !recording ? (
              <ArrowUp size={16} strokeWidth={2.5} />
            ) : recording ? (
              <Square size={12} />
            ) : (
              <Mic size={14} />
            )}
          </button>
        </div>

        <p className="mt-2 text-[10px] font-bold text-cc-muted">
          {showTranslateBadge
            ? translate("worker.composer.submitHint")
            : translate("worker.composer.submitHintEn")}
        </p>

        <p className="mt-1 text-[10px] font-bold" style={{ color: MUTED }}>
          {evidenceAddedFlash && <span className="text-emerald-700">{translate("shift.evidence.added")}</span>}
          {saveState === "saving" && (uploadingFile ? translate("shift.evidence.uploadingFile") : translate("common.saving"))}
          {saveState === "saved" && translate("shift.evidence.saved")}
          {saveState === "offline" && translate("shift.evidence.offlineLocal")}
          {saveState === "idle" &&
            !evidenceAddedFlash &&
            readyToMarkComplete &&
            !task.completed && (
              <span className="text-emerald-700">{translate("shift.evidence.readyMark")}</span>
            )}
          {saveState === "idle" &&
            !evidenceAddedFlash &&
            !readyToMarkComplete &&
            isMandatoryTask(task) &&
            !task.completed &&
            note.trim().length > 0 &&
            note.trim().length < 20 && (
              <span className="text-amber-700" data-tutorial="task-evidence-error">
                {translateParams(20 - note.trim().length === 1 ? "shift.evidence.charsToComplete" : "shift.evidence.charsToCompletePlural", { count: String(20 - note.trim().length) })}
              </span>
            )}
          {saveState === "idle" &&
            !evidenceAddedFlash &&
            !readyToMarkComplete &&
            note.length > 0 &&
            !(isMandatoryTask(task) && note.trim().length > 0 && note.trim().length < 20) &&
            `${note.length}/${NOTE_MAX}`}
          {saveState === "idle" &&
            !evidenceAddedFlash &&
            !readyToMarkComplete &&
            note.length === 0 &&
            isMandatoryTask(task) &&
            !task.completed && (
              <span className="text-amber-700">{translate("shift.evidence.typeOrAttach")}</span>
            )}
        </p>

        {readyToMarkComplete && (
          <Button
            className="mt-2 h-10 w-full rounded-xl border-0 text-sm font-black text-white"
            style={{ background: PLUM }}
            disabled={disabled}
            onClick={() => void handleMarkComplete()}
          >
            <Check size={16} className="mr-2 inline" />
            {translateParams("tasks.markComplete", { label: task.label })}
          </Button>
        )}
        {hasSavedEvidence && (
          <div
            data-tutorial="task-evidence-saved"
            className="pointer-events-none absolute left-0 top-0 h-[2px] w-[2px] overflow-hidden opacity-0"
            aria-hidden="true"
          />
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-[#E8E8EA]">
      <div className="space-y-2 border-b border-[#E8E8EA] px-3 py-3" style={{ background: SOFT }}>
        <p className="text-sm font-black" style={{ color: TEXT }}>
          {task.label}
        </p>
        {task.goal_title && (
          <p className="text-xs font-bold" style={{ color: PLUM }}>
            {translate("tasks.ndisGoal")}: {task.goal_title}
          </p>
        )}
        {task.description && (
          <p className="text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
            {task.description}
          </p>
        )}
        {task.outcome_tip && (
          <p className="text-xs font-semibold italic" style={{ color: MUTED }}>
            {translate("shift.evidence.outcomeTip")} {task.outcome_tip}
          </p>
        )}
      </div>

      <div className="space-y-4 p-3">
        <div className="flex items-center justify-between text-[10px] font-bold" style={{ color: MUTED }}>
          <span>
            {saveState === "saving" && `⟳ ${translate("common.saving")}`}
            {saveState === "saved" && `✓ ${translate("shift.evidence.saved")}`}
            {saveState === "offline" && translate("shift.evidence.offlineLocal")}
          </span>
          {records[0]?.created_at && (
            <span>{translateParams("shift.evidence.capturedAt", { time: format(new Date(records[records.length - 1].created_at), "h:mm a") })}</span>
          )}
        </div>

        {cameraError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {cameraError}
          </p>
        )}

        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: PLUM }}>
            <Camera size={13} /> {translate("shift.evidence.photoStrong")} <span className="text-emerald-600">{translate("shift.evidence.strongCheck")}</span>
          </p>
          {cameraOpen ? (
            <div className="space-y-2 rounded-xl border border-[#E8E8EA] p-2">
              <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black object-cover" playsInline muted />
              <div className="flex gap-2">
                <Button className="flex-1 rounded-xl font-bold text-white" style={{ background: PLUM }} onClick={() => void capturePhoto()}>
                  {translate("shift.evidence.capture")}
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={stopCamera}>
                  <X size={16} />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled || photos.length >= MAX_PHOTOS}
              onClick={() => void startCamera()}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-4 text-sm font-bold",
                photos.length ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-[#C4B5FD] bg-white",
              )}
              style={photos.length ? undefined : { color: PLUM }}
            >
              <Camera size={18} />
              {photos.length >= MAX_PHOTOS ? translate("shift.evidence.maxPhotos") : translate("shift.evidence.capturePhoto")}
            </button>
          )}
          {photos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {photos.map((photo) => (
                <div key={photo.evidence_id} className="relative">
                  <img
                    src={photo.file_url || photo.content}
                    alt={translate("shift.evidence.taskEvidenceAlt")}
                    className="h-[150px] w-[150px] rounded-xl border object-cover"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow"
                    onClick={() => void removePhoto(photo.evidence_id)}
                    aria-label={translate("shift.evidence.removePhoto")}
                  >
                    <Trash2 size={14} className="text-red-600" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: PLUM }}>
            <Mic size={13} /> {translate("shift.evidence.voiceStrong")} <span className="text-emerald-600">{translate("shift.evidence.strongCheck")}</span>
          </p>
          {!voiceRecord ? (
            <button
              type="button"
              disabled={disabled || recording}
              onClick={() => void startRecording()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E8E8EA] bg-[#F4EDE6] py-3.5 text-sm font-bold"
              style={{ color: PLUM }}
            >
              <Mic size={18} /> {translate("shift.evidence.startVoice")}
            </button>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-bold text-emerald-800">
                ✓ {translate("shift.evidence.voiceSaved")} {voiceRecord.duration_seconds ? `(${formatVoiceTimer(voiceRecord.duration_seconds)})` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" className="rounded-lg" onClick={togglePlayVoice}>
                  {playingVoice ? <Pause size={14} /> : <Play size={14} />}
                  {playingVoice ? translate("shift.evidence.pause") : translate("shift.evidence.play")}
                </Button>
                <Button variant="outline" size="sm" className="rounded-lg text-red-600" onClick={() => void removeVoice()}>
                  <Trash2 size={14} className="mr-1" /> {translate("shift.evidence.rerecord")}
                </Button>
              </div>
            </div>
          )}
          {recording && (
            <div className="mt-2 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <span className="text-sm font-bold text-red-700">
                {formatVoiceTimer(recordSeconds)} / {formatVoiceTimer(VOICE_MAX_SECONDS)}
              </span>
              <Button size="sm" variant="outline" className="rounded-lg" onClick={stopRecording}>
                <Square size={14} className="mr-1" /> {translate("shift.evidence.stop")}
              </Button>
            </div>
          )}
        </section>

        <section>
          <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: PLUM }}>
            <FileText size={13} /> {translate("shift.evidence.writtenNote")}
            {weakNoteOnly && <span className="font-black normal-case text-amber-600">{translate("shift.evidence.weakHint")}</span>}
          </p>
          <Textarea
            value={note}
            disabled={disabled}
            maxLength={NOTE_MAX}
            placeholder={taskPlaceholder(task, participantName, translate, translateParams)}
            className="min-h-[88px] resize-none text-sm"
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            onBlur={() => {
              if (note !== (task.note ?? "")) void persistText(note);
            }}
          />
          <p className="mt-1 text-[10px] font-bold" style={{ color: MUTED }}>
            {note.length}/{NOTE_MAX}
            {!readyToMarkComplete && isMandatoryTask(task) && note.trim().length > 0 && note.trim().length < 20 && (
              <span className="ml-2 text-amber-700">
                {translateParams("shift.evidence.moreToComplete", { count: String(20 - note.trim().length) })}
              </span>
            )}
            {readyToMarkComplete && !task.completed && (
              <span className="ml-2 text-emerald-700">{translate("shift.evidence.readyToComplete")}</span>
            )}
          </p>
        </section>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {isMandatoryTask(task)
              ? translate("tasks.evidenceRequiredHint")
              : translate("shift.evidence.optionalWeak")}
          </p>
        </div>

        {readyToMarkComplete && (
          <Button
            className="h-11 w-full rounded-xl border-0 text-sm font-black text-white"
            style={{ background: PLUM }}
            disabled={disabled}
            onClick={() => void handleMarkComplete()}
          >
            <Check size={16} className="mr-2 inline" />
            {translateParams("tasks.markComplete", { label: task.label })}
          </Button>
        )}
      </div>
    </div>
  );
}
