import { jsonFetch } from "@/services/http";

export function getOrganizationAbbrevStatus() {
  return jsonFetch<{ org_abbrev: string | null }>("/api/organization/abbrev");
}

export function checkOrganizationAbbrevAvailable(value: string) {
  return jsonFetch<{ available: boolean }>(`/api/organization/abbrev/check?value=${encodeURIComponent(value)}`);
}

export function setOrganizationAbbrev(orgAbbrev: string) {
  return jsonFetch<{ org_abbrev: string; backfilled_count: number }>("/api/organization/abbrev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ org_abbrev: orgAbbrev }),
  });
}
