import { jsonFetch } from "@/services/http";

export type AccessGrantCapability = {
  capability: string;
  label: string;
};

export type AccessGrantStatus = "active" | "expired" | "revoked";

export type AccessGrant = {
  id: string;
  organization_id: string;
  granted_to_user_id: string;
  granted_by_user_id: string | null;
  capability: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  reason: string | null;
  created_at: string;
  status: AccessGrantStatus;
};

export function getGrantableCapabilities() {
  return jsonFetch<AccessGrantCapability[]>("/api/md/access-grants/capabilities");
}

export function listAccessGrants() {
  return jsonFetch<AccessGrant[]>("/api/md/access-grants");
}

export function createAccessGrant(payload: {
  granted_to_user_id: string;
  capability: string;
  expires_at: string;
  reason?: string;
}) {
  return jsonFetch<AccessGrant>("/api/md/access-grants", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function revokeAccessGrant(grantId: string) {
  return jsonFetch<AccessGrant>(`/api/md/access-grants/${grantId}/revoke`, {
    method: "POST",
  });
}

export function listMyAccessGrants() {
  return jsonFetch<AccessGrant[]>("/api/me/access-grants");
}
