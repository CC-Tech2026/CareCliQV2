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
  /** Field/section labels to leave out of this specific share - only has
   * an effect on categories rendered on demand (see CUSTOMIZABLE_FIELDS). */
  exclude_fields?: string[];
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

/** One folder's meta only — for a folder page opening a single category, so
 * it doesn't pay for recomputing every category (fetchVaultFolders) just to
 * read the one it's actually showing. */
export async function fetchFolderMeta(category: string): Promise<VaultFolder> {
  const res = await apiFetch(`/api/md-vault/folders/${encodeURIComponent(category)}/meta`);
  return parseJson<VaultFolder>(res);
}

/** Which field/section labels can be individually left out of a share, per
 * category — empty/absent for categories with no structured content to
 * customize (real uploaded files). */
export async function fetchCustomizableFields(): Promise<Record<string, string[]>> {
  const res = await apiFetch("/api/md-vault/customizable-fields");
  const data = await parseJson<{ fields: Record<string, string[]> }>(res);
  return data.fields;
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

export function documentFileUrl(category: string, id: string, excludeFields: string[] = []): string {
  const base = `/api/md-vault/folders/${encodeURIComponent(category)}/documents/${encodeURIComponent(id)}/file`;
  if (excludeFields.length === 0) return base;
  const params = new URLSearchParams();
  excludeFields.forEach((f) => params.append("exclude", f));
  return `${base}?${params.toString()}`;
}

/** Fetches one document's real bytes + the filename the server assigned it
 * (via Content-Disposition) — used both for a single-row download and, in a
 * loop, to assemble the ZIP pack with real per-file progress. `excludeFields`
 * leaves specific fields/sections out of the rendered file, for categories
 * that support it (see fetchCustomizableFields). */
export async function fetchDocumentFile(
  category: string,
  id: string,
  excludeFields: string[] = []
): Promise<{ filename: string; blob: Blob }> {
  const res = await apiFetch(documentFileUrl(category, id, excludeFields));
  if (!res.ok) {
    // 404 specifically means "no file has ever been attached to this
    // record" (e.g. a credential logged with no scan uploaded) rather than
    // "this file type can't be previewed" — callers that show a preview
    // distinguish the two, so surface which one this was.
    throw new Error(res.status === 404 ? "not_found" : "Could not download this document.");
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
  supersedesDocumentId?: string;
  versionLabel?: string;
  visibleToWorkers?: boolean;
}): Promise<VaultDocument> {
  const form = new FormData();
  form.set("folder_key", params.folderKey);
  form.set("title", params.title);
  if (params.description) form.set("description", params.description);
  if (params.supersedesDocumentId) form.set("supersedes_document_id", params.supersedesDocumentId);
  if (params.versionLabel) form.set("version_label", params.versionLabel);
  if (params.visibleToWorkers) form.set("visible_to_workers", "true");
  form.set("file", params.file);
  const res = await apiFetch("/api/md-vault/governance-documents", { method: "POST", body: form });
  return parseJson(res);
}

export async function setGovernanceDocumentWorkerVisibility(id: string, visible: boolean): Promise<VaultDocument> {
  const res = await apiFetch(`/api/md-vault/governance-documents/${encodeURIComponent(id)}/worker-visibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visible_to_workers: visible }),
  });
  return parseJson(res);
}

export interface PolicyAcknowledgementStatus {
  document_id: string;
  title: string;
  folder_key: string;
  folder_label: string;
  total: number;
  acknowledged: number;
  rate_percent: number | null;
}

export async function fetchPolicyAcknowledgementStatus(): Promise<PolicyAcknowledgementStatus[]> {
  const res = await apiFetch("/api/md-vault/policies/acknowledgement-status");
  const data = await parseJson<{ policies: PolicyAcknowledgementStatus[] }>(res);
  return data.policies;
}

export interface GovernanceDocumentVersion {
  id: string;
  title: string;
  description: string | null;
  version_label: string | null;
  file_url: string | null;
  created_at: string;
  is_current: boolean;
}

export async function fetchGovernanceDocumentVersions(documentId: string): Promise<GovernanceDocumentVersion[]> {
  const res = await apiFetch(`/api/md-vault/governance-documents/${encodeURIComponent(documentId)}/versions`);
  const data = await parseJson<{ versions: GovernanceDocumentVersion[] }>(res);
  return data.versions;
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

export async function createCustomFolder(
  label: string,
  description?: string,
  group: "record" | "governance" = "record"
): Promise<{ category: string; label: string }> {
  const res = await apiFetch("/api/md-vault/custom-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, description: description || null, group }),
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

// ── Branded templates + in-app policy document editing ──────────────────────

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchDocumentTemplates(): Promise<DocumentTemplate[]> {
  const res = await apiFetch("/api/md-vault/templates");
  const data = await parseJson<{ templates: DocumentTemplate[] }>(res);
  return data.templates;
}

export async function createDocumentTemplate(params: {
  name: string;
  description?: string;
  htmlContent: string;
}): Promise<DocumentTemplate> {
  const res = await apiFetch("/api/md-vault/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: params.name, description: params.description, html_content: params.htmlContent }),
  });
  return parseJson(res);
}

export async function previewTemplateHtml(htmlContent: string): Promise<string> {
  const res = await apiFetch("/api/md-vault/templates/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html_content: htmlContent }),
  });
  const data = await parseJson<{ html: string }>(res);
  return data.html;
}

export interface PolicyDocument {
  id: string;
  organization_id: string;
  folder_key: string;
  title: string;
  template_id: string | null;
  content_html: string;
  visible_to_workers: boolean;
  current_governance_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchPolicyDocuments(): Promise<PolicyDocument[]> {
  const res = await apiFetch("/api/md-vault/policy-documents");
  const data = await parseJson<{ documents: PolicyDocument[] }>(res);
  return data.documents;
}

export async function fetchPolicyDocument(id: string): Promise<PolicyDocument> {
  const res = await apiFetch(`/api/md-vault/policy-documents/${encodeURIComponent(id)}`);
  return parseJson(res);
}

export async function createPolicyDocument(params: {
  folderKey: string;
  title: string;
  templateId?: string | null;
}): Promise<PolicyDocument> {
  const res = await apiFetch("/api/md-vault/policy-documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_key: params.folderKey, title: params.title, template_id: params.templateId ?? null }),
  });
  return parseJson(res);
}

export async function updatePolicyDocument(
  id: string,
  updates: Partial<{
    title: string;
    folderKey: string;
    templateId: string | null;
    contentHtml: string;
    visibleToWorkers: boolean;
  }>,
): Promise<PolicyDocument> {
  const body: Record<string, unknown> = {};
  if (updates.title !== undefined) body.title = updates.title;
  if (updates.folderKey !== undefined) body.folder_key = updates.folderKey;
  if (updates.templateId !== undefined) body.template_id = updates.templateId;
  if (updates.contentHtml !== undefined) body.content_html = updates.contentHtml;
  if (updates.visibleToWorkers !== undefined) body.visible_to_workers = updates.visibleToWorkers;
  const res = await apiFetch(`/api/md-vault/policy-documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function publishPolicyDocument(id: string): Promise<PolicyDocument & { published_document: VaultDocument }> {
  const res = await apiFetch(`/api/md-vault/policy-documents/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
  return parseJson(res);
}

export async function previewPolicyDocument(params: {
  templateId: string | null;
  title: string;
  contentHtml: string;
}): Promise<string> {
  const res = await apiFetch("/api/md-vault/policy-documents/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_id: params.templateId, title: params.title, content_html: params.contentHtml }),
  });
  const data = await parseJson<{ html: string }>(res);
  return data.html;
}
