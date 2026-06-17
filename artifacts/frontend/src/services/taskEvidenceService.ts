import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";
import type { TaskEvidenceRecord } from "@/lib/task-evidence-storage";

export type SyncEvidenceResponse = {
  session_id: string;
  synced_ids: string[];
  task_evidence: TaskEvidenceRecord[];
};

export type SessionAttachment = {
  id: string;
  file_name: string;
  public_url?: string | null;
  file_path?: string | null;
  mime_type?: string | null;
  created_at?: string | null;
};

export function syncSessionEvidence(sessionId: string, evidence: TaskEvidenceRecord[]) {
  return jsonFetch<SyncEvidenceResponse>(`/api/worker/sessions/${sessionId}/evidence`, {
    method: "POST",
    body: JSON.stringify({ evidence }),
  });
}

export async function uploadSessionAttachment(sessionId: string, file: File): Promise<SessionAttachment> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch(`/api/sessions/${sessionId}/attachments`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || `Upload failed (${response.status})`);
  }
  return response.json() as Promise<SessionAttachment>;
}
