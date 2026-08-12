import { workerFetch } from "@/lib/worker-fetch";

export type SupportConfig = {
  support_phone: string;
  support_email: string;
  business_hours_json?: { timezone?: string; weekdays?: string };
  outside_hours_message?: string;
  intercom_app_id?: string | null;
};

export type FaqArticle = {
  slug: string;
  title: string;
  body_markdown: string;
  tags?: string[];
  sort_order?: number;
};

export type KnownIssue = {
  id: string;
  title: string;
  description: string;
  affected_version?: string | null;
  workaround?: string | null;
  expected_fix_date?: string | null;
  updated_at?: string;
};

export function getSupportConfig() {
  return workerFetch<SupportConfig>("/api/worker/help/config");
}

export function searchFaq(q?: string) {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  return workerFetch<{ articles: FaqArticle[] }>(`/api/worker/help/faq${params}`);
}

export function getKnownIssues() {
  return workerFetch<{ issues: KnownIssue[] }>("/api/worker/help/known-issues");
}
