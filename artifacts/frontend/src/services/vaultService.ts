import { apiFetch } from "@/lib/api-fetch";

export interface VaultDocument {
  id: string;
  category: string;
  folder_label: string;
  title: string;
  person_name: string;
  person_type: "Participant" | "Worker" | "Organisation";
  date: string;
  status: string;
  source_table: string;
  source_id: string;
  has_stored_file: boolean;
}

export interface VaultFolder {
  category: string;
  label: string;
  group: "record" | "governance";
  count: number;
  flagged_count: number;
  updated_at: string | null;
  is_custom: boolean;
}

export interface VaultStats {
  total_documents: number;
  flagged_for_review: number;
  shared_last_30_days: number;
}

export interface DocRef {
  category: string;
  id: string;
}

export interface AuditPackExport {
  id: string;
  label: string;
  period_start: string | null;
  period_end: string | null;
  file_url: string | null;
  file_size_bytes: number | null;
  created_at: string;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Request failed.");
  }
  return res.json();
}

export async function fetchVaultStats(): Promise<VaultStats> {
  const res = await apiFetch("/api/md-vault/stats");
  return parseJson(res);
}

export async function fetchVaultFolders(): Promise<VaultFolder[]> {
  const res = await apiFetch("/api/md-vault/folders");
  const data = await parseJson<{ folders: VaultFolder[] }>(res);
  return data.folders;
}

export async function fetchFolderDocuments(
  category: string,
  filters: { search?: string; person?: string; date_from?: string; date_to?: string } = {}
): Promise<VaultDocument[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.person) params.set("person", filters.person);
  if (filters.date_from) params.set("date_from", filters.date_from);
  if (filters.date_to) params.set("date_to", filters.date_to);
  const qs = params.toString();
  const res = await apiFetch(
    `/api/md-vault/folders/${encodeURIComponent(category)}/documents${qs ? `?${qs}` : ""}`
  );
  const data = await parseJson<{ documents: VaultDocument[] }>(res);
  return data.documents;
}

export function documentFileUrl(category: string, id: string): string {
  return `/api/md-vault/folders/${encodeURIComponent(category)}/documents/${encodeURIComponent(id)}/file`;
}

/** Fetches one document's real bytes + the filename the server assigned it
 * (via Content-Disposition) — used both for a single-row download and, in a
 * loop, to assemble the ZIP pack with real per-file progress. */
export async function fetchDocumentFile(
  category: string,
  id: string
): Promise<{ filename: string; blob: Blob }> {
  const res = await apiFetch(documentFileUrl(category, id));
  if (!res.ok) {
    throw new Error("Could not download this document.");
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] || `${category}-${id}`;
  const blob = await res.blob();
  return { filename, blob };
}

export async function searchVault(
  query: string
): Promise<{ answer: string; documents: VaultDocument[] }> {
  const res = await apiFetch("/api/md-vault/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return parseJson(res);
}

export async function planPack(
  documents: DocRef[]
): Promise<{ category: string; id: string; title: string }[]> {
  const res = await apiFetch("/api/md-vault/pack/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents }),
  });
  const data = await parseJson<{ plan: { category: string; id: string; title: string }[] }>(res);
  return data.plan;
}

export async function logShareEvent(payload: {
  method: "download_zip" | "email_gmail" | "email_outlook" | "email_mailto";
  folder_keys?: string[];
  documents?: DocRef[];
  recipient_hint?: string;
}): Promise<void> {
  await apiFetch("/api/md-vault/share-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadGovernanceDocument(params: {
  folderKey: string;
  title: string;
  description?: string;
  file: File;
}): Promise<VaultDocument> {
  const form = new FormData();
  form.set("folder_key", params.folderKey);
  form.set("title", params.title);
  if (params.description) form.set("description", params.description);
  form.set("file", params.file);
  const res = await apiFetch("/api/md-vault/governance-documents", { method: "POST", body: form });
  return parseJson(res);
}

export async function deleteGovernanceDocument(id: string): Promise<void> {
  const res = await apiFetch(`/api/md-vault/governance-documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error("Could not delete this document.");
  }
}

export async function generateAuditPack(label?: string): Promise<void> {
  const res = await apiFetch("/api/md-vault/audit-packs/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: label ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Could not generate audit pack.");
  }
}

export async function fetchAuditPackExports(): Promise<AuditPackExport[]> {
  const res = await apiFetch("/api/md-vault/audit-packs");
  const data = await parseJson<{ packs: AuditPackExport[] }>(res);
  return data.packs;
}

export async function setFolderOrder(order: string[]): Promise<void> {
  await apiFetch("/api/md-vault/folders/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
}

export async function createCustomFolder(label: string, description?: string): Promise<{ category: string; label: string }> {
  const res = await apiFetch("/api/md-vault/custom-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, description: description || null }),
  });
  return parseJson(res);
}

export async function uploadCustomFolderDocument(params: {
  folderId: string;
  title: string;
  file: File;
}): Promise<VaultDocument> {
  const form = new FormData();
  form.set("title", params.title);
  form.set("file", params.file);
  const res = await apiFetch(`/api/md-vault/custom-folders/${encodeURIComponent(params.folderId)}/documents`, {
    method: "POST",
    body: form,
  });
  return parseJson(res);
}

export async function deleteCustomFolderDocument(folderId: string, documentId: string): Promise<void> {
  const res = await apiFetch(
    `/api/md-vault/custom-folders/${encodeURIComponent(folderId)}/documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error("Could not delete this document.");
  }
}
