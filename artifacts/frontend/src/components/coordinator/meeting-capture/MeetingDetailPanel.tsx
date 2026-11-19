import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { extractGoalsAndTasks, getPlanMeeting, type PlanMeetingDetail } from "@/services/coordinatorService";
import { PRIMARY_BUTTON } from "@/components/participants/recordUi";
import { MeetingSuggestionsReview } from "./MeetingSuggestionsReview";
import { MeetingTranscript } from "./MeetingTranscript";
import { firstName, formatMeetingDate, goalAreaLabel, meetingTypeLabel } from "./meetingMeta";

function consentLine(m: PlanMeetingDetail, first: string): string {
  if (!m.consent_method) return "";
  const who = m.consent_given_by === "nominee" ? `${first}'s nominee` : m.consent_given_by === "guardian" ? `${first}'s guardian` : first;
  return `${m.consent_method === "written" ? "Written" : "Verbal"} consent from ${who}`;
}

/** A past meeting in a side panel: its transcript, and either what was added
 * to the plan or the suggestions still waiting to be added. */
export function MeetingDetailPanel({
  meetingId, participantId, participantName, onApplied,
}: { meetingId: string; participantId: string; participantName: string; onApplied: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const first = firstName(participantName);
  const [view, setView] = useState<"found" | "transcript">("found");

  const query = useQuery({
    queryKey: ["plan-meeting-detail", meetingId],
    queryFn: () => getPlanMeeting(meetingId),
    select: (d) => d.meeting,
  });
  const m = query.data;

  const findAgain = useMutation({
    mutationFn: () => extractGoalsAndTasks(meetingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-meeting-detail", meetingId] });
      qc.invalidateQueries({ queryKey: ["plan-meetings", participantId] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't find goals and tasks", description: err?.message ?? "" }),
  });

  const title = m ? meetingTypeLabel(m.meeting_type) : "Meeting";
  const subtitle = m ? [formatMeetingDate(m.meeting_date), consentLine(m, first)].filter(Boolean).join(" · ") : "";

  const header = (
    <SheetHeader className="border-b border-cc-border p-5 pr-12 text-left sm:px-6">
      <SheetTitle>{title} with {participantName}</SheetTitle>
      <SheetDescription>{subtitle || "Loading the meeting"}</SheetDescription>
    </SheetHeader>
  );

  if (query.isLoading) {
    return (
      <>
        {header}
        <div className="flex flex-1 items-center justify-center py-12"><Loader2 className="animate-spin text-cc-muted" aria-label="Loading" /></div>
      </>
    );
  }
  if (query.isError || !m) {
    return (
      <>
        {header}
        <p className="px-6 py-6 text-sm text-cc-muted">This meeting couldn't be loaded. Close the panel and try again.</p>
      </>
    );
  }

  // Meetings written up as notes, before recording existed.
  if (m.source === "legacy") {
    const notes = ([
      ["Who was there", (m.attendees ?? []).join(", ")],
      [`What ${first} wants`, m.participant_priorities],
      ["What was agreed", m.agreed_outcomes],
      ["What was noticed", m.coordinator_observations],
      ["Other notes", m.conversation_notes],
    ] as const).filter(([, v]) => !!v);
    return (
      <>
        {header}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {notes.length === 0 ? (
            <p className="text-sm text-cc-muted">No notes were written for this meeting.</p>
          ) : (
            <dl className="divide-y divide-cc-border">
              {notes.map(([label, value]) => (
                <div key={label} className="py-3 first:pt-0">
                  <dt className="text-sm text-cc-muted">{label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-cc-text">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </>
    );
  }

  const goals = m.extracted_goals ?? [];
  const tasks = m.extracted_tasks ?? [];
  const clean = m.clean_transcript ?? [];
  const raw = m.raw_transcript ?? [];
  const noSuggestionsYet = goals.length === 0 && tasks.length === 0 && m.stage_2_status !== "complete";

  if (m.suggestions_status !== "applied" && clean.length > 0 && !noSuggestionsYet) {
    return (
      <>
        {header}
        <MeetingSuggestionsReview
          sessionId={m.id}
          participantId={participantId}
          participantName={participantName}
          meetingLabel={meetingTypeLabel(m.meeting_type)}
          goals={goals}
          tasks={tasks}
          cleanTranscript={clean}
          rawTranscript={raw}
          notes={(m.attention_flags ?? []).map((f) => f.description).filter(Boolean)}
          intro={`Nothing from this meeting has been added to ${first}'s plan yet. Tick what to add.`}
          onApplied={onApplied}
        />
      </>
    );
  }

  const applied = m.suggestions_status === "applied";
  return (
    <>
      {header}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
        {applied && (
          <p className="text-sm text-cc-muted">
            Added to {first}'s plan{m.reviewed_at ? ` on ${formatMeetingDate(m.reviewed_at)}` : ""}. The goals and tasks below were found in the conversation.
          </p>
        )}
        {noSuggestionsYet && clean.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-[color:var(--cc-amber)] pl-3">
            <p className="text-sm text-cc-text">Goals and tasks haven't been found for this meeting yet.</p>
            <button type="button" className={PRIMARY_BUTTON} disabled={findAgain.isPending} onClick={() => findAgain.mutate()}>
              {findAgain.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Find goals and tasks
            </button>
          </div>
        )}

        <div role="tablist" aria-label="Meeting" className="flex gap-6 border-b border-cc-border">
          {([["found", "What was found"], ["transcript", "Transcript"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium ${view === key ? "border-cc-plum text-cc-text" : "border-transparent text-cc-muted hover:text-cc-text"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "transcript" ? (
          <MeetingTranscript cleanTranscript={clean} rawTranscript={raw} />
        ) : goals.length === 0 && tasks.length === 0 ? (
          <p className="py-2 text-sm text-cc-muted">No goals or tasks were found in this meeting.</p>
        ) : (
          <div className="space-y-4">
            {goals.length > 0 && (
              <section aria-label="Goals">
                <h3 className="text-sm font-semibold text-cc-text">Goals</h3>
                <ul className="divide-y divide-cc-border">
                  {goals.map((g, i) => (
                    <li key={i} className="py-3">
                      <p className="text-sm text-cc-text">{g.goal_text}</p>
                      {g.support_category && <p className="mt-0.5 text-sm text-cc-muted">{goalAreaLabel(g.support_category)}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {tasks.length > 0 && (
              <section aria-label="Tasks for support workers" className="border-t border-cc-border pt-4">
                <h3 className="text-sm font-semibold text-cc-text">Tasks for support workers</h3>
                <ul className="divide-y divide-cc-border">
                  {tasks.map((t, i) => (
                    <li key={i} className="py-3">
                      <p className="text-sm text-cc-text">{t.task_text}</p>
                      <p className="mt-0.5 text-sm text-cc-muted">{t.requirement_level === "mandatory" ? "On every shift" : "When it fits"}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
