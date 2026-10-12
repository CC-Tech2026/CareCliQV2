import { jsonFetch } from "@/services/http";

export type ComplaintStatus = "open" | "in_review" | "resolved";

/** A complaint raised by, or on behalf of, a participant (migration 242). */
export interface ParticipantComplaint {
  id: string;
  participant_id: string | null;
  participant_name: string;
  /** Who raised it, e.g. "Mother (Jane Rivera)". */
  raised_by: string | null;
  subject: string;
  description: string;
  status: ComplaintStatus;
  /** What was done to address it; required to mark it resolved. */
  resolution_notes: string | null;
  responded_at: string | null;
  filed_at: string;
}

export interface NewComplaint {
  subject: string;
  description: string;
  participant_id?: string | null;
  participant_name?: string | null;
  raised_by?: string | null;
  filed_at?: string | null;
}

export function listParticipantComplaints() {
  return jsonFetch<ParticipantComplaint[]>("/api/participant-complaints");
}

export function createParticipantComplaint(body: NewComplaint) {
  return jsonFetch<ParticipantComplaint>("/api/participant-complaints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateParticipantComplaint(id: string, status: Exclude<ComplaintStatus, "open">, resolutionNotes?: string) {
  return jsonFetch<ParticipantComplaint>(`/api/participant-complaints/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, resolution_notes: resolutionNotes || null }),
  });
}
