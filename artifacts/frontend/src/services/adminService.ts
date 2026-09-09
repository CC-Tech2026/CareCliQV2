import { jsonFetch } from "@/services/http";

export type OrgStatus = "active" | "suspended" | "offboarded";

export type AdminOrgSummary = {
  organization_id: string;
  display_name: string;
  provider_type?: string | null;
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

export type BugReportStatus = "open" | "in_progress" | "resolved";
export type BugReportSeverity = "low" | "medium" | "urgent";

export type AdminBugReportAttachment = {
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  url: string | null; // signed, generated fresh on each list call — never store/cache
};

export type AdminBugReport = {
  id: string;
  organization_id: string;
  organization_name: string;
  reporter_id: string;
  reporter_name: string;
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

// Same status lifecycle as bug reports (open/in_progress/resolved).
export type AdminImprovementFeedback = {
  id: string;
  organization_id: string;
  organization_name: string;
  submitted_by: string;
  reporter_name: string;
  description: string;
  status: BugReportStatus;
  jira_issue_key: string | null;
  jira_url: string | null;
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
