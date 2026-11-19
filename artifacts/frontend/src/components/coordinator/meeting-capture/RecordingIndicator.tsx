import { Check, Loader2, Pause, Play, Square } from "lucide-react";
import { LevelMeter } from "./LevelMeter";
import { useElapsed, useMeetingRecorder } from "./MeetingRecorderContext";
import { firstName, formatDuration, meetingTypeLabel } from "./meetingMeta";

const BAR =
  "fixed inset-x-3 bottom-20 z-40 flex items-center gap-3 rounded-2xl border border-cc-border bg-cc-surface px-4 py-2.5 shadow-lg " +
  "md:inset-x-auto md:bottom-5 md:right-5 md:w-[34rem] md:rounded-full";
const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cc-border text-cc-text hover:bg-cc-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-plum/40";
const SMALL_PRIMARY =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cc-cta)] px-4 text-sm font-medium text-white hover:opacity-90";

/**
 * Shown on every page while a meeting is being recorded or worked on and its
 * panel is closed: how long it has been recording, Pause and Stop, and Open
 * to bring the panel back. When the suggestions are ready it says so.
 */
export function RecordingIndicator() {
  const rec = useMeetingRecorder();
  const elapsed = useElapsed(rec.clock);
  if (rec.phase === "idle" || rec.panelOpen || !rec.target) return null;

  const who = firstName(rec.target.participantName);
  const what = `${meetingTypeLabel(rec.meetingType)} with ${who}`;

  if (rec.phase === "recording") {
    return (
      <div role="region" aria-label="Meeting recording" className={BAR}>
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${rec.paused ? "bg-cc-muted" : "animate-pulse bg-[color:var(--cc-danger-text,#B91C1C)]"}`}
          aria-hidden
        />
        <button type="button" onClick={rec.openPanel} className="min-w-0 flex-1 text-left" aria-label={`Open the recording: ${what}`}>
          <span className="block whitespace-nowrap text-sm font-medium text-cc-text">
            {rec.paused ? "Paused" : "Recording"} <span className="tabular-nums">{formatDuration(elapsed)}</span>
          </span>
          <span className="block truncate text-sm text-cc-muted">
            {what} · <span className="font-medium text-cc-plum">Open</span>
          </span>
        </button>
        <LevelMeter analyser={rec.analyser} paused={rec.paused} bars={16} className="hidden h-6 w-28 shrink-0 sm:flex" />
        <button type="button" className={ICON_BUTTON} onClick={rec.togglePause} aria-label={rec.paused ? "Resume recording" : "Pause recording"}>
          {rec.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
        </button>
        <button type="button" className={SMALL_PRIMARY} onClick={() => { rec.stop(); }}>
          <Square size={12} className="fill-current" aria-hidden /> Stop
        </button>
      </div>
    );
  }

  const content =
    rec.phase === "processing"
      ? { icon: <Loader2 size={16} className="shrink-0 animate-spin text-cc-muted" aria-hidden />, title: rec.step === "transcript" ? "Writing the transcript" : "Finding goals and tasks", action: "Open" }
      : rec.phase === "failed"
        ? { icon: <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[color:var(--cc-amber)]" aria-hidden />, title: "The meeting needs you", action: "Open" }
        : { icon: <Check size={16} className="shrink-0 text-[color:var(--cc-green)]" aria-hidden />, title: "Suggestions ready to review", action: "Review" };

  return (
    <div role="region" aria-label="Meeting recording" aria-live="polite" className={BAR}>
      {content.icon}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-cc-text">{content.title}</span>
        <span className="block truncate text-sm text-cc-muted">{what}</span>
      </span>
      <button type="button" className={SMALL_PRIMARY} onClick={rec.openPanel}>{content.action}</button>
    </div>
  );
}
