import type { MeetingMode, OrgEvent, ParticipantMeetingKind } from "@/services/hubService";

/** What the MD picks in "Meeting type": a participant meeting, or one of the
 *  calendar's own internal event types. */
export type MeetingChoice = ParticipantMeetingKind | "meeting" | "training" | "audit" | "review";

type ChoiceConfig = {
  label: string;
  hint: string;
  group: "participant" | "internal";
  minutes: number;
  /** Recorded with Easy Capture by default when held in person. */
  capture?: boolean;
};

export const MEETING_CHOICES: Record<MeetingChoice, ChoiceConfig> = {
  intake: { label: "Intake / meet and greet", hint: "First meeting with a new participant and their family.", group: "participant", minutes: 60, capture: true },
  service_agreement: { label: "Service agreement", hint: "Go through and sign the service agreement.", group: "participant", minutes: 45 },
  plan_review: { label: "NDIS plan review", hint: "Review supports and budget before the plan is renewed.", group: "participant", minutes: 60, capture: true },
  goal_review: { label: "Goal review", hint: "Check progress on the participant's goals.", group: "participant", minutes: 45, capture: true },
  check_in: { label: "Check-in", hint: "Regular catch-up with the participant or nominee.", group: "participant", minutes: 30 },
  care_team: { label: "Care team meeting", hint: "Family, support coordinator and allied health together.", group: "participant", minutes: 60, capture: true },
  incident_followup: { label: "Incident follow-up", hint: "Talk through an incident and what changes next.", group: "participant", minutes: 30 },
  meeting: { label: "Team meeting", hint: "Staff or management meeting.", group: "internal", minutes: 60 },
  training: { label: "Training", hint: "Staff training session.", group: "internal", minutes: 60 },
  audit: { label: "Audit", hint: "NDIS audit or internal audit.", group: "internal", minutes: 120 },
  review: { label: "Internal review", hint: "Practice or quality review.", group: "internal", minutes: 60 },
};

export function choiceOf(event: Pick<OrgEvent, "event_type" | "meeting_kind">): MeetingChoice {
  return event.meeting_kind ?? event.event_type;
}

export function isParticipantChoice(choice: MeetingChoice): choice is ParticipantMeetingKind {
  return MEETING_CHOICES[choice].group === "participant";
}

type ModeConfig = { label: string; hint: string };

export const MEETING_MODES: Record<MeetingMode, ModeConfig> = {
  in_person: { label: "In person", hint: "Everyone you invite gets a calendar invite by email." },
  phone: { label: "Phone call", hint: "Everyone you invite gets a calendar invite by email." },
  video: {
    label: "Video call",
    hint: "After booking, send the invite from Google Calendar or Outlook: it adds the Meet or Teams link, and the guests are filled in for you.",
  },
};

/** A video call's invite goes out from the organiser's own calendar app,
 *  which creates the Meet or Teams link; the others are emailed by CareCliQ. */
export function isOnlineMode(mode: MeetingMode | null | undefined): boolean {
  return mode === "video";
}

// ── Calendar export ─────────────────────────────────────────────────────────
// The meeting is stored as a local date + "HH:MM", so it's read in the
// browser's own time zone and sent out in UTC.

export function eventStartEnd(event: Pick<OrgEvent, "event_date" | "start_time">, minutes: number) {
  const start = new Date(`${event.event_date.slice(0, 10)}T${event.start_time || "09:00"}:00`);
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function exportDetails(event: OrgEvent): string {
  return [
    event.participant_name ? `Participant: ${event.participant_name}` : "",
    event.participants_desc ?? "",
  ].filter(Boolean).join("\n");
}

function exportLocation(event: OrgEvent): string {
  if (event.meeting_mode === "phone") return event.location ? `Phone call: ${event.location}` : "Phone call";
  if (event.meeting_mode === "video") return "";
  return event.location || "";
}

/** Everyone invited, as email addresses, leaving out the organiser (their own
 *  calendar adds them). */
export function guestEmails(event: Pick<OrgEvent, "attendees">, exclude?: string | null): string[] {
  const skip = exclude?.toLowerCase();
  return (event.attendees ?? []).map((a) => a.email).filter((email) => !!email && email.toLowerCase() !== skip);
}

/** Opens a new Google Calendar event, filled in. With guests it's how a video
 *  call's invite is sent: Google adds the Meet link when it's saved. */
export function googleCalendarUrl(event: OrgEvent, minutes: number, guests: string[] = []): string {
  const { start, end } = eventStartEnd(event, minutes);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    details: exportDetails(event),
    location: exportLocation(event),
  });
  if (guests.length) params.set("add", guests.join(","));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The same in Outlook on the web, where the Teams meeting switch adds the link. */
export function outlookCalendarUrl(event: OrgEvent, minutes: number, guests: string[] = []): string {
  const { start, end } = eventStartEnd(event, minutes);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: exportDetails(event),
    location: exportLocation(event),
  });
  if (guests.length) params.set("to", guests.join(","));
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** A single-event .ics file (Outlook desktop, Apple Calendar, anything else). */
export function icsFile(event: OrgEvent, minutes: number): string {
  const { start, end } = eventStartEnd(event, minutes);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CareCliQ//Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@carecliq`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(exportDetails(event))}`,
    `LOCATION:${icsText(exportLocation(event))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
