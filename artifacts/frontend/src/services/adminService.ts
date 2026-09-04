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
