import { apiFetch } from "@/lib/api-fetch";

export type ItemStatus =
  | "missing"
  | "awaiting_review"
  | "current"
  | "due_soon"
  | "overdue"
  | "not_applicable";

export type SubjectType = "organisation" | "worker" | "participant";

export type Area = "staff" | "participant" | "governance" | "quality" | "insurance";

export interface AuditEvidence {
  source_table: string;
  source_id: string;
  title: string;
  kind: "auto" | "linked";
  status: ItemStatus | "rejected";
  detail: string;
  date: string | null;
  due_date: string | null;
  vault_category: string | null;
  /** Counts only once an authorised person approves it. */
  reviewable: boolean;
  link_id: string | null;
  review_status: "awaiting_review" | "approved" | "rejected" | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface AuditItem {
  id: string;
  requirement_code: string;
  area: Area;
  title: string;
  critical: boolean;
  subject_type: SubjectType;
  subject_id: string | null;
  subject_name: string;
  status: ItemStatus;
  applies_reason: string;
  due_date: string | null;
  next_action: string;
  evidence: AuditEvidence[];
  not_applicable: {
    id: string;
    reason: string;
    approved_by: string | null;
    approved_at: string;
  } | null;
}

export interface AuditSummary {
  total: number;
  applicable: number;
  counts: Record<ItemStatus, number>;
  readiness_percent: number | null;
  critical_gaps: number;
  by_area: { area: Area; label: string; total: number; ready: number; gaps: number }[];
}

export interface AuditChecklist {
  generated_at: string;
  profile_configured: boolean;
  summary: AuditSummary;
  items: AuditItem[];
}

export interface AuditRequirement {
  code: string;
  area: Area;
  area_label: string;
  scope: SubjectType;
  title: string;
  description: string;
  source: string;
  evidence_hint: string;
  critical: boolean;
  sensitive: boolean;
  applies: boolean;
  applies_reason: string;
  enabled: boolean;
  review_interval_days: number | null;
  default_review_interval_days: number | null;
}

export interface AuditProfile {
  audit_type: "verification" | "certification" | null;
  registration_groups: string[];
  service_flags: string[];
  effective_flags: Record<string, string>;
  configured: boolean;
}

export interface AuditProfileOptions {
  audit_types: { value: "verification" | "certification"; label: string }[];
  registration_groups: { code: string; label: string }[];
  service_flags: { key: string; label: string; implied_by: string[] }[];
}

/** Query keys, prefixed with the org id by useOrgQuery. */
export const AUDIT_READINESS_KEY = ["audit-readiness"] as const;

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail) && detail[0]?.msg
          ? String(detail[0].msg)
          : "Request failed.",
    );
  }
  return res.json();
}

function send(path: string, method: string, body?: unknown) {
  return apiFetch(`/api/audit-readiness${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function fetchChecklist(): Promise<AuditChecklist> {
  return parseJson(await send("/checklist", "GET"));
}

export async function fetchRequirements(): Promise<AuditRequirement[]> {
  const data = await parseJson<{ requirements: AuditRequirement[] }>(await send("/requirements", "GET"));
  return data.requirements;
}

export async function fetchProfile(): Promise<{ profile: AuditProfile; options: AuditProfileOptions }> {
  return parseJson(await send("/profile", "GET"));
}

export async function saveProfile(profile: {
  audit_type: AuditProfile["audit_type"];
  registration_groups: string[];
  service_flags: string[];
}): Promise<AuditProfile> {
  const data = await parseJson<{ profile: AuditProfile }>(await send("/profile", "PUT", profile));
  return data.profile;
}

export async function saveRequirementSetting(
  code: string,
  setting: { is_enabled: boolean; review_interval_days: number | null },
): Promise<void> {
  await parseJson(await send(`/requirements/${encodeURIComponent(code)}/settings`, "PUT", setting));
}

type ItemRef = Pick<AuditItem, "requirement_code" | "subject_type" | "subject_id">;

function ref(item: ItemRef) {
  return {
    requirement_code: item.requirement_code,
    subject_type: item.subject_type,
    subject_id: item.subject_id,
  };
}

export async function linkEvidence(item: ItemRef, vaultCategory: string, documentId: string): Promise<void> {
  await parseJson(
    await send("/evidence-links", "POST", { ...ref(item), vault_category: vaultCategory, document_id: documentId }),
  );
}

export async function reviewEvidence(
  item: ItemRef,
  evidence: Pick<AuditEvidence, "source_table" | "source_id">,
  decision: "approved" | "rejected",
  opts: { note?: string; expiry_date?: string | null } = {},
): Promise<void> {
  await parseJson(
    await send("/evidence-reviews", "POST", {
      ...ref(item),
      source_table: evidence.source_table,
      source_id: evidence.source_id,
      decision,
      note: opts.note || null,
      expiry_date: opts.expiry_date || null,
    }),
  );
}

export async function unlinkEvidence(linkId: string): Promise<void> {
  await parseJson(await send(`/evidence-links/${encodeURIComponent(linkId)}`, "DELETE"));
}

export async function markNotApplicable(item: ItemRef, reason: string): Promise<void> {
  await parseJson(await send("/na-decisions", "POST", { ...ref(item), reason }));
}

export async function revokeNotApplicable(decisionId: string, reason?: string): Promise<void> {
  await parseJson(
    await send(`/na-decisions/${encodeURIComponent(decisionId)}/revoke`, "POST", { reason: reason || null }),
  );
}

export const STATUS_LABELS: Record<ItemStatus | "rejected", string> = {
  missing: "Missing",
  awaiting_review: "Awaiting review",
  current: "Current",
  due_soon: "Due soon",
  overdue: "Overdue",
  not_applicable: "Not applicable",
  rejected: "Rejected",
};

export const AREA_LABELS: Record<Area, string> = {
  staff: "Staff and key personnel",
  participant: "Participant files",
  governance: "Governance and policies",
  quality: "Quality and improvement",
  insurance: "Insurance and transport",
};

/** Outstanding items as CSV, for handing to whoever is chasing them. */
export function outstandingItemsCsv(items: AuditItem[]): string {
  const rows = items.filter((i) => ["missing", "overdue", "awaiting_review", "due_soon"].includes(i.status));
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["Area", "Requirement", "Critical", "For", "Status", "Due", "Next action"];
  const lines = rows.map((i) =>
    [
      AREA_LABELS[i.area],
      i.title,
      i.critical ? "Yes" : "No",
      i.subject_name,
      STATUS_LABELS[i.status],
      i.due_date ?? "",
      i.next_action,
    ]
      .map((v) => escape(String(v)))
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
