import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";

export type HubComplianceAlert = {
  id: string;
  title: string;
  detail: string;
  severity: "critical" | "high" | "medium" | "info" | "positive";
  due_date?: string | null;
  affected_staff?: string[];
  action_label: string;
  source?: string;
  incident_id?: string;
  invoice_id?: string;
  credential_id?: string;
  participant_id?: string;
  shift_id?: string;
  worker_id?: string;
  /** "urgent" = needs action today/this week. "exposure" = builds into a future finding if ignored. */
  category?: "urgent" | "exposure";
};

export type OrgEvent = {
  id: string;
  title: string;
  event_date: string;
  duration: string;
  event_type: "audit" | "training" | "meeting" | "review";
  location?: string | null;
  participants_desc?: string | null;
  /** "HH:MM", 24h. Null on events created before this field existed —
   *  those render in the calendar's all-day strip instead of the hour grid. */
  start_time?: string | null;
  /** Set when the meeting is with a participant (plan review, intake...). */
  participant_id?: string | null;
  participant_name?: string | null;
  meeting_kind?: ParticipantMeetingKind | null;
  meeting_mode?: MeetingMode | null;
  meeting_link?: string | null;
  /** In-person meeting the MD will record with Easy Capture. */
  easy_capture?: boolean;
  /** Who's invited. In-person and phone meetings email them a calendar invite. */
  attendees?: MeetingAttendee[];
  /** When calendar invites last went out; null if none have. */
  invites_sent_at?: string | null;
  invite_sequence?: number;
  organization_id?: string;
  created_by?: string;
  created_at?: string;
};

export type ParticipantMeetingKind =
  | "intake"
  | "service_agreement"
  | "plan_review"
  | "goal_review"
  | "check_in"
  | "care_team"
  | "incident_followup";

export type MeetingMode = "in_person" | "phone" | "video";

export type MeetingAttendee = { email: string; name?: string | null; role?: string | null };

export type OrgEventPayload = Omit<
  OrgEvent,
  "id" | "participant_name" | "organization_id" | "created_by" | "created_at" | "invites_sent_at" | "invite_sequence"
> & {
  /** Email the attendees a calendar invite (in-person and phone meetings). */
  send_invites?: boolean;
};

/** What happened to the calendar invites when a meeting was saved. */
export type InviteResult = { sent: string[]; failed: string[]; email_off: boolean };

export type SavedOrgEvent = OrgEvent & { invites?: InviteResult };

export type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: "critical" | "high" | "medium" | "info" | "positive";
  category: string;
  organization_id?: string;
  created_by?: string;
  created_at: string;
};

export type AnnouncementPayload = Pick<Announcement, "title" | "body" | "severity" | "category">;

export type CommunityItem = {
  id: string;
  type: "birthday" | "anniversary" | "new_starter" | "shoutout";
  name: string;
  detail: string;
  date?: string | null;
  avatar: string;
};

export async function getHubComplianceAlerts(): Promise<HubComplianceAlert[]> {
  return jsonFetch<HubComplianceAlert[]>("/api/hub/compliance-alerts");
}

/** Same alert shape as compliance-alerts, scoped to care delivery/participant
 *  engagement instead of compliance/credentialing — see Operations & Care tab. */
export async function getCareAlerts(): Promise<HubComplianceAlert[]> {
  return jsonFetch<HubComplianceAlert[]>("/api/hub/care-alerts");
}

/** Same alert shape again, scoped to "who's stuck" in the staff onboarding
 *  pipeline — applicants, unsigned offers, pending invites, blocked workers. */
export async function getOnboardingAlerts(): Promise<HubComplianceAlert[]> {
  return jsonFetch<HubComplianceAlert[]>("/api/hub/onboarding-alerts");
}

/** With a range ("yyyy-MM-dd"), everything in it; without, the next 20 upcoming. */
export async function getOrgEvents(range?: { start: string; end: string }): Promise<OrgEvent[]> {
  const query = range ? `?start=${range.start}&end=${range.end}` : "";
  return jsonFetch<OrgEvent[]>(`/api/hub/org-events${query}`);
}

export async function createOrgEvent(payload: OrgEventPayload): Promise<SavedOrgEvent> {
  return jsonFetch<SavedOrgEvent>("/api/hub/org-events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateOrgEvent(id: string, payload: OrgEventPayload): Promise<SavedOrgEvent> {
  return jsonFetch<SavedOrgEvent>(`/api/hub/org-events/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** People to suggest inviting: you, and for a participant meeting the
 *  participant, their nominee/family contacts and their support workers. */
export async function getMeetingInvitees(participantId?: string | null): Promise<Required<MeetingAttendee>[]> {
  const query = participantId ? `?participant_id=${encodeURIComponent(participantId)}` : "";
  return jsonFetch<Required<MeetingAttendee>[]>(`/api/hub/org-events/invitees${query}`);
}

export async function deleteOrgEvent(id: string): Promise<void> {
  const res = await apiFetch(`/api/hub/org-events/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || `Delete failed (${res.status})`);
  }
}

export async function getAnnouncements(): Promise<Announcement[]> {
  return jsonFetch<Announcement[]>("/api/hub/announcements");
}

export async function createAnnouncement(payload: AnnouncementPayload): Promise<Announcement> {
  return jsonFetch<Announcement>("/api/hub/announcements", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const res = await apiFetch(`/api/hub/announcements/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || `Delete failed (${res.status})`);
  }
}

export async function getStaffCommunity(): Promise<CommunityItem[]> {
  return jsonFetch<CommunityItem[]>("/api/hub/community");
}
