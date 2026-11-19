import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Mic, Pause, Play, Square, Upload } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { downloadBlob } from "@/lib/download-file";
import { appTodayKey } from "@/lib/datetime";
import { getMeetingVoiceAccess, type ConsentGivenBy, type ConsentMethod, type PlanMeetingType } from "@/services/coordinatorService";
import { HELP, NOTE, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/participants/recordUi";
import { MeetingSuggestionsReview } from "./MeetingSuggestionsReview";
import { LevelMeter } from "./LevelMeter";
import { WriteUpMeetingForm } from "./WriteUpMeetingForm";
import { useElapsed, useMeetingRecorder } from "./MeetingRecorderContext";
import {
  MAX_AUDIO_BYTES, MEETING_TYPES, durationInWords, firstName, formatDuration, meetingTypeLabel,
} from "./meetingMeta";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SELECTED = "border-cc-plum bg-cc-plum/5 ring-1 ring-cc-plum";
const UNSELECTED = "border-cc-border bg-cc-surface hover:bg-cc-soft";

function Choice({
  name, value, checked, onChange, label, hint,
}: { name: string; value: string; checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-cc-plum/40 ${checked ? SELECTED : UNSELECTED}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1 h-4 w-4 shrink-0 accent-[var(--cc-cta)]" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-cc-text">{label}</span>
        {hint && <span className="block text-sm text-cc-muted">{hint}</span>}
      </span>
    </label>
  );
}

const FOOTER = "flex flex-wrap items-center justify-between gap-3 border-t border-cc-border bg-cc-surface px-5 py-3 sm:px-6";

/**
 * The meeting recorder's panel: say what kind of meeting it is and confirm
 * consent, record (or upload a recording), then tick what to add to the
 * plan. The recording itself belongs to the app, not this panel, so the
 * panel can be closed while it records.
 */
export function RecordMeetingPanel() {
  const rec = useMeetingRecorder();
  const target = rec.target;
  const first = firstName(target?.participantName ?? "");

  const [meetingType, setMeetingType] = useState<PlanMeetingType>("check_in");
  const [givenBy, setGivenBy] = useState<ConsentGivenBy>("participant");
  const [method, setMethod] = useState<ConsentMethod>("verbal");
  const [consented, setConsented] = useState(false);
  const [noMic, setNoMic] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const elapsed = useElapsed(rec.clock);
  const voice = useMeetingVoiceAccess();
  const label = meetingTypeLabel(rec.phase === "idle" ? meetingType : rec.meetingType);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") setNoMic(true);
  }, []);
  useEffect(() => {
    if (rec.phase === "idle") setConsented(false);
    setConfirmDiscard(false);
  }, [rec.phase]);

  if (!target) return null;

  const steps = ["Before you start", "Record", "Check what was found"];
  const stepIndex = rec.phase === "idle" ? 0 : rec.phase === "recording" ? 1 : 2;
  const stepper = (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-cc-border px-5 py-3 text-sm sm:px-6" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          {i > 0 && <span className="text-cc-border" aria-hidden>/</span>}
          <span className={i === stepIndex ? "font-medium text-cc-text" : "text-cc-muted"} aria-current={i === stepIndex ? "step" : undefined}>
            {i + 1}. {s}
          </span>
        </li>
      ))}
    </ol>
  );

  const opts = { meetingType, givenBy, method };

  if (rec.phase === "idle" && voice.isLoading) {
    return <div className="flex flex-1 items-center justify-center py-12"><Loader2 className="animate-spin text-cc-muted" aria-label="Loading" /></div>;
  }

  if (rec.phase === "idle" && (voice.off || rec.entry === "write")) {
    return (
      <WriteUpMeetingForm
        participantId={target.participantId}
        participantName={target.participantName}
        voiceOffMessage={voice.off ? voice.message : null}
        onRecordInstead={voice.off ? undefined : () => rec.setEntry("record")}
        onSaved={() => rec.finish()}
      />
    );
  }

  if (rec.phase === "idle") {
    const who = givenBy === "participant" ? first : givenBy === "nominee" ? `${first}'s nominee` : `${first}'s guardian`;
    const pickFile = (file: File | undefined) => {
      setUploadError(null);
      if (!file) return;
      if (file.size > MAX_AUDIO_BYTES) {
        setUploadError(`${file.name} is ${mb(file.size)}. Recordings can be up to 25 MB, so shorten it or save it at a lower quality.`);
        return;
      }
      void rec.upload(file, opts);
    };
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {stepper}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <fieldset>
            <legend className="text-sm font-semibold text-cc-text">Type of meeting</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {MEETING_TYPES.map((m) => (
                <Choice key={m.value} name="meeting-type" value={m.value} checked={meetingType === m.value} onChange={() => setMeetingType(m.value)} label={m.label} hint={m.hint} />
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-cc-text">Consent to record</legend>
            <p className={HELP}>Tell everyone in the meeting it will be recorded, and ask before you start.</p>
            <div>
              <p className="text-sm font-medium text-cc-text">Who agreed</p>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                <Choice name="consent-by" value="participant" checked={givenBy === "participant"} onChange={() => setGivenBy("participant")} label={first} hint="The participant" />
                <Choice name="consent-by" value="nominee" checked={givenBy === "nominee"} onChange={() => setGivenBy("nominee")} label="Their nominee" />
                <Choice name="consent-by" value="guardian" checked={givenBy === "guardian"} onChange={() => setGivenBy("guardian")} label="Their guardian" />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-cc-text">How</p>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                <Choice name="consent-how" value="verbal" checked={method === "verbal"} onChange={() => setMethod("verbal")} label="Said yes" hint="Verbal consent" />
                <Choice name="consent-how" value="written" checked={method === "written"} onChange={() => setMethod("written")} label="Signed a form" hint="Written consent" />
              </div>
            </div>
            <label htmlFor="meeting-consent" className="flex cursor-pointer items-start gap-3 pt-1">
              <Checkbox
                id="meeting-consent"
                checked={consented}
                onCheckedChange={(v) => setConsented(v === true)}
                className="mt-0.5 h-5 w-5 rounded border-cc-muted data-[state=checked]:border-[var(--cc-cta)] data-[state=checked]:bg-[var(--cc-cta)] data-[state=checked]:text-white"
              />
              <span className="text-sm text-cc-text">
                Everyone has been told this meeting will be recorded, and {who} gave {method} consent.
              </span>
            </label>
          </fieldset>

          <p className={NOTE}>
            Once it's recording you can close this panel and keep working: open {first}'s details, another section or
            another page. A bar at the bottom of the screen shows it's still recording.
          </p>
          <p className={NOTE}>
            The audio is sent for transcription and isn't kept; only the transcript is saved with the meeting. Goals and
            tasks are then suggested from it, and nothing is added to {first}'s plan until you choose.
          </p>
          {noMic && (
            <p className="border-l-4 border-[color:var(--cc-amber)] pl-3 text-sm text-cc-text">
              This browser can't record here. Upload a recording made on a phone or another device instead.
            </p>
          )}
          {uploadError && <p role="alert" className="border-l-4 border-[color:var(--cc-amber)] pl-3 text-sm text-cc-text">{uploadError}</p>}
        </div>

        <div className={FOOTER}>
          <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="text-sm font-medium text-cc-plum hover:underline" onClick={() => rec.setEntry("write")}>
            Write it up instead
          </button>
          <label className={`${SECONDARY_BUTTON} ${!consented || rec.starting ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            <Upload size={15} aria-hidden /> Upload a recording
            <input
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.webm,.mp4,.mpga,.mpeg,.ogg"
              className="sr-only"
              disabled={!consented || rec.starting}
              onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }}
            />
          </label>
          </div>
          <div className="flex items-center gap-3">
            {!consented && <span className="hidden text-sm text-cc-muted sm:inline">Confirm consent to start</span>}
            <button type="button" className={PRIMARY_BUTTON} disabled={!consented || rec.starting || noMic} onClick={() => void rec.start(opts)}>
              {rec.starting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Mic size={15} aria-hidden />}
              Start recording
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (rec.phase === "recording") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {stepper}
        <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-5 py-8 text-center sm:px-6">
          <p className="flex items-center gap-2 text-sm font-medium text-cc-text" role="status">
            <span className={`h-2.5 w-2.5 rounded-full ${rec.paused ? "bg-cc-muted" : "animate-pulse bg-[color:var(--cc-danger-text,#B91C1C)]"}`} aria-hidden />
            {rec.paused ? "Paused" : "Recording"} · {label} with {first}
          </p>
          <p className="text-5xl font-light tabular-nums text-cc-text" aria-label={`Recorded ${durationInWords(elapsed)}`}>
            {formatDuration(elapsed)}
          </p>
          <LevelMeter analyser={rec.analyser} paused={rec.paused} />
          <p className="max-w-sm text-sm text-cc-muted">
            Keep the device near whoever is speaking. Pause if the conversation goes off the record.
          </p>
          <p className="max-w-sm text-sm text-cc-muted">
            You can close this panel to look something up. It keeps recording, and the bar at the bottom of the screen brings you back.
          </p>
          {rec.nearLimit && (
            <p className="max-w-sm border-l-4 border-[color:var(--cc-amber)] pl-3 text-left text-sm text-cc-text">
              This recording is nearly at the 25 MB limit. It will stop by itself when it gets there.
            </p>
          )}
        </div>
        <div className={FOOTER}>
          {confirmDiscard ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-cc-text">Discard this recording?</span>
              <button type="button" className="font-medium text-[color:var(--cc-danger-text,#B91C1C)] hover:underline" onClick={() => rec.discard()}>Discard</button>
              <button type="button" className="font-medium text-cc-plum hover:underline" onClick={() => setConfirmDiscard(false)}>Keep recording</button>
            </div>
          ) : (
            <button type="button" className="text-sm font-medium text-cc-muted hover:underline" onClick={() => setConfirmDiscard(true)}>Discard</button>
          )}
          <div className="flex items-center gap-2">
            <button type="button" className={SECONDARY_BUTTON} onClick={rec.togglePause}>
              {rec.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
              {rec.paused ? "Resume" : "Pause"}
            </button>
            <button type="button" className={PRIMARY_BUTTON} onClick={rec.stop}>
              <Square size={13} className="fill-current" aria-hidden /> Stop and review
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (rec.phase === "processing" || rec.phase === "failed") {
    const failed = rec.phase === "failed";
    const saved = rec.source === "uploaded" ? "Recording uploaded" : `Recording saved, ${durationInWords(elapsed)}`;
    const rows: { key: string; text: string; state: "done" | "active" | "waiting" | "failed" }[] = [
      { key: "saved", text: saved, state: "done" },
      { key: "transcript", text: "Writing the transcript", state: rec.step === "transcript" ? (failed ? "failed" : "active") : "done" },
      { key: "suggestions", text: "Finding goals and tasks", state: rec.step === "suggestions" ? (failed ? "failed" : "active") : "waiting" },
    ];
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {stepper}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-6">
          <ol className="space-y-3" aria-live="polite">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 text-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
                  {r.state === "done" && <Check size={16} className="text-[color:var(--cc-green)]" />}
                  {r.state === "active" && <Loader2 size={16} className="animate-spin text-cc-muted" />}
                  {r.state === "waiting" && <span className="h-2 w-2 rounded-full bg-cc-border" />}
                  {r.state === "failed" && <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--cc-amber)]" />}
                </span>
                <span className={r.state === "waiting" ? "text-cc-muted" : "text-cc-text"}>{r.text}</span>
              </li>
            ))}
          </ol>
          {!failed ? (
            <p className={HELP}>This usually takes under a minute, longer for long meetings. You can close this panel; the bar at the bottom of the screen says when it's ready.</p>
          ) : (
            <div className="border-l-4 border-[color:var(--cc-amber)] pl-3">
              <p className="text-sm font-medium text-cc-text">
                {rec.step === "transcript" ? "The transcript couldn't be written" : "Goals and tasks couldn't be found"}
              </p>
              <p className="mt-0.5 text-sm text-cc-muted">{rec.error}</p>
              <p className="mt-1 text-sm text-cc-muted">The recording is still here. Try again, or download it so it isn't lost.</p>
            </div>
          )}
        </div>
        {failed && (
          <div className={FOOTER}>
            <button type="button" className="text-sm font-medium text-cc-muted hover:underline" onClick={() => rec.finish(true)}>
              Start over
            </button>
            <div className="flex items-center gap-2">
              {rec.hasAudio && (
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  onClick={() => {
                    const a = rec.downloadAudio();
                    if (a) downloadBlob(a, a instanceof File ? a.name : `meeting-${appTodayKey()}.${a.type.includes("mp4") ? "m4a" : "webm"}`);
                  }}
                >
                  Download the recording
                </button>
              )}
              <button type="button" className={PRIMARY_BUTTON} onClick={rec.retry}>Try again</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Review
  const notes = [
    ...(rec.stage1?.flags ?? []).map((f) => f.description),
    ...(rec.stage2?.attention_flags ?? []).map((f) => f.description),
  ].filter(Boolean);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {stepper}
      <MeetingSuggestionsReview
        key={rec.sessionId ?? "review"}
        sessionId={rec.sessionId ?? ""}
        participantId={target.participantId}
        participantName={target.participantName}
        meetingLabel={label}
        goals={rec.stage2?.goals ?? []}
        tasks={rec.stage2?.tasks ?? []}
        cleanTranscript={rec.stage1?.clean_transcript ?? []}
        rawTranscript={rec.stage1?.raw_transcript ?? []}
        notes={notes}
        intro={`${rec.source === "uploaded" ? "From the uploaded recording" : `Recorded for ${durationInWords(elapsed)}`}. The meeting and its transcript are saved. Tick what to add to ${first}'s plan, or come back to it later from Plan reviews & meetings.`}
        onApplied={() => rec.finish()}
        secondaryActions={
          <button type="button" className="text-sm font-medium text-cc-muted hover:underline" onClick={() => rec.finish(true)}>
            Record another
          </button>
        }
      />
    </div>
  );
}

/** Whether this organisation may record meetings. If the check itself fails,
 * recording is offered and the server still refuses audio when voice is off. */
export function useMeetingVoiceAccess(enabled = true) {
  const q = useQuery({ queryKey: ["meeting-voice-access"], queryFn: getMeetingVoiceAccess, staleTime: 5 * 60_000, retry: false, enabled });
  return {
    isLoading: q.isLoading,
    off: q.data?.enabled === false,
    message: q.data?.message ?? null,
  };
}
