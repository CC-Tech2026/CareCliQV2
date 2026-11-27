import { jsonFetch } from "@/services/http";
import type { BugReportAttachment } from "@/services/bugReportService";

export type ProviderInvitation = {
  id: string; organization_id: string; organization_name: string; email: string;
  expires_at: string; accepted_at: string | null; created_at: string;
};
export type ProviderSetupResult = {
  invite_url: string; email_delivery: { status: string; message: string };
};
export const listProviderInvitations = () => jsonFetch<ProviderInvitation[]>("/api/admin/provider-invitations");
export const createProviderAccount = (organization_name: string, email: string) =>
  jsonFetch<ProviderSetupResult>("/api/admin/provider-invitations", {
    method: "POST", body: JSON.stringify({ organization_name, email }),
  });
export const resendProviderInvitation = (id: string) =>
  jsonFetch<ProviderSetupResult>(`/api/admin/provider-invitations/${id}/resend`, { method: "POST" });

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
  // Account health (admin_console_service.snapshots)
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  subscription_lapsed_at?: string | null;
  access_override_until?: string | null;
  access_override_reason?: string | null;
  access?: { state: "full" | "grace" | "read_only"; grace_ends_at?: string | null };
  billing_label?: string;
  active_user_count?: number;
  last_sign_in_at?: string | null;
  md_signed_in?: boolean;
  participant_count?: number;
  held_staff_count?: number;
  attention?: AttentionItem[];
};

export type AttentionSeverity = "urgent" | "soon" | "info";
export type AttentionItem = {
  code: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  action: string;
};

export type AdminOrgUser = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  deactivation_reason?: string | null;
  created_at?: string | null;
  last_login?: string | null;
};

export type AdminPendingInvite = { id: string; email: string; role: string; created_at: string; expires_at: string };
export type HeldStaff = { id: string; email: string; full_name: string | null; role: string; source_system: string | null; created_at: string };
export type AdminActivity = {
  action_type: string;
  actor_name: string;
  after_state: Record<string, unknown> | null;
  details: { reason?: string } | null;
  created_at: string;
};

export type AdminOrgDetail = AdminOrgSummary & {
  users: AdminOrgUser[];
  pending_invitations: AdminPendingInvite[];
  held_staff: HeldStaff[];
  admin_activity: AdminActivity[];
};

const json = (body: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type SubscriptionChange = {
  plan_tier?: "small" | "medium";
  /** ISO date; "" ends free access now. */
  access_override_until?: string;
  access_override_reason?: string;
  reason: string;
};

export const updateAdminSubscription = (orgId: string, change: SubscriptionChange) =>
  jsonFetch<{ ok: boolean }>(`/api/admin/organizations/${orgId}/subscription`, { method: "PATCH", ...json(change) });

export const extendAdminTrial = (orgId: string, days: number, reason: string) =>
  jsonFetch<{ ok: boolean; trial_ends_at: string }>(`/api/admin/organizations/${orgId}/extend-trial`, {
    method: "POST", ...json({ days, reason }),
  });

export const deactivateAdminUser = (orgId: string, userId: string, reason: string) =>
  jsonFetch<{ ok: boolean }>(`/api/admin/organizations/${orgId}/users/${userId}/deactivate`, { method: "POST", ...json({ reason }) });

export const reactivateAdminUser = (orgId: string, userId: string, reason: string) =>
  jsonFetch<{ ok: boolean }>(`/api/admin/organizations/${orgId}/users/${userId}/reactivate`, { method: "POST", ...json({ reason }) });

export const sendAdminPasswordReset = (orgId: string, userId: string) =>
  jsonFetch<{ ok: boolean }>(`/api/admin/organizations/${orgId}/users/${userId}/password-reset`, { method: "POST" });

export const changeAdminUserRole = (orgId: string, userId: string, role: "support_worker" | "support_coordinator", reason: string) =>
  jsonFetch<{ ok: boolean }>(`/api/admin/organizations/${orgId}/users/${userId}/role`, { method: "PATCH", ...json({ role, reason }) });

export const discardAdminHeldStaff = (orgId: string) =>
  jsonFetch<{ discarded: number }>(`/api/admin/organizations/${orgId}/held-staff/discard`, { method: "POST" });

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
