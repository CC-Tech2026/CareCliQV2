import { jsonFetch } from "@/services/http";

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

export type TutorialProgress = {
  steps: Record<string, { completed_at?: string; skipped?: boolean } | null>;
  completed: boolean;
};

export function getSupportConfig() {
  return jsonFetch<SupportConfig>("/api/worker/help/config");
}

export function searchFaq(q?: string) {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  return jsonFetch<{ articles: FaqArticle[] }>(`/api/worker/help/faq${params}`);
}

export function getKnownIssues() {
  return jsonFetch<{ issues: KnownIssue[] }>("/api/worker/help/known-issues");
}

export function getTutorialProgress() {
  return jsonFetch<TutorialProgress>("/api/worker/help/tutorial");
}

export function completeTutorialStep(stepKey: string, skipped = false) {
  return jsonFetch<TutorialProgress>("/api/worker/help/tutorial/step", {
    method: "POST",
    body: JSON.stringify({ step_key: stepKey, skipped }),
  });
}

export function resetTutorialProgress() {
  return jsonFetch<TutorialProgress>("/api/worker/help/tutorial/reset", { method: "POST" });
}
