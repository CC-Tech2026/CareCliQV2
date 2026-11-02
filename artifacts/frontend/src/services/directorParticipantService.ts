import { jsonFetch } from "@/services/http";

// The managing director's participant profile
// (backend/app/api/director_participants.py). Managing director only.

export type DecisionTone = "danger" | "warning";
export type DecisionAction =
  | "plan" | "funding" | "incident" | "complaint" | "roster" | "team" | "agreement" | "quality" | "medication";

export type Decision = {
  key: string;
  tone: DecisionTone;
  title: string;
  detail: string;
  action: DecisionAction;
};

export type PersonRef = { id: string; name: string };

export type DirectorOverview = {
  participant: {
    id: string;
    full_name: string;
    preferred_name?: string | null;
    ndis_number?: string | null;
    date_of_birth?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    primary_disability?: string | null;
    risk_level?: string | null;
    plan_status?: string | null;
    plan_start_date?: string | null;
    plan_end_date?: string | null;
    plan_management_type?: string | null;
    upcoming_review_date?: string | null;
    service_category?: string | null;
    profile_photo_url?: string | null;
  };
  intake: {
    id: string;
    status: string;
    activated_at?: string | null;
    suspended_reason?: string | null;
    suspended_at?: string | null;
    reactivated_at?: string | null;
    exit_reason?: string | null;
    exited_at?: string | null;
    last_service_date?: string | null;
    service_category?: string | null;
  } | null;
  team: {
    coordinator: PersonRef | null;
    main_worker: PersonRef | null;
    backups: (PersonRef & { allocation_id: string })[];
  };
  funding: {
    has_plan: boolean;
    plan_number?: string | null;
    total: number;
    used: number;
    remaining: number;
    percent_used: number | null;
    percent_time_elapsed: number | null;
    ahead_by: number | null;
    categories: {
      category: string;
      label: string;
      allocated: number;
      used: number;
      remaining: number;
      percent_used?: number | null;
      overspent: boolean;
    }[];
  };
  delivery: {
    completed_30d: number;
    cancelled_30d: number;
    hours_30d: number;
    upcoming_14d: number;
    unfilled_14d: number;
    next_shift: { id: string; start: string; end?: string | null; worker: PersonRef | null } | null;
    last_shift_at: string | null;
  };
  quality: { notes_30d: number; average_score: number | null; needs_attention_30d: number };
  risk: {
    incidents_total: number;
    incidents_open: Incident[];
    latest_incident: Incident | null;
    complaints_total: number;
    complaints_open: { id: string; subject?: string | null; status: string; filed_at?: string | null }[];
  };
  medication: { active: number; pending_verification: number; high_risk: number; prn: number };
  agreement: {
    id: string;
    status: string;
    number?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    signed_date?: string | null;
  } | null;
  portal: { status: string | null; people: { name?: string | null; relationship?: string | null; status?: string | null }[] };
  decisions: Decision[];
};

export type Incident = {
  id: string;
  title: string;
  severity?: string | null;
  status?: string | null;
  date?: string | null;
  reference?: string | null;
  ndis_reportable: boolean;
};

export type ParticipantDocument = {
  id: string;
  source: "participant" | "medication";
  category: string;
  category_label: string;
  title: string;
  document_date?: string | null;
  author?: string | null;
  notes?: string | null;
  file_name: string;
  file_type?: string | null;
  file_size?: number | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
  extraction_status?: string | null;
};

export type AuditEntry = { id: string; when: string; who: string; what: string; action_type: string; kind: "view" | "change" };

// Kinds of document the director can file. Medication paperwork is read into
// the medication chart for checking; the rest are kept on the record.
export const DOCUMENT_KINDS: { value: string; label: string; group: "clinical" | "medication" | "admin" }[] = [
  { value: "gp_letter", label: "GP letter", group: "clinical" },
  { value: "clinical_assessment", label: "Clinical assessment report", group: "clinical" },
  { value: "therapy_report", label: "Therapy report", group: "clinical" },
  { value: "hospital_discharge", label: "Hospital discharge summary", group: "clinical" },
  { value: "behaviour_support_plan", label: "Behaviour support plan", group: "clinical" },
  { value: "risk_assessment", label: "Risk assessment", group: "clinical" },
  { value: "prescription", label: "Prescription", group: "medication" },
  { value: "medication_management_plan", label: "Medication management plan", group: "medication" },
  { value: "pharmacy_authority", label: "Pharmacy authority", group: "medication" },
  { value: "ndis_plan", label: "NDIS plan", group: "admin" },
  { value: "consent", label: "Consent form", group: "admin" },
  { value: "other", label: "Other document", group: "admin" },
];

const base = (id: string) => `/api/director/participants/${encodeURIComponent(id)}`;

export function getDirectorOverview(participantId: string) {
  return jsonFetch<DirectorOverview>(`${base(participantId)}/overview`);
}

export function changeCareTeam(
  participantId: string,
  body: { coordinator_id: string | null; main_worker_id: string | null; backup_worker_ids: string[] },
) {
  return jsonFetch(`${base(participantId)}/team`, { method: "PUT", body: JSON.stringify(body) });
}

export function changeServices(
  participantId: string,
  body: {
    action: "suspend" | "resume" | "end";
    reason?: string;
    last_service_date?: string;
    cancel_future_shifts?: boolean;
    revoke_portal_access?: boolean;
  },
) {
  return jsonFetch<{ cancelled_shifts: number; portal_access_removed?: number }>(`${base(participantId)}/services`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listParticipantDocuments(participantId: string) {
  return jsonFetch<{ documents: ParticipantDocument[]; available: boolean }>(`${base(participantId)}/documents`);
}

export function uploadParticipantDocument(
  participantId: string,
  input: { file: File; category: string; title?: string; document_date?: string; author?: string; notes?: string },
) {
  const form = new FormData();
  form.append("file", input.file);
  form.append("category", input.category);
  if (input.title) form.append("title", input.title);
  if (input.document_date) form.append("document_date", input.document_date);
  if (input.author) form.append("author", input.author);
  if (input.notes) form.append("notes", input.notes);
  return jsonFetch<{ source: string }>(`${base(participantId)}/documents`, { method: "POST", body: form });
}

export function getDocumentLink(participantId: string, doc: Pick<ParticipantDocument, "id" | "source">) {
  return jsonFetch<{ url: string; file_name: string }>(`${base(participantId)}/documents/${doc.source}/${doc.id}/link`);
}

export function archiveParticipantDocument(participantId: string, documentId: string, reason: string) {
  return jsonFetch(`${base(participantId)}/documents/${documentId}/archive`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function getAuditTrail(participantId: string) {
  return jsonFetch<{ entries: AuditEntry[] }>(`${base(participantId)}/audit-trail`);
}
