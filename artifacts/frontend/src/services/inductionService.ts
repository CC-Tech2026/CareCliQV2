import { jsonFetch } from "@/services/http";

export type InductionItem = {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  content_url?: string | null;
  is_mandatory: boolean;
  sort_order: number;
  is_active: boolean;
  completed_at?: string | null;
};

export type InductionProgress = {
  items: InductionItem[];
  mandatory_total: number;
  mandatory_complete: number;
};

export function getMyInduction() {
  return jsonFetch<InductionProgress>("/api/onboarding/me/induction");
}

export function completeMyInductionItem(itemId: string) {
  return jsonFetch<{ id: string; item_id: string; completed_at: string }>(
    `/api/onboarding/me/induction/${encodeURIComponent(itemId)}/complete`,
    { method: "POST" },
  );
}

export function getMyWelcomeStatus() {
  return jsonFetch<{ welcome_seen_at: string | null }>("/api/onboarding/me/welcome");
}

export function markMyWelcomeSeen() {
  return jsonFetch<{ welcome_seen_at: string | null }>("/api/onboarding/me/welcome-seen", {
    method: "POST",
  });
}

export function getInductionItems() {
  return jsonFetch<InductionItem[]>("/api/coordinator/induction-items");
}

export type OnboardingStage = "interview" | "offer_letter" | "credentials" | "training" | "active";

export type OnboardingStageStep = {
  key: OnboardingStage;
  label: string;
  status: "complete" | "current" | "upcoming";
};

export type MyPipeline = {
  current_stage: OnboardingStage;
  stages: OnboardingStageStep[];
  outstanding_items: string[];
  deactivated: boolean;
};

export function getMyPipeline() {
  return jsonFetch<MyPipeline>("/api/onboarding/me/pipeline");
}

export function getMyCompletionStatus() {
  return jsonFetch<{ onboarding_completed: boolean; onboarding_completed_seen_at: string | null }>(
    "/api/onboarding/me/completion-status",
  );
}

export function markMyCompletionSeen() {
  return jsonFetch<{ onboarding_completed_seen_at: string | null }>("/api/onboarding/me/completion-seen", {
    method: "POST",
  });
}

export function createInductionItem(payload: {
  title: string;
  description?: string;
  content_url?: string;
  is_mandatory?: boolean;
  sort_order?: number;
}) {
  return jsonFetch<InductionItem>("/api/coordinator/induction-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateInductionItem(
  itemId: string,
  payload: Partial<{
    title: string;
    description: string | null;
    content_url: string | null;
    is_mandatory: boolean;
    sort_order: number;
    is_active: boolean;
  }>,
) {
  return jsonFetch<InductionItem>(`/api/coordinator/induction-items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getWorkerInduction(workerId: string) {
  return jsonFetch<InductionProgress>(`/api/coordinator/workers/${encodeURIComponent(workerId)}/induction`);
}
