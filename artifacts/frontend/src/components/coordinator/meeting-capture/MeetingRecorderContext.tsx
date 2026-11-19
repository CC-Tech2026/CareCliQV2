import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { appTodayKey } from "@/lib/datetime";
import {
  createMeetingSession,
  extractGoalsAndTasks,
  transcribeAndResolveNames,
  type ConsentGivenBy,
  type ConsentMethod,
  type PlanMeetingType,
  type Stage1ResolutionResult,
  type Stage2ExtractionResult,
} from "@/services/coordinatorService";
import { MAX_AUDIO_BYTES } from "./meetingMeta";

/**
 * One meeting recording for the whole app. It lives here, above the pages,
 * so the director can close the panel and keep working (open the
 * participant's details, another tab, another page) while it records. A
 * small bar shows it's still recording from anywhere, and the panel reopens
 * from that bar.
 */

export type RecorderPhase = "idle" | "recording" | "processing" | "failed" | "review";
export type ProcessingStep = "transcript" | "suggestions";
export type MeetingTarget = { participantId: string; participantName: string };
export type StartOptions = { meetingType: PlanMeetingType; givenBy: ConsentGivenBy; method: ConsentMethod };

/** Recorded time, kept as a running total plus when the current stretch began. */
export type RecorderClock = { accumulatedMs: number; runningSince: number | null };

/** Opus at 32 kbit/s keeps about 100 minutes under the 25 MB limit. */
const BITRATE = 32_000;
const WARN_BYTES = MAX_AUDIO_BYTES - 3 * 1024 * 1024;
const STOP_BYTES = MAX_AUDIO_BYTES - 512 * 1024;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return undefined;
}

export function elapsedSeconds(clock: RecorderClock, now = Date.now()): number {
  const running = clock.runningSince != null ? Math.max(0, now - clock.runningSince) : 0;
  return Math.max(0, Math.floor((clock.accumulatedMs + running) / 1000));
}

/** Seconds recorded, ticking while the recording runs. */
export function useElapsed(clock: RecorderClock): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (clock.runningSince == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [clock.runningSince]);
  return elapsedSeconds(clock, clock.runningSince == null ? 0 : Math.max(now, clock.runningSince));
}

interface MeetingRecorderValue {
  phase: RecorderPhase;
  /** Who the panel is for: the meeting in progress, or the one about to start. */
  target: MeetingTarget | null;
  meetingType: PlanMeetingType;
  sessionId: string | null;
  clock: RecorderClock;
  paused: boolean;
  nearLimit: boolean;
  step: ProcessingStep;
  error: string;
  source: "recorded" | "uploaded";
  stage1: Stage1ResolutionResult | null;
  stage2: Stage2ExtractionResult | null;
  hasAudio: boolean;
  analyser: AnalyserNode | null;
  starting: boolean;
  panelOpen: boolean;
  /** Before a meeting starts: record it, or write it up by hand. */
  entry: "record" | "write";
  setEntry: (entry: "record" | "write") => void;
  /** Open the panel for a participant. A meeting already in progress keeps the panel. */
  openRecorder: (target: MeetingTarget) => void;
  openPanel: () => void;
  closePanel: () => void;
  start: (opts: StartOptions) => Promise<void>;
  upload: (file: File, opts: StartOptions) => Promise<void>;
  togglePause: () => void;
  stop: () => void;
  discard: () => void;
  retry: () => void;
  downloadAudio: () => Blob | null;
  /** Done with this meeting: clear it. `keepOpen` starts another for the same person. */
  finish: (keepOpen?: boolean) => void;
}

const MeetingRecorderContext = createContext<MeetingRecorderValue | null>(null);

export function useMeetingRecorder(): MeetingRecorderValue {
  const ctx = useContext(MeetingRecorderContext);
  if (!ctx) throw new Error("useMeetingRecorder must be used inside MeetingRecorderProvider");
  return ctx;
}

/** For places that may render outside the provider (tests, previews). */
export function useOptionalMeetingRecorder(): MeetingRecorderValue | null {
  return useContext(MeetingRecorderContext);
}

export function MeetingRecorderProvider({ children, renderChrome }: {
  children: ReactNode;
  /** The panel and the "still recording" bar, given the recorder. */
  renderChrome?: () => ReactNode;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [target, setTarget] = useState<MeetingTarget | null>(null);
  const [meetingType, setMeetingType] = useState<PlanMeetingType>("check_in");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clock, setClock] = useState<RecorderClock>({ accumulatedMs: 0, runningSince: null });
  const [paused, setPaused] = useState(false);
  const [nearLimit, setNearLimit] = useState(false);
  const [step, setStep] = useState<ProcessingStep>("transcript");
  const [error, setError] = useState("");
  const [source, setSource] = useState<"recorded" | "uploaded">("recorded");
  const [stage1, setStage1] = useState<Stage1ResolutionResult | null>(null);
  const [stage2, setStage2] = useState<Stage2ExtractionResult | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [starting, setStarting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [entry, setEntry] = useState<"record" | "write">("record");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<Blob | null>(null);
  const stage1Ref = useRef<Stage1ResolutionResult | null>(null);
  const targetRef = useRef<MeetingTarget | null>(null);
  /** Bumped whenever a meeting is dropped, so late answers for it are ignored. */
  const runRef = useRef(0);

  targetRef.current = target;

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAnalyser(null);
  }, []);

  const resetAll = useCallback(() => {
    runRef.current += 1;
    const rec = recorderRef.current;
    if (rec) {
      rec.onstop = null;
      rec.ondataavailable = null;
      if (rec.state !== "inactive") { try { rec.stop(); } catch { /* already stopped */ } }
    }
    recorderRef.current = null;
    releaseMic();
    audioRef.current = null;
    stage1Ref.current = null;
    setHasAudio(false);
    setPhase("idle");
    setSessionId(null);
    setClock({ accumulatedMs: 0, runningSince: null });
    setPaused(false);
    setNearLimit(false);
    setStep("transcript");
    setError("");
    setStage1(null);
    setStage2(null);
    setStarting(false);
  }, [releaseMic]);

  // Signing out drops whatever was in progress.
  useEffect(() => {
    if (!user && phase !== "idle") {
      resetAll();
      setTarget(null);
      setPanelOpen(false);
    }
  }, [user, phase, resetAll]);

  // Leaving the site would lose the recording.
  useEffect(() => {
    if (phase !== "recording" && phase !== "processing" && phase !== "failed") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  useEffect(() => () => { resetAll(); }, [resetAll]);

  const invalidateMeetings = useCallback((participantId: string | undefined) => {
    if (participantId) qc.invalidateQueries({ queryKey: ["plan-meetings", participantId] });
  }, [qc]);

  const process = useCallback(async (audio: Blob, sid: string, from: ProcessingStep) => {
    const run = runRef.current;
    const who = targetRef.current;
    setPhase("processing");
    setError("");
    try {
      if (from === "transcript" || !stage1Ref.current) {
        setStep("transcript");
        const s1 = await transcribeAndResolveNames(sid, audio, "", who?.participantName ?? "", []);
        if (run !== runRef.current) return;
        stage1Ref.current = s1;
        setStage1(s1);
      }
      setStep("suggestions");
      const s2 = await extractGoalsAndTasks(sid);
      if (run !== runRef.current) return;
      invalidateMeetings(who?.participantId);
      setStage2(s2);
      setPhase("review");
    } catch (err) {
      if (run !== runRef.current) return;
      invalidateMeetings(who?.participantId);
      setError(err instanceof Error && err.message ? err.message : "The transcription service didn't answer.");
      setPhase("failed");
    }
  }, [invalidateMeetings]);

  const openSession = useCallback(async (opts: StartOptions): Promise<string> => {
    const who = targetRef.current;
    const session = await createMeetingSession(opts.meetingType, appTodayKey(), undefined, who?.participantId, opts.givenBy, opts.method);
    setSessionId(session.session_id);
    setMeetingType(opts.meetingType);
    return session.session_id;
  }, []);

  const start = useCallback(async (opts: StartOptions) => {
    if (phase !== "idle" || !targetRef.current) return;
    setStarting(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      toast({
        variant: "destructive",
        title: "Couldn't use the microphone",
        description:
          name === "NotAllowedError" ? "Allow the microphone for this site in your browser, then try again."
          : name === "NotFoundError" ? "No microphone was found. Connect one, or upload a recording instead."
          : "The microphone couldn't be started. You can upload a recording instead.",
      });
      setStarting(false);
      return;
    }

    let sid: string;
    try {
      sid = await openSession(opts);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      toast({ variant: "destructive", title: "Couldn't start the meeting", description: err instanceof Error ? err.message : "" });
      setStarting(false);
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITRATE });
    const chunks: Blob[] = [];
    let total = 0;
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      chunks.push(e.data);
      total += e.data.size;
      if (total >= WARN_BYTES) setNearLimit(true);
      if (total >= STOP_BYTES && recorder.state !== "inactive") {
        toast({ title: "Recording stopped at the size limit", description: "Recordings can be up to 25 MB. What was recorded is being transcribed." });
        setClock((c) => ({ accumulatedMs: c.accumulatedMs + (c.runningSince ? Date.now() - c.runningSince : 0), runningSince: null }));
        recorder.stop();
      }
    };
    recorder.onstop = () => {
      releaseMic();
      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      audioRef.current = audio;
      setHasAudio(true);
      void process(audio, sid, "transcript");
    };
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start(5000);

    // A live level, so it's plain the microphone is picking people up.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      try {
        const ctx = new Ctx();
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(node);
        audioCtxRef.current = ctx;
        setAnalyser(node);
      } catch {
        // No level meter on this browser; recording still works.
      }
    }

    runRef.current += 1;
    setSource("recorded");
    setPaused(false);
    setNearLimit(false);
    setClock({ accumulatedMs: 0, runningSince: Date.now() });
    setPhase("recording");
    setStarting(false);
  }, [phase, openSession, process, releaseMic, toast]);

  const upload = useCallback(async (file: File, opts: StartOptions) => {
    if (phase !== "idle" || !targetRef.current) return;
    setStarting(true);
    let sid: string;
    try {
      sid = await openSession(opts);
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't start the meeting", description: err instanceof Error ? err.message : "" });
      setStarting(false);
      return;
    }
    setStarting(false);
    audioRef.current = file;
    setHasAudio(true);
    setSource("uploaded");
    runRef.current += 1;
    void process(file, sid, "transcript");
  }, [phase, openSession, process, toast]);

  const togglePause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      if (rec.state === "paused") {
        rec.resume();
        setPaused(false);
        setClock((c) => ({ ...c, runningSince: Date.now() }));
      } else if (rec.state === "recording") {
        rec.pause();
        setPaused(true);
        setClock((c) => ({ accumulatedMs: c.accumulatedMs + (c.runningSince ? Date.now() - c.runningSince : 0), runningSince: null }));
      }
    } catch {
      // Pausing isn't supported on this browser.
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    setClock((c) => ({ accumulatedMs: c.accumulatedMs + (c.runningSince ? Date.now() - c.runningSince : 0), runningSince: null }));
    setStep("transcript");
    setPhase("processing");
    rec.stop();
  }, []);

  const discard = useCallback(() => {
    const who = targetRef.current;
    resetAll();
    invalidateMeetings(who?.participantId);
  }, [resetAll, invalidateMeetings]);

  const retry = useCallback(() => {
    const audio = audioRef.current;
    if (audio && sessionId) void process(audio, sessionId, stage1Ref.current ? "suggestions" : "transcript");
  }, [process, sessionId]);

  const finish = useCallback((keepOpen = false) => {
    resetAll();
    if (!keepOpen) {
      setPanelOpen(false);
      setTarget(null);
    }
  }, [resetAll]);

  const openRecorder = useCallback((t: MeetingTarget) => {
    if (phase === "idle") {
      setTarget(t);
      setEntry("record");
    }
    setPanelOpen(true);
  }, [phase]);
  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    if (phase === "idle") setTarget(null);
  }, [phase]);

  const value = useMemo<MeetingRecorderValue>(() => ({
    phase, target, meetingType, sessionId, clock, paused, nearLimit, step, error, source, stage1, stage2,
    hasAudio, analyser, starting, panelOpen, entry, setEntry,
    openRecorder, openPanel, closePanel, start, upload, togglePause, stop, discard, retry,
    downloadAudio: () => audioRef.current,
    finish,
  }), [
    phase, target, meetingType, sessionId, clock, paused, nearLimit, step, error, source, stage1, stage2,
    hasAudio, analyser, starting, panelOpen, entry, setEntry,
    openRecorder, openPanel, closePanel, start, upload, togglePause, stop, discard, retry, finish,
  ]);

  return (
    <MeetingRecorderContext.Provider value={value}>
      {children}
      {renderChrome?.()}
    </MeetingRecorderContext.Provider>
  );
}
