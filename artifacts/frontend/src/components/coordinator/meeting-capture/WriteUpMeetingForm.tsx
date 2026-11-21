import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { appTodayKey } from "@/lib/datetime";
import { recordPlanMeeting, type PlanMeetingType } from "@/services/coordinatorService";
import { INPUT, LABEL, NOTE, PRIMARY_BUTTON, TEXTAREA } from "@/components/participants/recordUi";
import { MEETING_TYPES, firstName } from "./meetingMeta";

const FOOTER = "flex flex-wrap items-center justify-between gap-3 border-t border-cc-border bg-cc-surface px-5 py-3 sm:px-6";

/**
 * A meeting written up by hand: for organisations where recording is off,
 * or when there's no microphone or someone didn't want to be recorded.
 */
export function WriteUpMeetingForm({
  participantId, participantName, voiceOffMessage, onRecordInstead, onSaved,
}: {
  participantId: string;
  participantName: string;
  /** Set when recording is switched off for the organisation. */
  voiceOffMessage: string | null;
  /** Shown when recording is possible. */
  onRecordInstead?: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const first = firstName(participantName);
  const today = appTodayKey();

  const [meetingType, setMeetingType] = useState<PlanMeetingType>("check_in");
  const [date, setDate] = useState(today);
  const [attendees, setAttendees] = useState("");
  const [wants, setWants] = useState("");
  const [agreed, setAgreed] = useState("");
  const [noticed, setNoticed] = useState("");
  const [notes, setNotes] = useState("");

  const hasContent = [wants, agreed, noticed, notes].some((v) => v.trim());

  const save = useMutation({
    mutationFn: () => recordPlanMeeting({
      participant_id: participantId,
      meeting_date: date || today,
      meeting_type: meetingType,
      attendees: attendees.split(",").map((a) => a.trim()).filter(Boolean),
      participant_priorities: wants.trim() || undefined,
      agreed_outcomes: agreed.trim() || undefined,
      coordinator_observations: noticed.trim() || undefined,
      conversation_notes: notes.trim() || undefined,
    }),
    onSuccess: () => {
      toast({ title: "Meeting saved", description: `It's in ${first}'s plan reviews and meetings.` });
      qc.invalidateQueries({ queryKey: ["plan-meetings", participantId] });
      onSaved();
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't save the meeting", description: err?.message ?? "" }),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        {voiceOffMessage && (
          <p className={NOTE}>
            Recording meetings is switched off for your organisation. Your managing director can switch voice recording on
            in Settings, under Privacy. Write the meeting up here instead.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Type of meeting</span>
            <select value={meetingType} onChange={(e) => setMeetingType(e.target.value as PlanMeetingType)} className={`${INPUT} mt-1`}>
              {MEETING_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Date</span>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={`${INPUT} mt-1`} />
          </label>
        </div>

        <div>
          <label htmlFor="meeting-attendees" className={LABEL}>Who was there</label>
          <input
            id="meeting-attendees"
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            placeholder={`For example: ${first}, their mum Sarah, Aisha (support worker)`}
            aria-describedby="meeting-attendees-hint"
            className={`${INPUT} mt-1`}
          />
          <p id="meeting-attendees-hint" className="mt-1 text-sm text-cc-muted">Separate names with commas.</p>
        </div>

        <label className="block">
          <span className={LABEL}>What {first} wants</span>
          <textarea value={wants} onChange={(e) => setWants(e.target.value)} rows={3} className={`${TEXTAREA} mt-1`} placeholder={`In ${first}'s words where you can`} />
        </label>
        <label className="block">
          <span className={LABEL}>What was agreed</span>
          <textarea value={agreed} onChange={(e) => setAgreed(e.target.value)} rows={3} className={`${TEXTAREA} mt-1`} placeholder="Changes to supports, goals, who does what and by when" />
        </label>
        <label className="block">
          <span className={LABEL}>What you noticed</span>
          <textarea value={noticed} onChange={(e) => setNoticed(e.target.value)} rows={2} className={`${TEXTAREA} mt-1`} />
        </label>
        <label className="block">
          <span className={LABEL}>Other notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${TEXTAREA} mt-1`} />
        </label>
      </div>

      <div className={FOOTER}>
        {onRecordInstead ? (
          <button type="button" className="text-sm font-medium text-cc-plum hover:underline" onClick={onRecordInstead}>
            Record it instead
          </button>
        ) : <span />}
        <div className="flex items-center gap-3">
          {!hasContent && <span className="hidden text-sm text-cc-muted sm:inline">Write at least one note</span>}
          <button type="button" className={PRIMARY_BUTTON} disabled={!hasContent || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Save the meeting
          </button>
        </div>
      </div>
    </div>
  );
}
