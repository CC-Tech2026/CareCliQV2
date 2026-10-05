import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, Pause, Play, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createMeetingSession,
  transcribeAndResolveNames,
  transcribePlanMeetingAudio,
  type ConsentGivenBy,
  type ConsentMethod,
} from "@/services/coordinatorService";
import { uploadMeetGreetRecording, type ParticipantIntake } from "@/services/participantIntakeService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PINK = "var(--cc-plum)";
const BARS = 32;
const AUTOSAVE_MS = 800;
/** Length of each live-transcript segment. Each one is its own small file
 * sent to Whisper, so words show up a few seconds after they're said. */
const SEGMENT_MS = 8000;
/** Smaller than this, a segment is effectively empty — not worth a call. */
const MIN_SEGMENT_BYTES = 1000;
/** What Whisper tends to "hear" in a silent clip. */
const SILENCE_HALLUCINATION = /^(thank you\.?|thanks for watching!?|you\.?|bye\.?|\.+|\s*)$/i;

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
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  // Live transcript, one slot per segment in recording order, so a reply
  // that comes back late still lands in the right place.
  const [live, setLive] = useState<string[]>([]);
  const [liveInFlight, setLiveInFlight] = useState(0);
  const [liveOff, setLiveOff] = useState(false);
  // Tapping the mic before consent points at the consent box instead of
  // doing nothing.
  const [needsConsent, setNeedsConsent] = useState(false);
  const consentRef = useRef<HTMLInputElement>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<number | null>(null);
  const segmentSeqRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef("audio/webm");
  // Bumped per recording so a late live reply can't land in the next one.
  const runRef = useRef(0);
  const liveRef = useRef<string[]>([]);
  const liveOffRef = useRef(false);
  const pausedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
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

  const setLiveText = (next: string[]) => {
    liveRef.current = next;
    setLive(next);
  };

  useEffect(
    () => () => {
      // Leaving mid-recording: release the microphone and drop live replies.
      runRef.current += 1;
      stopMeters();
      if (segmentTimerRef.current) window.clearInterval(segmentTimerRef.current);
      if (segmentRef.current) segmentRef.current.onstop = null;
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [live, liveInFlight]);

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

  async function transcribeSegment(run: number, seq: number, blob: Blob) {
    if (liveOffRef.current || blob.size < MIN_SEGMENT_BYTES) return;
    setLiveInFlight((n) => n + 1);
    try {
      const { transcript } = await transcribePlanMeetingAudio(blob);
      const text = transcript.trim();
      if (runRef.current !== run || SILENCE_HALLUCINATION.test(text)) return;
      const next = [...liveRef.current];
      next[seq] = text;
      setLiveText(next);
    } catch (err) {
      // 422 is Whisper finding no speech in the segment — just a pause.
      if ((err as { status?: number } | null)?.status === 422 || runRef.current !== run) return;
      liveOffRef.current = true;
      setLiveOff(true);
    } finally {
      setLiveInFlight((n) => Math.max(0, n - 1));
    }
  }

  /** A second recorder on the same microphone, restarted every few seconds so
   * each segment is a complete audio file Whisper can read on its own. The
   * main recorder keeps the whole meeting for the saved copy. */
  function startSegment() {
    const stream = streamRef.current;
    if (!stream || liveOffRef.current) return;
    const run = runRef.current;
    const seq = segmentSeqRef.current++;
    const type = mimeTypeRef.current;
    const segment = new MediaRecorder(stream, { mimeType: type });
    const parts: Blob[] = [];
    segment.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
    segment.onstop = () => void transcribeSegment(run, seq, new Blob(parts, { type: type.split(";")[0] }));
    segment.start();
    segmentRef.current = segment;
  }

  function endSegment() {
    const segment = segmentRef.current;
    segmentRef.current = null;
    if (segment && segment.state !== "inactive") segment.stop();
  }

  function startSegments() {
    startSegment();
    segmentTimerRef.current = window.setInterval(() => {
      endSegment();
      startSegment();
    }, SEGMENT_MS);
  }

  function stopSegments() {
    if (segmentTimerRef.current) window.clearInterval(segmentTimerRef.current);
    segmentTimerRef.current = null;
    endSegment();
  }

  /** Falls back to the live text when the full transcript can't be made. */
  function keepLiveTranscript() {
    const text = liveRef.current.filter(Boolean).join(" ").trim();
    if (!text) return false;
    const current = notesRef.current.trim();
    onNotesChange(current ? `${current}\n\nTranscript (live):\n${text}` : `Transcript (live):\n${text}`);
    return true;
  }

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
      const kept = keepLiveTranscript();
      toast({
        title: "Recording not saved",
        description: `${describeFailure(err, "Try recording again.")}${kept ? " The live transcript was added to your notes." : ""}`,
        variant: "destructive",
      });
      runRef.current += 1;
      setLiveText([]);
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
      } else {
        keepLiveTranscript();
      }
    } catch (err) {
      const reason = describeFailure(err, "");
      const kept = keepLiveTranscript();
      toast({
        title: "Recording saved — not transcribed",
        description: kept
          ? `The live transcript was added to your notes instead.${reason ? ` (${reason})` : ""}`
          : `You can play it back below and type the notes.${reason ? ` (${reason})` : ""}`,
      });
    } finally {
      // The notes now hold the transcript; drop the live copy.
      runRef.current += 1;
      setLiveText([]);
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
    mimeTypeRef.current = mimeType;
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void finishRecording(new Blob(chunks, { type: mimeType.split(";")[0] }));
    };
    recorder.start();
    recorderRef.current = recorder;
    runRef.current += 1;
    segmentSeqRef.current = 0;
    liveOffRef.current = false;
    setLiveOff(false);
    setLiveText([]);
    startSegments();
    pausedRef.current = false;
    setPaused(false);
    setElapsed(0);
    timerRef.current = window.setInterval(() => {
      if (!pausedRef.current) setElapsed((s) => s + 1);
    }, 1000);
    startMeter(stream);
    setPhase("recording");
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (pausedRef.current) {
      recorder.resume();
      startSegments();
    } else {
      recorder.pause();
      // Send what was said so far rather than holding it until resume.
      stopSegments();
    }
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }

  function stop() {
    stopMeters();
    stopSegments();
    recorderRef.current?.stop();
    recorderRef.current = null;
    pausedRef.current = false;
    setPaused(false);
    // Each new recording needs its own consent confirmation.
    setConsented(false);
  }

  const recording = phase === "recording";
  const busy = phase === "starting" || phase === "uploading" || phase === "transcribing";
  const capturing = recording || phase === "uploading" || phase === "transcribing";
  const canPause = typeof recorderRef.current?.pause === "function";
  const liveText = live.filter(Boolean).join(" ");
  const pill = SAVE_PILL[saveState];
  const selectClass = "h-7 rounded-md border bg-transparent px-1.5 text-[11px]";
  const consentBy = givenBy === "participant" ? firstName : `${firstName}'s ${givenBy}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold text-white"
          style={{ background: "var(--cc-coral)" }}
        >
          {initials(intake.full_name)}
        </span>
        <h2 className="text-xl font-bold tracking-tight" style={{ color: TEXT }}>{intake.full_name}</h2>
        <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ background: "var(--cc-sky-tint)", color: "var(--cc-sky)" }}>
          Meet &amp; Greet
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Capture */}
        <section className="flex min-h-[340px] flex-col rounded-2xl p-5" style={{ background: "var(--cc-panel)" }}>
          {!editable ? (
            <p className="text-[12px]" style={{ color: MUTED }}>Meet &amp; Greet completed.</p>
          ) : capturing ? (
            <p className="flex items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
              <Check size={13} style={{ color: "var(--cc-status-success)" }} />
              {consentBy} consented ({method})
            </p>
          ) : (
            <div
              className="rounded-xl border px-3 py-2.5 transition-shadow"
              style={{
                background: "var(--cc-surface)",
                borderColor: needsConsent ? PINK : BORDER,
                boxShadow: needsConsent ? "0 0 0 3px var(--cc-plum-ring)" : undefined,
              }}
            >
              <label className="flex cursor-pointer items-center gap-2.5 text-[13px]" style={{ color: TEXT }}>
                <input
                  ref={consentRef}
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--cc-plum)]"
                  checked={consented}
                  disabled={busy}
                  onChange={(e) => {
                    setConsented(e.target.checked);
                    if (e.target.checked) setNeedsConsent(false);
                  }}
                />
                {consentBy} consents to recording
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6 text-[11px]" style={{ color: MUTED }}>
                Given by
                <select aria-label="Consent given by" className={selectClass} style={{ borderColor: BORDER }} value={givenBy}
                  disabled={busy} onChange={(e) => setGivenBy(e.target.value as ConsentGivenBy)}>
                  <option value="participant">{firstName}</option>
                  <option value="nominee">Nominee</option>
                  <option value="guardian">Guardian</option>
                </select>
                <select aria-label="Consent method" className={selectClass} style={{ borderColor: BORDER }} value={method}
                  disabled={busy} onChange={(e) => setMethod(e.target.value as ConsentMethod)}>
                  <option value="verbal">Verbal</option>
                  <option value="written">Written</option>
                </select>
              </div>
            </div>
          )}

          {editable && capturing ? (
            <div className="mt-4 flex flex-1 flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] font-bold" style={{ color: TEXT }} aria-live="polite">
                  {recording ? (
                    <span className="relative flex h-2.5 w-2.5">
                      {!paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: PINK }} />}
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: paused ? MUTED : PINK }} />
                    </span>
                  ) : (
                    <Loader2 size={14} className="animate-spin" style={{ color: MUTED }} />
                  )}
                  {recording ? (paused ? "Paused" : "Recording")
                    : phase === "uploading" ? "Saving recording…"
                    : "Writing the full transcript…"}
                </span>
                <span className="text-[15px] font-bold tabular-nums" style={{ color: TEXT }}>{formatElapsed(elapsed)}</span>
              </div>

              {recording && (
                <div className="flex h-7 items-center justify-between gap-[2px]" aria-hidden>
                  {levels.map((level, i) => (
                    <span
                      key={i}
                      className="w-[4px] rounded-full transition-[height] duration-75"
                      style={{
                        height: paused ? "4px" : `${Math.max(4, level * 28)}px`,
                        background: paused ? BORDER : PINK,
                      }}
                    />
                  ))}
                </div>
              )}

              <div
                className="flex min-h-[140px] flex-1 flex-col rounded-xl border px-3.5 py-3"
                style={{ background: "var(--cc-surface)", borderColor: BORDER }}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Live transcript</p>
                <div
                  className="mt-1.5 max-h-[220px] flex-1 overflow-y-auto text-[13px] leading-6"
                  style={{ color: TEXT }}
                  aria-label="Live transcript"
                  aria-live="polite"
                >
                  {liveText && <span>{liveText}</span>}
                  {liveOff ? (
                    <p className="text-[12px]" style={{ color: MUTED }}>
                      Live transcript isn't available right now. The full transcript still goes into your notes when you stop.
                    </p>
                  ) : liveInFlight > 0 ? (
                    <span className="ml-1 inline-flex items-center gap-1 text-[12px]" style={{ color: MUTED }}>
                      <Loader2 size={11} className="animate-spin" /> transcribing
                    </span>
                  ) : !liveText ? (
                    <p className="text-[12px]" style={{ color: MUTED }}>
                      {paused ? "Paused. Nothing is being recorded." : "Listening. Words appear here every few seconds."}
                    </p>
                  ) : null}
                  <div ref={transcriptEndRef} />
                </div>
                {!recording && (
                  <p className="mt-2 text-[11px]" style={{ color: MUTED }}>
                    The full transcript, with who said what, goes into your notes.
                  </p>
                )}
              </div>

              {recording && (
                <div className="flex gap-2">
                  {canPause && (
                    <button
                      type="button"
                      onClick={togglePause}
                      className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[13px] font-semibold"
                      style={{ borderColor: BORDER, color: TEXT, background: "var(--cc-surface)" }}
                    >
                      {paused ? <Play size={14} /> : <Pause size={14} />}
                      {paused ? "Resume" : "Pause"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop recording"
                    className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold text-white"
                    style={{ background: PINK }}
                  >
                    <Square size={12} fill="white" /> Stop and save
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
              {editable && (
                <button
                  type="button"
                  onClick={start}
                  disabled={busy}
                  aria-label="Start recording"
                  title={!consented ? "Confirm consent first" : undefined}
                  className={`flex h-[88px] w-[88px] items-center justify-center rounded-full text-white transition-transform enabled:hover:scale-105 disabled:opacity-40 ${
                    !consented && !busy ? "opacity-60" : ""
                  }`}
                  style={{ background: PINK, boxShadow: "0 10px 24px var(--cc-plum-ring)" }}
                >
                  {busy ? <Loader2 size={30} className="animate-spin" /> : <Mic size={32} />}
                </button>
              )}
              <p className="text-[14px] font-semibold" style={{ color: TEXT }} aria-live="polite">
                {phase === "starting" ? "Starting…"
                  : editable ? (consented ? "Tap to record" : needsConsent ? "Tick consent above first" : "Confirm consent to record")
                  : ""}
              </p>
              {editable && phase === "idle" && (
                <p className="max-w-[260px] text-center text-[12px]" style={{ color: MUTED }}>
                  The conversation is transcribed as you go.
                </p>
              )}
            </div>
          )}

          {intake.meet_greet_recording_url && !capturing && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-semibold" style={{ color: MUTED }}>Saved recording</p>
              <audio controls src={intake.meet_greet_recording_url} className="h-9 w-full" aria-label="Meet & Greet recording" />
            </div>
          )}
        </section>

        {/* Notes */}
        <section className="flex min-h-[340px] flex-col rounded-2xl border p-5" style={{ background: "var(--cc-surface)", borderColor: BORDER }}>
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
