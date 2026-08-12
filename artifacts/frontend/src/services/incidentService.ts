import { jsonFetch } from "@/services/http";

export interface IncidentPhotoItem {
  data: string;
  description?: string;
  captured_at?: string;
  latitude?: number;
  longitude?: number;
}

export const WORKER_REPORT_TYPES = [
  { value: "safety_hazard", label: "Safety hazard" },
  { value: "participant_behaviour", label: "Participant behaviour" },
  { value: "equipment_damage", label: "Equipment damage" },
  { value: "travel_accident", label: "Travel accident" },
  { value: "other", label: "Other" },
] as const;

export const BEHAVIOUR_SUBTYPES = [
  { value: "verbal", label: "Verbal" },
  { value: "physical", label: "Physical" },
  { value: "property", label: "Property" },
] as const;

export const WORKER_SEVERITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "emergency", label: "Emergency" },
] as const;

export interface WorkerIncidentPayload {
  participant_id?: string;
  session_id?: string;
  shift_id?: string;
  worker_report_type: string;
  behaviour_subtype?: string;
  severity: string;
  description: string;
  incident_date: string;
  location?: string;
  participant_present?: boolean;
  participant_harmed?: "yes" | "no" | "unknown";
  worker_actions?: string;
  photo_items?: IncidentPhotoItem[];
}

export interface IncidentPayload {
  participant_id?: string;
  session_id?: string;
  shift_id?: string;
  incident_type: string;
  severity: string;
  title: string;
  description: string;
  location?: string;
  witnesses?: string;
  participant_impact?: string;
  worker_actions?: string;
  incident_date: string;
  follow_up_required?: boolean;
  escalate?: boolean;
  photo_data?: string[];
  photo_items?: IncidentPhotoItem[];
}

export function listIncidents<T = unknown>(params?: { shift_id?: string; participant_id?: string }) {
  const search = new URLSearchParams();
  if (params?.shift_id) search.set("shift_id", params.shift_id);
  if (params?.participant_id) search.set("participant_id", params.participant_id);
  const qs = search.toString();
  return jsonFetch<T>(`/api/incidents${qs ? `?${qs}` : ""}`);
}

export function getIncidentStats<T = unknown>() {
  return jsonFetch<T>("/api/incidents/stats");
}

export function getIncident<T = unknown>(id: string) {
  return jsonFetch<T>(`/api/incidents/${id}`);
}

export function createWorkerIncident<T = unknown>(payload: WorkerIncidentPayload) {
  return jsonFetch<T>("/api/incidents/worker-report", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function addIncidentCorrection<T = unknown>(incidentId: string, note: string) {
  return jsonFetch<T>(`/api/incidents/${incidentId}/corrections`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function listIncidentCorrections<T = unknown>(incidentId: string) {
  return jsonFetch<T>(`/api/incidents/${incidentId}/corrections`);
}

export function createIncident<T = unknown>(payload: IncidentPayload) {
  return jsonFetch<T>("/api/incidents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateIncident<T = unknown>(id: string, updates: Record<string, unknown>) {
  return jsonFetch<T>(`/api/incidents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function getIncidentsByParticipant<T = unknown>(participantId: string) {
  return jsonFetch<T>(`/api/incidents/participant/${participantId}`);
}

export interface WitnessItem {
  name: string;
  contact?: string;
  relationship?: string;
}

export function overrideIncidentReportable<T = unknown>(
  incidentId: string,
  payload: { is_reportable: boolean; reason: string },
) {
  return jsonFetch<T>(`/api/incidents/${incidentId}/override-reportable`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface SubjectOfAllegationPayload {
  subject_type: "worker" | "participant" | "other";
  subject_user_id?: string;
  subject_name?: string;
  subject_role?: string;
  notes?: string;
}

export interface SubjectOfAllegationRecord extends SubjectOfAllegationPayload {
  id: string;
  incident_id: string;
  created_at: string;
}

export function createSubjectOfAllegation<T = unknown>(
  incidentId: string,
  payload: SubjectOfAllegationPayload,
) {
  return jsonFetch<T>(`/api/incidents/${incidentId}/subject-of-allegation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listSubjectOfAllegation(incidentId: string) {
  return jsonFetch<{ records: SubjectOfAllegationRecord[] }>(
    `/api/incidents/${incidentId}/subject-of-allegation`,
  );
}

export function assignIncidentInvestigator<T = unknown>(incidentId: string, investigatorUserId: string) {
  return jsonFetch<T>(`/api/incidents/${incidentId}/assign-investigator`, {
    method: "POST",
    body: JSON.stringify({ investigator_user_id: investigatorUserId }),
  });
}

export interface InterviewPayload {
  interviewee_name: string;
  interviewee_type: "worker" | "participant" | "witness" | "other";
  interviewee_user_id?: string;
  interviewed_at?: string;
  notes?: string;
}

export interface InterviewRecord extends InterviewPayload {
  id: string;
  incident_id: string;
  created_at: string;
}

export function createIncidentInterview<T = unknown>(incidentId: string, payload: InterviewPayload) {
  return jsonFetch<T>(`/api/incidents/${incidentId}/interviews`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listIncidentInterviews(incidentId: string) {
  return jsonFetch<{ records: InterviewRecord[] }>(`/api/incidents/${incidentId}/interviews`);
}

export interface IncidentAuditTrailEntry {
  id: string;
  action_type: string;
  actor_name: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export function getIncidentAuditTrail(incidentId: string) {
  return jsonFetch<IncidentAuditTrailEntry[]>(`/api/incidents/${incidentId}/audit-trail`);
}

export interface SimilarIncidentMatch {
  incident_id: string;
  date: string;
  participant_label: string;
  similarity_score: number;
  excerpt: string;
}

export interface IncidentPatternSummary {
  pattern_recognised: string;
  past_strategies: string;
  recommendations: string;
}

export interface SimilarIncidentPatternsResult {
  sufficient_context: boolean;
  incident_count: number;
  matches: SimilarIncidentMatch[];
  ai_summary: IncidentPatternSummary | null;
}

export function getSimilarIncidentPatterns(incidentId: string) {
  return jsonFetch<SimilarIncidentPatternsResult>(
    `/api/incidents/${incidentId}/similar-patterns`,
  );
}

export interface IncidentComplyPayload {
  incident_type: string;
  severity: string;
  title: string;
  description: string;
  worker_actions?: string;
  participant_name?: string;
}

export interface IncidentComplyResult {
  compliant_description: string;
  compliant_worker_actions: string;
  practice_standard: string;
  ndis_reportable: boolean;
  notification_hours: number;
  compliance_score: number;
  compliance_criteria: {
    factual_completeness: number;
    clinical_language: number;
    action_documented: number;
    ndis_standard_alignment: number;
    follow_up_indicators: number;
  };
  compliance_flags: string[];
  reporting_requirements: string | null;
  suggested_follow_up: string | null;
}

export function complyIncident(payload: IncidentComplyPayload) {
  return jsonFetch<IncidentComplyResult>("/api/ai/incidents/comply", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
