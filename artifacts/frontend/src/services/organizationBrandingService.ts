import { jsonFetch } from "@/services/http";

export type OrganizationBranding = {
  display_name: string | null;
  logo_url: string | null;
  brand_accent_color: string | null;
};

export function getOrganizationBranding() {
  return jsonFetch<OrganizationBranding>("/api/organization/branding");
}

export function updateOrganizationBranding(payload: { display_name?: string; brand_accent_color?: string }) {
  return jsonFetch<OrganizationBranding>("/api/organization/branding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function uploadOrganizationLogo(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return jsonFetch<OrganizationBranding>("/api/organization/branding/logo", {
    method: "POST",
    body: formData,
  });
}

export function removeOrganizationLogo() {
  return jsonFetch<OrganizationBranding>("/api/organization/branding/logo", {
    method: "DELETE",
  });
}
