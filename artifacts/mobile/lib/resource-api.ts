import { getMobileApiBaseUrl } from "@/lib/api-base-url";
import { readMobileAuthToken } from "@/lib/session";
import { workerFetch } from "@/lib/worker-fetch";

export type Credential = {
  id: string;
  credential_type: string;
  title: string;
  issuer?: string | null;
  credential_number?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
  file_url?: string | null;
  status: string;
};

export type CredentialPayload = {
  credential_type: string;
  title: string;
  credential_number?: string | null;
  issuer?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
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
  ndis_pending?: boolean;
  overdue?: boolean;
};

export type IncidentDetail = {
  id: string;
  title: string;
  description: string;
  incident_type: string;
  severity: string;
  status: string;
  incident_date: string;
  reported_date: string;
  resolved_date?: string | null;
  location?: string | null;
  witnesses?: string | null;
  ndis_reportable: boolean;
  ndis_reported_at?: string | null;
  ndis_pending: boolean;
  overdue: boolean;
  practice_standard?: string | null;
  participant_id?: string | null;
  participant_name?: string | null;
  participant_ndis?: string | null;
  participant_impact?: string | null;
  worker_actions?: string | null;
  investigation_notes?: string | null;
  corrective_actions?: string | null;
};

export type IncidentStats = {
  total: number;
  open: number;
  ndis_pending: number;
  overdue: number;
  critical: number;
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

export function createCredential(payload: CredentialPayload) {
  return workerFetch<Credential>("/api/credentials/me", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadCredentialFile(
  credentialId: string,
  file: { uri: string; name: string; type: string },
): Promise<Credential> {
  const base = getMobileApiBaseUrl();
  if (!base) {
    throw new Error("API URL not configured");
  }

  const token = await readMobileAuthToken();
  const formData = new FormData();
  formData.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as unknown as Blob);

  const response = await fetch(`${base}/api/credentials/me/${credentialId}/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    let message = "Could not upload credential file.";
    try {
      const body = (await response.json()) as { detail?: string };
      message = body.detail ?? message;
    } catch {
      /* use default */
    }
    throw new Error(message);
  }

  return response.json() as Promise<Credential>;
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

export type TrainingResource = {
  id: string;
  module_id: string;
  title: string;
  resource_type?: "video" | "pdf" | "external_link" | null;
  storage_path?: string | null;
  external_url?: string | null;
};

export type TrainingModule = {
  id: string;
  title: string;
  description?: string | null;
  requires_certification?: boolean;
  resources?: TrainingResource[];
};

export type TrainingRecommendation = {
  id: string;
  training_module_id: string;
  title: string;
  recommended_at?: string;
  due_at?: string | null;
  started_at?: string | null;
};

export type TrainingHistoryItem = {
  id: string;
  module_id: string;
  completed_at: string;
  status: string;
  note?: string | null;
  rejection_reason?: string | null;
  training_modules?: { title: string } | null;
};

export function getTrainingModules() {
  return workerFetch<{ modules: TrainingModule[] }>("/api/worker/training/modules");
}

export function getTrainingRecommendations() {
  return workerFetch<{ recommendations: TrainingRecommendation[] }>("/api/worker/training/recommendations");
}

export function getTrainingHistory() {
  return workerFetch<{ history: TrainingHistoryItem[] }>("/api/worker/training/history");
}

export function markTrainingComplete(moduleId: string, completedAt: string, acknowledged: boolean, note?: string) {
  return workerFetch<TrainingHistoryItem>("/api/worker/training/complete", {
    method: "POST",
    body: JSON.stringify({ module_id: moduleId, completed_at: completedAt, acknowledged, note: note || undefined }),
  });
}

export function startTrainingModule(moduleId: string) {
  return workerFetch<{ started_at: string | null }>(`/api/worker/training/${moduleId}/start`, {
    method: "POST",
  });
}

export function listIncidents() {
  return workerFetch<IncidentSummary[]>("/api/incidents");
}

export function getIncident(id: string) {
  return workerFetch<IncidentDetail>(`/api/incidents/${id}`);
}

export function updateIncident(id: string, updates: Record<string, unknown>) {
  return workerFetch<IncidentDetail>(`/api/incidents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function getIncidentStats() {
  return workerFetch<IncidentStats>("/api/incidents/stats");
}

export function createWorkerIncident<T = { id: string; reference_number?: string }>(
  payload: WorkerIncidentPayload,
) {
  return workerFetch<T>("/api/incidents/worker-report", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
