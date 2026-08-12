import { workerFetch } from "@/lib/worker-fetch";

export type PrivacyOverview = {
  data_categories: Array<{
    id: string;
    title: string;
    description: string;
    retention: string;
  }>;
  analytics_opt_out: boolean;
  privacy_policy: {
    version: string;
    summary_text: string;
    full_pdf_path?: string | null;
    published_at?: string | null;
  };
};

export type PrivacyPolicyVersion = {
  version: string;
  published_at: string;
  is_current?: boolean;
};

export function getPrivacyOverview() {
  return workerFetch<PrivacyOverview>("/api/worker/privacy");
}

export function listPrivacyPolicyVersions() {
  return workerFetch<{ versions: PrivacyPolicyVersion[] }>("/api/worker/privacy/policy/versions");
}

export function setAnalyticsOptOut(optOut: boolean) {
  return workerFetch<{ analytics_opt_out: boolean }>("/api/worker/privacy/analytics-opt-out", {
    method: "PATCH",
    body: JSON.stringify({ analytics_opt_out: optOut }),
  });
}

export function requestDataExport() {
  return workerFetch<{ message: string; download_path?: string; expires_at?: string }>(
    "/api/worker/privacy/export",
    { method: "POST" },
  );
}

export function requestAccountDeletion(confirmationText: string) {
  return workerFetch<{ success: boolean; message: string }>("/api/worker/privacy/deletion-request", {
    method: "POST",
    body: JSON.stringify({ confirmation_text: confirmationText }),
  });
}
