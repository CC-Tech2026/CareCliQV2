import { workerFetch } from "@/lib/worker-fetch";

export type Credential = {
  id: string;
  credential_type: string;
  title: string;
  issuer?: string | null;
  credential_number?: string | null;
  expiry_date?: string | null;
  file_url?: string | null;
  status: string;
};

export type ToolkitItem = {
  id: string;
  name: string;
  category?: string | null;
  quantity: number;
  unit: string;
  minimum_quantity: number;
  status: string;
  low_stock?: boolean;
  assigned_user_id?: string | null;
  expiry_date?: string | null;
};

export type ToolkitMovement = {
  id: string;
  item_id: string;
  movement_type: string;
  quantity: number;
  notes?: string | null;
  created_at?: string;
};

export type ToolkitResponse = {
  items: ToolkitItem[];
  movements?: ToolkitMovement[];
};

export type IncidentSummary = {
  id: string;
  title: string;
  incident_type: string;
  severity: string;
  status: string;
  incident_date: string;
  participant_name?: string;
};

export type IncidentPhotoItem = {
  data: string;
  description?: string;
  captured_at?: string;
  latitude?: number;
  longitude?: number;
};

export type WorkerIncidentPayload = {
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
};

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

export function listMyCredentials() {
  return workerFetch<Credential[]>("/api/credentials/me");
}

export function getMyToolkit() {
  return workerFetch<ToolkitResponse>("/api/toolkit/me");
}

export function useToolkitItem(itemId: string, quantity = 1) {
  return workerFetch<ToolkitItem>("/api/toolkit/me/use-item", {
    method: "POST",
    body: JSON.stringify({ item_id: itemId, quantity, notes: "Used from mobile toolkit" }),
  });
}

export function requestToolkitRestock(itemId: string, quantity: number) {
  return workerFetch<{ id: string; status: string }>("/api/toolkit/me/restock-request", {
    method: "POST",
    body: JSON.stringify({ item_id: itemId, quantity_requested: Math.max(1, quantity), notes: "Requested from mobile toolkit" }),
  });
}

export function listIncidents() {
  return workerFetch<IncidentSummary[]>("/api/incidents");
}

export function createWorkerIncident<T = { id: string; reference_number?: string }>(
  payload: WorkerIncidentPayload,
) {
  return workerFetch<T>("/api/incidents/worker-report", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
