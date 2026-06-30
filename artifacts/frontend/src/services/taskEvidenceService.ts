import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";
import type { TaskEvidenceRecord } from "@/lib/task-evidence-storage";

export type SyncEvidenceResponse = {
  session_id: string;
  synced_ids: string[];
  task_evidence: TaskEvidenceRecord[];
};

export type UploadEvidenceResponse = {
  success: boolean;
  session_id: string;
  uploaded_evidence: Array<{
    evidence_id: string;
    url?: string | null;
    storage_path?: string | null;
    stored_at?: string;
  }>;
  task_evidence?: TaskEvidenceRecord[];
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

export function uploadSessionEvidenceMedia(
  sessionId: string,
  evidence: TaskEvidenceRecord[],
  files: Record<string, string>,
) {
  const payload = {
    session_id: sessionId,
    evidence: evidence.map((row) => ({
      evidence_id: row.evidence_id,
      task_id: row.task_id,
      type: row.type,
      filename: row.file_name || `${row.evidence_id}.${row.type === "photo" ? "jpg" : "webm"}`,
      size_bytes: row.file_size_bytes ?? undefined,
      mime_type: row.mime_type || (row.type === "photo" ? "image/jpeg" : "audio/webm"),
      goal_id: row.goal_id ?? undefined,
      duration_seconds: row.duration_seconds ?? undefined,
      created_at: row.created_at,
      content: row.type === "photo" && row.content.startsWith("data:image") ? row.content : undefined,
    })),
    files,
  };
  return jsonFetch<UploadEvidenceResponse>(`/api/worker/sessions/${sessionId}/upload-evidence`, {
    method: "POST",
    body: JSON.stringify(payload),
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
