import { jsonFetch } from "@/services/http";
import type { BugReportAttachment } from "@/services/bugReportService";

export type OrgStatus = "active" | "suspended" | "offboarded";

// Which service(s) a provider delivers — set by a Super Admin from the
// Providers list, not at signup. Distinct from provider_type (NDIS
// registration status — Registered NDIS Provider, Support Coordination
// Provider, etc.) — see 189_organization_org_type.sql for why these
// are two separate fields, not one.
export type OrgType = "aged_care" | "disability" | "aged_care_disability";

export type AdminOrgSummary = {
  organization_id: string;
  display_name: string;
  provider_type?: string | null;
  org_type?: OrgType | null;
  status: OrgStatus;
  plan_tier?: string | null;
  team_size?: string | null;
  participant_volume?: string | null;
  created_at?: string | null;
  user_count: number;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
};

export type AdminOrgUser = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  created_at?: string | null;
  last_login?: string | null;
};

export type AdminOrgDetail = AdminOrgSummary & {
  users: AdminOrgUser[];
};

export function listAdminOrganizations() {
  return jsonFetch<AdminOrgSummary[]>("/api/admin/organizations");
}

export function getAdminOrganization(organizationId: string) {
  return jsonFetch<AdminOrgDetail>(`/api/admin/organizations/${organizationId}`);
}

export function suspendAdminOrganization(organizationId: string) {
  return jsonFetch<{ ok: boolean; status: OrgStatus; sessions_revoked: number }>(
    `/api/admin/organizations/${organizationId}/suspend`,
    { method: "POST" },
  );
}

export function activateAdminOrganization(organizationId: string) {
  return jsonFetch<{ ok: boolean; status: OrgStatus }>(
    `/api/admin/organizations/${organizationId}/activate`,
    { method: "POST" },
  );
}

export function updateAdminOrganizationType(organizationId: string, orgType: OrgType) {
  return jsonFetch<{ ok: boolean; org_type: OrgType }>(
    `/api/admin/organizations/${organizationId}/org-type`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_type: orgType }),
    },
  );
}

export type BugReportStatus = "open" | "in_progress" | "resolved";
export type BugReportSeverity = "low" | "medium" | "urgent";

export type AdminBugReportAttachment = {
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  url: string | null; // signed, generated fresh on each list call — never store/cache
};

// No reporter_id/reporter_name — the backend deliberately never sends who
// reported it (see admin.py's list_bug_reports, include_reporter=False). A
// report is identified by which org hit it, never which staff member did.
//
// organization_id/organization_name are nullable — an admin can file a
// report as "Internal" (not on behalf of any provider), which has no org
// at all; the backend renders that as organization_name "Internal —
// Master Portal" rather than leaving it blank (see admin.py).
export type AdminBugReport = {
  id: string;
  organization_id: string | null;
  organization_name: string;
  page_url: string | null;
  description: string;
  status: BugReportStatus;
  severity: BugReportSeverity;
  jira_issue_key: string | null;
  jira_url: string | null;
  attachments: AdminBugReportAttachment[];
  created_at: string;
  updated_at: string;
};

export function listAdminBugReports() {
  return jsonFetch<AdminBugReport[]>("/api/admin/bug-reports");
}

export function updateAdminBugReportStatus(reportId: string, status: BugReportStatus) {
  return jsonFetch<{ ok: boolean; status: BugReportStatus }>(
    `/api/admin/bug-reports/${reportId}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
}

// organizationId: null files the report as "Internal" (not on behalf of
// any provider) — see admin.py's POST /admin/bug-reports.
export function createAdminBugReport(
  description: string,
  pageUrl: string,
  attachments: BugReportAttachment[],
  severity: BugReportSeverity,
  organizationId: string | null,
) {
  return jsonFetch<{ id: string; status: string }>("/api/admin/bug-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      page_url: pageUrl,
      attachments,
      severity,
      organization_id: organizationId,
    }),
  });
}

// Same status lifecycle as bug reports (open/in_progress/resolved).
// No jira_issue_key/jira_url here — unlike bug reports, feedback has no
// Jira integration (see backend/app/services/improvement_feedback_service.py).
export type AdminImprovementFeedback = {
  id: string;
  organization_id: string;
  organization_name: string;
  submitted_by: string;
  reporter_name: string;
  description: string;
  status: BugReportStatus;
  created_at: string;
  updated_at: string;
};

export function listAdminImprovementFeedback() {
  return jsonFetch<AdminImprovementFeedback[]>("/api/admin/improvement-feedback");
}

export function updateAdminImprovementFeedbackStatus(feedbackId: string, status: BugReportStatus) {
  return jsonFetch<{ ok: boolean; status: BugReportStatus }>(
    `/api/admin/improvement-feedback/${feedbackId}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
}
