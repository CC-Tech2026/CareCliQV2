import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";

export type WorkerPolicy = {
  id: string;
  folder_key: string;
  folder_label: string;
  title: string;
  description?: string | null;
  version_label?: string | null;
  created_at: string;
  acknowledged: boolean;
  acknowledged_at?: string | null;
};

export function listWorkerPolicies() {
  return jsonFetch<{ policies: WorkerPolicy[] }>("/api/worker/policies");
}

export function acknowledgeWorkerPolicy(documentId: string) {
  return jsonFetch<{ document_id: string; acknowledged_at: string }>(
    `/api/worker/policies/${documentId}/acknowledge`,
    { method: "POST" },
  );
}

/** Fetches the policy file as an authenticated blob and opens it in a new
 *  tab — a plain <a href> can't carry the Bearer token apiFetch attaches. */
export async function openWorkerPolicyFile(documentId: string): Promise<void> {
  const res = await apiFetch(`/api/worker/policies/${documentId}/file`);
  if (!res.ok) throw new Error("Could not open this document.");
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
