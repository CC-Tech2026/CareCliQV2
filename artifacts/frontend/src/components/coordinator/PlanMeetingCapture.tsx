import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, Mic, Pencil } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { listPlanMeetings, type PlanMeeting } from "@/services/coordinatorService";
import { INPUT, PRIMARY_BUTTON } from "@/components/participants/recordUi";
import { MeetingDetailPanel } from "./meeting-capture/MeetingDetailPanel";
import { useElapsed, useOptionalMeetingRecorder } from "./meeting-capture/MeetingRecorderContext";
import { MEETING_PANEL as PANEL } from "./meeting-capture/MeetingRecorderRoot";
import { useMeetingVoiceAccess } from "./meeting-capture/RecordMeetingPanel";
import { firstName, formatDuration, formatMeetingDate, meetingTypeLabel } from "./meeting-capture/meetingMeta";

function statusOf(m: PlanMeeting): { label: string; tone: "amber" | "green" | "muted" } {
  if (m.suggestions_status === "applied") return { label: "Added to the plan", tone: "green" };
  if (m.suggestions_status === "reviewed") return { label: "Reviewed", tone: "muted" };
  if (m.source === "legacy" && !m.ai_generated_at) return { label: "Notes", tone: "muted" };
  return { label: "Suggestions to review", tone: "amber" };
}

const TONE = {
  amber: "text-[color:var(--cc-amber)]",
  green: "text-[color:var(--cc-green)]",
  muted: "text-cc-muted",
} as const;

interface PlanMeetingCaptureProps {
  participantId: string;
  participantName: string;
}

/**
 * Plan reviews and meetings for one participant: the list of past meetings,
 * and Record a meeting. The recorder belongs to the whole app, so a meeting
 * keeps recording while the director looks around; each past meeting opens
 * in a side panel, so the list stays where it is.
 */
export function PlanMeetingCapture({ participantId, participantName }: PlanMeetingCaptureProps) {
  const rec = useOptionalMeetingRecorder();
  const elapsed = useElapsed(rec?.clock ?? { accumulatedMs: 0, runningSince: null });
  const voice = useMeetingVoiceAccess();
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const meetingsQuery = useQuery({
    queryKey: ["plan-meetings", participantId, dateFrom, dateTo],
    queryFn: () => listPlanMeetings(participantId, { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    select: (d) => d.meetings,
  });

  const active = rec && rec.phase !== "idle" ? rec : null;
  const activeHere = !!active && active.target?.participantId === participantId;
  const activeElsewhere = !!active && !activeHere;

  const meetings = meetingsQuery.data ?? [];
  const hasFilter = !!(dateFrom || dateTo);
  const clearFilter = () => { setDateFrom(""); setDateTo(""); };
  const waiting = meetings.filter((m) => statusOf(m).tone === "amber").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-cc-text">
            Plan reviews and meetings
            {meetings.length > 0 && <span className="ml-2 text-sm font-normal tabular-nums text-cc-muted">{meetings.length}</span>}
          </h3>
          <p className="mt-0.5 max-w-2xl text-sm text-cc-muted">
            {voice.off
              ? <>Write up each plan review, check-in or goal review with {firstName(participantName)}: who was there, what they want and what was agreed.</>
              : <>Record a plan review, check-in or goal review with {firstName(participantName)}. You get a transcript, and goals
                and tasks are suggested from what was said for you to add to the plan.</>}
          </p>
        </div>
        {rec && (
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={activeElsewhere || voice.isLoading}
            onClick={() => rec.openRecorder({ participantId, participantName })}
          >
            {voice.off
              ? <><Pencil size={15} aria-hidden /> Write up a meeting</>
              : <><Mic size={15} aria-hidden /> {activeHere ? "Open the recording" : "Record a meeting"}</>}
          </button>
        )}
      </div>

      {activeHere && active && (
        <p className="border-l-4 border-[color:var(--cc-danger-text,#B91C1C)] pl-3 text-sm text-cc-text" role="status">
          {active.phase === "recording"
            ? <>{active.paused ? "Paused" : "Recording now"}: {meetingTypeLabel(active.meetingType)}, <span className="tabular-nums">{formatDuration(elapsed)}</span></>
            : active.phase === "review" ? <>Suggestions are ready from the {meetingTypeLabel(active.meetingType).toLowerCase()} just recorded.</>
            : active.phase === "failed" ? <>The meeting just recorded needs you.</>
            : <>Working on the meeting just recorded.</>}
          {" "}<button type="button" className="font-medium text-cc-plum hover:underline" onClick={() => active.openPanel()}>Open</button>
        </p>
      )}
      {activeElsewhere && active?.target && (
        <p className="border-l-4 border-cc-border pl-3 text-sm text-cc-muted">
          A meeting with {active.target.participantName} is being recorded. Finish it before recording another.
        </p>
      )}

      {waiting > 0 && (
        <p className="border-l-4 border-[color:var(--cc-amber)] pl-3 text-sm text-cc-text">
          {waiting === 1 ? "1 meeting has" : `${waiting} meetings have`} suggestions that haven't been added to the plan yet.
        </p>
      )}

      {(meetings.length > 5 || hasFilter) && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-cc-muted">
            From
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${INPUT} mt-1 w-auto`} />
          </label>
          <label className="text-sm text-cc-muted">
            To
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${INPUT} mt-1 w-auto`} />
          </label>
          {hasFilter && (
            <button type="button" onClick={clearFilter} className="min-h-10 text-sm font-medium text-cc-plum hover:underline">
              Clear dates
            </button>
          )}
        </div>
      )}

      {meetingsQuery.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-cc-muted" aria-label="Loading meetings" /></div>
      ) : meetingsQuery.isError ? (
        <p className="py-4 text-sm text-cc-muted">Meetings couldn't be loaded. Refresh the page to try again.</p>
      ) : meetings.length === 0 ? (
        <div className="border-y border-cc-border py-8 text-center">
          {hasFilter ? (
            <>
              <p className="text-sm font-medium text-cc-text">No meetings in these dates</p>
              <button type="button" onClick={clearFilter} className="mt-1 min-h-10 text-sm font-medium text-cc-plum hover:underline">
                Show every meeting
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-cc-text">No plan reviews or meetings recorded yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-cc-muted">
                The next plan review or check-in with {firstName(participantName)} and their family is a good one to record.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-cc-border border-y border-cc-border">
          {meetings.map((m) => {
            const status = statusOf(m);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenMeetingId(m.id)}
                  className="flex w-full items-center gap-4 px-1 py-3 text-left transition-colors hover:bg-cc-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-plum/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-cc-text">{meetingTypeLabel(m.meeting_type)}</span>
                    <span className="block text-sm text-cc-muted">
                      {formatMeetingDate(m.meeting_date)} · {m.source === "legacy" ? "Written notes" : "Recorded"}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm ${TONE[status.tone]}`}>{status.label}</span>
                  <ChevronRight size={16} className="shrink-0 text-cc-muted" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!openMeetingId} onOpenChange={(open) => { if (!open) setOpenMeetingId(null); }}>
        <SheetContent className={PANEL}>
          {openMeetingId && (
            <MeetingDetailPanel
              key={openMeetingId}
              meetingId={openMeetingId}
              participantId={participantId}
              participantName={participantName}
              onApplied={() => setOpenMeetingId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
