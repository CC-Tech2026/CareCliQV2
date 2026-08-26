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
  organization_id?: string;
  created_by?: string;
  created_at?: string;
};

export type OrgEventPayload = Omit<OrgEvent, "id" | "organization_id" | "created_by" | "created_at">;

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

export async function getOrgEvents(): Promise<OrgEvent[]> {
  return jsonFetch<OrgEvent[]>("/api/hub/org-events");
}

export async function createOrgEvent(payload: OrgEventPayload): Promise<OrgEvent> {
  return jsonFetch<OrgEvent>("/api/hub/org-events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
