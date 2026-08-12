import { PlanMeetingCapture } from "@/components/coordinator/PlanMeetingCapture";

interface ParticipantPlanMeetingsTabProps {
  participantId: string;
  participantName: string;
}

/** "Plan Meetings" facet of the participant Detail archetype — coordinator only. */
export function ParticipantPlanMeetingsTab({ participantId, participantName }: ParticipantPlanMeetingsTabProps) {
  return (
    <section className="space-y-3">
      <PlanMeetingCapture participantId={participantId} participantName={participantName} />
    </section>
  );
}
