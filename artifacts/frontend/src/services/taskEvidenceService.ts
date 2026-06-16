import { jsonFetch } from "@/services/http";
import type { TaskEvidenceRecord } from "@/lib/task-evidence-storage";

export type SyncEvidenceResponse = {
  session_id: string;
  synced_ids: string[];
  task_evidence: TaskEvidenceRecord[];
};

export function syncSessionEvidence(sessionId: string, evidence: TaskEvidenceRecord[]) {
  return jsonFetch<SyncEvidenceResponse>(`/api/worker/sessions/${sessionId}/evidence`, {
    method: "POST",
    body: JSON.stringify({ evidence }),
  });
}
