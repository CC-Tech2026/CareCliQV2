export type ParticipantMood = "happy" | "calm" | "anxious" | "agitated" | "sad" | "tired";

export type LongShiftCheckinStatus = "GOING_WELL" | "NEEDS_ATTENTION" | "INCIDENT_REPORTED";

export type LongShiftCheckInFormData = {
  mood: ParticipantMood;
  hasIncident: boolean;
};

export const MOOD_OPTIONS: ReadonlyArray<{
  id: ParticipantMood;
  label: string;
  emoji: string;
}> = [
  { id: "happy", label: "Happy", emoji: "😊" },
  { id: "calm", label: "Calm", emoji: "😌" },
  { id: "anxious", label: "Anxious", emoji: "😟" },
  { id: "agitated", label: "Agitated", emoji: "😠" },
  { id: "sad", label: "Sad", emoji: "😢" },
  { id: "tired", label: "Tired", emoji: "😴" },
] as const;

const MOOD_BY_ID = new Map(MOOD_OPTIONS.map((m) => [m.id, m]));

export function moodLabel(mood: ParticipantMood): string {
  return MOOD_BY_ID.get(mood)?.label ?? mood;
}

export function moodEmoji(mood: ParticipantMood): string {
  return MOOD_BY_ID.get(mood)?.emoji ?? "";
}

export function mapLongShiftCheckinStatus(data: LongShiftCheckInFormData): LongShiftCheckinStatus {
  if (data.hasIncident) return "INCIDENT_REPORTED";
  if (data.mood === "anxious" || data.mood === "agitated" || data.mood === "sad" || data.mood === "tired") {
    return "NEEDS_ATTENTION";
  }
  return "GOING_WELL";
}

export function buildLongShiftCheckinNote(data: LongShiftCheckInFormData): string {
  const label = moodLabel(data.mood);
  const emoji = moodEmoji(data.mood);
  const incidentLine = data.hasIncident
    ? "Incident reported — please complete an incident report."
    : "No incidents to report.";
  return `90-minute check-in completed. Participant mood: ${label} ${emoji} ${incidentLine}`;
}

export function isCheckinSessionNote(note: { note_type?: string; content?: string }): boolean {
  if (note.note_type === "check-in") return true;
  return /^90-minute check-in completed\./i.test((note.content ?? "").trim());
}
