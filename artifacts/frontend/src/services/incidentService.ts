import { jsonFetch } from "@/services/http";

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
}

export function listIncidents<T = unknown>() {
  return jsonFetch<T>("/api/incidents");
}

export function getIncidentStats<T = unknown>() {
  return jsonFetch<T>("/api/incidents/stats");
}

export function getIncident<T = unknown>(id: string) {
  return jsonFetch<T>(`/api/incidents/${id}`);
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
