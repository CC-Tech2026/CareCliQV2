import { jsonFetch } from "@/services/http";

export interface IncidentPayload {
  participant_id?: string;
  session_id?: string;
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
