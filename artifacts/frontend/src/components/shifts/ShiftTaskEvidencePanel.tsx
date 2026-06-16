import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  Camera,
  Check,
  FileText,
  Mic,
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
  compressImageFile,
  deleteTaskEvidence,
  listTaskEvidence,
  newEvidenceId,
  saveTaskEvidence,
  type TaskEvidenceRecord,
} from "@/lib/task-evidence-storage";
import { syncSessionEvidence } from "@/services/taskEvidenceService";
import type { ShiftTask } from "@/services/shiftService";
import { MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";

const NOTE_MAX = 500;
const VOICE_MAX_SECONDS = 60;
const MAX_PHOTOS = 2;

type SaveState = "idle" | "saving" | "saved" | "offline";

type Props = {
  task: ShiftTask;
  sessionId: string;
  participantName?: string;
  disabled?: boolean;
  onTaskPatch: (patch: Partial<ShiftTask>) => void;
  onMarkComplete: () => void;
};

function formatVoiceTimer(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function taskPlaceholder(task: ShiftTask, participantName?: string) {
  const name = participantName || "the participant";
  const label = task.label.toLowerCase();
  if (label.includes("community")) {
    return `What did ${name} do during community time?`;
  }
  return `${task.label} — What did ${name} do?`;
}

export function ShiftTaskEvidencePanel({
  task,
  sessionId,
  participantName,
  disabled,
  onTaskPatch,
  onMarkComplete,
}: Props) {
  const [note, setNote] = useState(task.note ?? "");
  const [records, setRecords] = useState<TaskEvidenceRecord[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordSecondsRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const photos = records.filter((r) => r.type === "photo");
  const voiceRecord = records.find((r) => r.type === "voice");
  const hasStrongEvidence = photos.length > 0 || Boolean(voiceRecord);
  const weakNoteOnly = !hasStrongEvidence;

  const loadRecords = useCallback(async () => {
    try {
      const rows = await listTaskEvidence(sessionId, task.task_id);
      setRecords(rows);
      const voice = rows.find((r) => r.type === "voice");
      if (voice?.content?.startsWith("data:audio")) {
        setVoiceUrl(voice.content);
      }
    } catch {
      setRecords([]);
    }
  }, [sessionId, task.task_id]);

  const queueSync = useCallback(
    async (batch: TaskEvidenceRecord[]) => {
      if (!batch.length) return;
      setSaveState("saving");
      try {
        if (!navigator.onLine) {
          setSaveState("offline");
          return;
        }
        const unsynced = batch.filter((r) => !r.synced);
        if (!unsynced.length) {
          setSaveState("saved");
          return;
        }
        await syncSessionEvidence(sessionId, unsynced);
        for (const row of unsynced) {
          await saveTaskEvidence({ ...row, synced: true });
        }
        setSaveState("saved");
        await loadRecords();
      } catch {
        setSaveState("offline");
      }
    },
    [sessionId, loadRecords],
  );

  useEffect(() => {
    setNote(task.note ?? "");
    void loadRecords();
  }, [task.task_id, task.note, loadRecords]);

  useEffect(() => {
    const retry = async () => {
      try {
        const { listUnsyncedEvidence } = await import("@/lib/task-evidence-storage");
        const pending = await listUnsyncedEvidence(sessionId);
        if (pending.length) void queueSync(pending);
      } catch {
        /* ignore offline storage errors */
      }
    };
    const handler = () => void retry();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [sessionId, queueSync]);

  const persistText = useCallback(
    async (text: string) => {
      const trimmed = text.slice(0, NOTE_MAX);
      onTaskPatch({ note: trimmed });
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
    },
    [onTaskPatch, queueSync, records, sessionId, task.goal_id, task.task_id],
  );

  useEffect(() => {
    if (saveTimerRef.current) window.clearInterval(saveTimerRef.current);
    saveTimerRef.current = window.setInterval(() => {
      if (note !== (task.note ?? "")) void persistText(note);
    }, 5000);
    return () => {
      if (saveTimerRef.current) window.clearInterval(saveTimerRef.current);
    };
  }, [note, task.note, persistText]);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
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
      setCameraError("Camera permission denied or unavailable. Check browser settings.");
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
      created_at: new Date().toISOString(),
      synced: false,
    };
    await saveTaskEvidence(record);
    const thumbs = [...(task.photo_thumbnails ?? []), dataUrl].slice(-MAX_PHOTOS);
    onTaskPatch({ photo_evidence: record.evidence_id, photo_thumbnails: thumbs });
    await queueSync([record]);
    stopCamera();
    await loadRecords();
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
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
            created_at: new Date().toISOString(),
            synced: false,
          };
          await saveTaskEvidence(record);
          setVoiceUrl(dataUrl);
          onTaskPatch({
            voice_evidence: record.evidence_id,
            voice_duration_seconds: duration,
          });
          await queueSync([record]);
          await loadRecords();
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
      setCameraError("Microphone permission denied or unavailable.");
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

  useEffect(() => () => {
    stopCamera();
    stopRecording();
    if (saveTimerRef.current) window.clearInterval(saveTimerRef.current);
  }, []);

  return (
    <div className="border-t border-[#E2DEF2]">
      <div className="space-y-2 border-b border-[#E2DEF2] px-3 py-3" style={{ background: SOFT }}>
        <p className="text-sm font-black" style={{ color: TEXT }}>
          {task.label}
        </p>
        {task.goal_title && (
          <p className="text-xs font-bold" style={{ color: PLUM }}>
            NDIS goal: {task.goal_title}
          </p>
        )}
        {task.description && (
          <p className="text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
            {task.description}
          </p>
        )}
        {task.outcome_tip && (
          <p className="text-xs font-semibold italic" style={{ color: MUTED }}>
            How will you know it&apos;s done? {task.outcome_tip}
          </p>
        )}
      </div>

      <div className="space-y-4 p-3">
        <div className="flex items-center justify-between text-[10px] font-bold" style={{ color: MUTED }}>
          <span>
            {saveState === "saving" && "⟳ Saving…"}
            {saveState === "saved" && "✓ Saved"}
            {saveState === "offline" && "⚠️ Offline — saved locally"}
          </span>
          {records[0]?.created_at && (
            <span>Captured {format(new Date(records[records.length - 1].created_at), "h:mm a")}</span>
          )}
        </div>

        {cameraError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {cameraError}
          </p>
        )}

        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: PLUM }}>
            <Camera size={13} /> Photo <span className="text-emerald-600">Strong ✓</span>
          </p>
          {cameraOpen ? (
            <div className="space-y-2 rounded-xl border border-[#E2DEF2] p-2">
              <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black object-cover" playsInline muted />
              <div className="flex gap-2">
                <Button className="flex-1 rounded-xl font-bold text-white" style={{ background: PLUM }} onClick={() => void capturePhoto()}>
                  Capture
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
              {photos.length >= MAX_PHOTOS ? "Max photos reached" : "Capture Photo Evidence"}
            </button>
          )}
          {photos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {photos.map((photo) => (
                <div key={photo.evidence_id} className="relative">
                  <img
                    src={photo.content}
                    alt="Task evidence"
                    className="h-[150px] w-[150px] rounded-xl border object-cover"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow"
                    onClick={() => void removePhoto(photo.evidence_id)}
                    aria-label="Remove photo"
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
            <Mic size={13} /> Voice <span className="text-emerald-600">Strong ✓</span>
          </p>
          {!voiceRecord ? (
            <button
              type="button"
              disabled={disabled || recording}
              onClick={() => void startRecording()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E2DEF2] bg-[#F5F3FC] py-3.5 text-sm font-bold"
              style={{ color: PLUM }}
            >
              <Mic size={18} /> Start Voice Dictation
            </button>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-bold text-emerald-800">
                ✓ Voice saved {voiceRecord.duration_seconds ? `(${formatVoiceTimer(voiceRecord.duration_seconds)})` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" className="rounded-lg" onClick={togglePlayVoice}>
                  {playingVoice ? <Pause size={14} /> : <Play size={14} />}
                  {playingVoice ? "Pause" : "Play"}
                </Button>
                <Button variant="outline" size="sm" className="rounded-lg text-red-600" onClick={() => void removeVoice()}>
                  <Trash2 size={14} className="mr-1" /> Re-record
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
                <Square size={14} className="mr-1" /> Stop
              </Button>
            </div>
          )}
        </section>

        <section>
          <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: PLUM }}>
            <FileText size={13} /> Written Note
            {weakNoteOnly && <span className="font-black normal-case text-amber-600">weak if no photo/voice</span>}
          </p>
          <Textarea
            value={note}
            disabled={disabled}
            maxLength={NOTE_MAX}
            placeholder={taskPlaceholder(task, participantName)}
            className="min-h-[88px] resize-none text-sm"
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            onBlur={() => {
              if (note !== (task.note ?? "")) void persistText(note);
            }}
          />
          <p className="mt-1 text-[10px] font-bold" style={{ color: MUTED }}>
            {note.length}/{NOTE_MAX}
          </p>
        </section>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Completing without evidence will flag this task weak in your compliance report.
          </p>
        </div>

        <Button
          className="h-11 w-full rounded-xl border-0 text-sm font-black text-white"
          style={{ background: PLUM }}
          disabled={disabled}
          onClick={onMarkComplete}
        >
          <Check size={16} className="mr-2 inline" />
          {task.completed ? "Mark incomplete" : "Mark task complete"}
        </Button>
      </div>
    </div>
  );
}
