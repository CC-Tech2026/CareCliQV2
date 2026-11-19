import type { PlanMeetingType } from "@/services/coordinatorService";

/** Meeting types in the words NDIS providers use, with a line on when each fits. */
export const MEETING_TYPES: { value: PlanMeetingType; label: string; hint: string }[] = [
  { value: "check_in", label: "Check-in", hint: "A regular catch-up on how supports are going" },
  { value: "plan_review", label: "Plan review", hint: "Before or after the NDIS reviews the plan" },
  { value: "goal_review", label: "Goal review", hint: "Progress against the participant's goals" },
  { value: "initial_setup", label: "Service start-up", hint: "Setting up supports with a new participant" },
  { value: "incident_followup", label: "Incident follow-up", hint: "Agreeing on changes after an incident" },
  { value: "meet_greet", label: "Meet and greet", hint: "A first meeting with a support worker" },
];

export function meetingTypeLabel(type: string | null | undefined): string {
  return MEETING_TYPES.find((m) => m.value === type)?.label ?? "Meeting";
}

/** The goal areas the meeting assistant files goals under, named as the NDIS
 * outcome domains are. Anything else is shown as plain words. */
const GOAL_AREAS: Record<string, string> = {
  employment: "Work",
  community_participation: "Social and community participation",
  independence_daily_living: "Daily living",
  health_wellbeing: "Health and wellbeing",
  relationships_social: "Relationships",
  education_training: "Lifelong learning",
  assistive_technology: "Assistive technology",
  accommodation: "Home",
  respite_care: "Short-term accommodation",
  transport: "Transport",
};

export function goalAreaLabel(value: string | null | undefined): string {
  if (!value) return "";
  const known = GOAL_AREAS[value.trim().toLowerCase()];
  if (known) return known;
  const words = value.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How sure the assistant was that this was said, in plain words. */
export function matchLabel(confidence: number): { label: string; check: boolean } {
  if (confidence >= 0.85) return { label: "Clearly said", check: false };
  if (confidence >= 0.6) return { label: "Probably said", check: false };
  return { label: "Check the transcript", check: true };
}

export function formatMeetingDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const date = d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  if (!/T\d{2}:\d{2}/.test(value)) return date;
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
  return `${date}, ${time}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function durationInWords(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

/** Whisper and the backend both cap a recording at 25 MB. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
