import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createMeetingSession,
  transcribeAndResolveNames,
  type ConsentGivenBy,
  type ConsentMethod,
} from "@/services/coordinatorService";
import { uploadMeetGreetRecording, type ParticipantIntake } from "@/services/participantIntakeService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PINK = "#E8457A";
const BARS = 32;
const AUTOSAVE_MS = 800;

type SaveState = "saved" | "dirty" | "saving" | "error";
type Phase = "idle" | "starting" | "recording" | "uploading" | "transcribing";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
}

/** The server's reason, said plainly — "Not Found" means the server
 * hasn't been updated with Easy Capture yet. */
function describeFailure(err: unknown, fallback: string | undefined): string | undefined {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return "The server doesn't have Easy Capture yet — the API needs redeploying.";
  if (status === 413) return "The recording is too long (25MB limit). Record in shorter parts.";
  if (err instanceof TypeError) return "Couldn't reach the server — check your connection.";
  const message = err instanceof Error ? err.message : "";
  return message.replace(/^Could not transcribe audio:\s*/, "Transcription failed: ") || fallback;
}

function formatElapsed(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

/** Autosaves notes shortly after typing stops, and on leaving the page. */
export function useAutosave(value: string, save: (value: string) => Promise<unknown>, enabled: boolean) {
  const [state, setState] = useState<SaveState>("saved");
  const lastSaved = useRef(value);
  const latest = useRef(value);
  const saveRef = useRef(save);
  saveRef.current = save;
  latest.current = value;

  useEffect(() => {
    if (!enabled || value === lastSaved.current) return;
    setState("dirty");
    const timer = window.setTimeout(async () => {
      const snapshot = value;
      setState("saving");
      try {
        await saveRef.current(snapshot);
        lastSaved.current = snapshot;
        setState(latest.current === snapshot ? "saved" : "dirty");
      } catch {
        setState("error");
      }
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [value, enabled]);

  // Don't lose the last few keystrokes when navigating away.
  useEffect(
    () => () => {
      if (enabled && latest.current !== lastSaved.current) void saveRef.current(latest.current).catch(() => {});
    },
    [enabled],
  );

  return state;
}

const SAVE_PILL: Record<SaveState, { label: string; fg: string; bg: string }> = {
  saved: { label: "Saved", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" },
  dirty: { label: "Editing", fg: MUTED, bg: "var(--cc-soft)" },
  saving: { label: "Saving…", fg: MUTED, bg: "var(--cc-soft)" },
  error: { label: "Not saved", fg: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)" },
};

export function MeetGreetCapture({
  intake,
  notes,
  onNotesChange,
  onSaveNotes,
  onRecordingSaved,
  coordinatorName,
  editable,
}: {
  intake: ParticipantIntake;
  notes: string;
  onNotesChange: (notes: string) => void;
  /** Persists the notes (PATCH meet_greet_notes). */
  onSaveNotes: (notes: string) => Promise<unknown>;
  /** The intake as returned after the recording upload. */
  onRecordingSaved: (patch: Partial<ParticipantIntake>) => void;
  coordinatorName?: string;
  /** False once the intake has moved past Meet & Greet: read-only. */
  editable: boolean;
}) {
  const { toast } = useToast();
  const firstName = intake.full_name.split(" ")[0] || intake.full_name;
  const [consented, setConsented] = useState(false);
  const [givenBy, setGivenBy] = useState<ConsentGivenBy>("participant");
  const [method, setMethod] = useState<ConsentMethod>("verbal");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  // Tapping the mic before consent points at the consent box instead of
  // doing nothing.
  const [needsConsent, setNeedsConsent] = useState(false);
  const consentRef = useRef<HTMLInputElement>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<string | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const saveState = useAutosave(notes, onSaveNotes, editable);

  const stopMeters = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    timerRef.current = null;
    frameRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevels(Array(BARS).fill(0));
  };

  useEffect(
    () => () => {
      // Leaving mid-recording: release the microphone.
      stopMeters();
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const startMeter = (stream: MediaStream) => {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    ctx.createMediaStreamSource(stream).connect(analyser);
    audioCtxRef.current = ctx;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.max(1, Math.floor(data.length / BARS));
      setLevels(Array.from({ length: BARS }, (_, i) => data[i * step] / 255));
      frameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  async function finishRecording(blob: Blob) {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    setPhase("uploading");
    try {
      const saved = await uploadMeetGreetRecording(intake.id, sessionId, blob);
      onRecordingSaved({
        meet_greet_recording_url: saved.meet_greet_recording_url,
        meet_greet_session_id: saved.meet_greet_session_id,
      });
    } catch (err) {
      toast({
        title: "Recording not saved",
        description: describeFailure(err, "Try recording again."),
        variant: "destructive",
      });
      setPhase("idle");
      return;
    }
    setPhase("transcribing");
    try {
      const result = await transcribeAndResolveNames(sessionId, blob, coordinatorName, intake.full_name, []);
      const text = result.clean_transcript
        .map((seg) => (seg.speaker_name ? `${seg.speaker_name}: ${seg.text}` : seg.text))
        .join("\n")
        .trim();
      if (text) {
        const current = notesRef.current.trim();
        onNotesChange(current ? `${current}\n\nTranscript:\n${text}` : `Transcript:\n${text}`);
      }
    } catch (err) {
      const reason = describeFailure(err, "");
      toast({
        title: "Recording saved — not transcribed",
        description: `You can play it back below and type the notes.${reason ? ` (${reason})` : ""}`,
      });
    } finally {
      setPhase("idle");
    }
  }

  async function start() {
    if (phase !== "idle") return;
    if (!consented) {
      setNeedsConsent(true);
      consentRef.current?.focus();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast({ title: "Recording isn't supported in this browser", variant: "destructive" });
      return;
    }
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      toast({
        title: err?.name === "NotAllowedError" ? "Microphone access denied" : "Couldn't start the microphone",
        description: err?.name === "NotAllowedError" ? "Allow microphone access to record." : err?.message,
        variant: "destructive",
      });
      setPhase("idle");
      return;
    }
    try {
      // Consent is recorded server-side (with its own timestamp) before any audio exists.
      const session = await createMeetingSession(
        "meet_greet", new Date().toISOString().slice(0, 10), undefined, undefined, givenBy, method, intake.id,
      );
      sessionRef.current = session.session_id;
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      toast({ title: "Couldn't start recording", description: describeFailure(err, undefined), variant: "destructive" });
      setPhase("idle");
      return;
    }
    let mimeType = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void finishRecording(new Blob(chunks, { type: mimeType.split(";")[0] }));
    };
    recorder.start();
    recorderRef.current = recorder;
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    startMeter(stream);
    setPhase("recording");
  }

  function stop() {
    stopMeters();
    recorderRef.current?.stop();
    recorderRef.current = null;
    // Each new recording needs its own consent confirmation.
    setConsented(false);
  }

  const recording = phase === "recording";
  const busy = phase === "starting" || phase === "uploading" || phase === "transcribing";
  const pill = SAVE_PILL[saveState];
  const selectClass = "h-7 rounded-md border bg-transparent px-1.5 text-[11px]";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold text-white"
          style={{ background: "#7079C4" }}
        >
          {initials(intake.full_name)}
        </span>
        <h2 className="text-xl font-bold tracking-tight" style={{ color: TEXT }}>{intake.full_name}</h2>
        <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ background: "#E3ECFB", color: "#1D4ED8" }}>
          Meet &amp; Greet
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Capture */}
        <section className="flex min-h-[340px] flex-col rounded-2xl p-5" style={{ background: "#F2EDE0" }}>
          {editable ? (
            <div
              className="rounded-xl border bg-white px-3 py-2.5 transition-shadow"
              style={{
                borderColor: needsConsent ? PINK : BORDER,
                boxShadow: needsConsent ? "0 0 0 3px rgba(232,69,122,0.18)" : undefined,
              }}
            >
              <label className="flex cursor-pointer items-center gap-2.5 text-[13px]" style={{ color: TEXT }}>
                <input
                  ref={consentRef}
                  type="checkbox"
                  className="h-4 w-4 accent-[#0F7B57]"
                  checked={consented}
                  disabled={recording || busy}
                  onChange={(e) => {
                    setConsented(e.target.checked);
                    if (e.target.checked) setNeedsConsent(false);
                  }}
                />
                {givenBy === "participant" ? `${firstName} consents` : `${firstName}'s ${givenBy} consents`} to recording
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6 text-[11px]" style={{ color: MUTED }}>
                Given by
                <select aria-label="Consent given by" className={selectClass} style={{ borderColor: BORDER }} value={givenBy}
                  disabled={recording || busy} onChange={(e) => setGivenBy(e.target.value as ConsentGivenBy)}>
                  <option value="participant">{firstName}</option>
                  <option value="nominee">Nominee</option>
                  <option value="guardian">Guardian</option>
                </select>
                <select aria-label="Consent method" className={selectClass} style={{ borderColor: BORDER }} value={method}
                  disabled={recording || busy} onChange={(e) => setMethod(e.target.value as ConsentMethod)}>
                  <option value="verbal">Verbal</option>
                  <option value="written">Written</option>
                </select>
              </div>
            </div>
          ) : (
            <p className="text-[12px]" style={{ color: MUTED }}>Meet &amp; Greet completed.</p>
          )}

          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
            {editable && (
              <button
                type="button"
                onClick={recording ? stop : start}
                disabled={!recording && busy}
                aria-label={recording ? "Stop recording" : "Start recording"}
                title={!recording && !consented ? "Confirm consent first" : undefined}
                className={`flex h-[88px] w-[88px] items-center justify-center rounded-full text-white transition-transform enabled:hover:scale-105 disabled:opacity-40 ${
                  !recording && !consented && !busy ? "opacity-60" : ""
                }`}
                style={{ background: PINK, boxShadow: recording ? "0 0 0 10px rgba(232,69,122,0.18)" : "0 10px 24px rgba(232,69,122,0.35)" }}
              >
                {busy ? <Loader2 size={30} className="animate-spin" /> : recording ? <Square size={26} fill="white" /> : <Mic size={32} />}
              </button>
            )}
            <p className="text-[15px] font-bold tabular-nums" style={{ color: TEXT }} aria-live="polite">
              {recording ? formatElapsed(elapsed)
                : phase === "uploading" ? "Saving recording…"
                : phase === "transcribing" ? "Transcribing…"
                : phase === "starting" ? "Starting…"
                : editable ? (consented ? "Tap to record" : needsConsent ? "Tick consent above first" : "Confirm consent to record")
                : ""}
            </p>
            <div className="flex h-8 items-center gap-[3px]" aria-hidden>
              {levels.map((level, i) => (
                <span
                  key={i}
                  className="w-[5px] rounded-full transition-[height] duration-75"
                  style={{
                    height: recording ? `${Math.max(5, level * 32)}px` : "5px",
                    background: recording ? PINK : "#D9D2C1",
                  }}
                />
              ))}
            </div>
          </div>

          {intake.meet_greet_recording_url && !recording && (
            <audio controls src={intake.meet_greet_recording_url} className="h-9 w-full" aria-label="Meet & Greet recording" />
          )}
        </section>

        {/* Notes */}
        <section className="flex min-h-[340px] flex-col rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[14px] font-bold" style={{ color: TEXT }}>Meeting notes</h3>
            {editable && (
              <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: pill.fg, background: pill.bg }}>
                {pill.label}
              </span>
            )}
          </div>
          <textarea
            aria-label="Meeting notes"
            value={notes}
            readOnly={!editable}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={`What does ${firstName} want support with? Goals, preferences, access needs…`}
            className="mt-3 w-full flex-1 resize-none bg-transparent text-[15px] leading-7 outline-none"
            style={{ color: TEXT }}
          />
        </section>
      </div>
    </div>
  );
}
