import { jsonFetch } from "@/services/http";

export type ChecklistItem = {
  key: string;
  label: string;
  completed: boolean;
};

export type OnboardingState = {
  items: ChecklistItem[];
  completed: boolean;
  profile_completed?: boolean;
  email_verified?: boolean;
  role_specific_profile_completed?: boolean;
};

const LABELS: Record<string, string> = {
  verify_email: "Verify email",
  complete_profile: "Complete profile details",
  upload_profile_photo: "Upload profile photo",
  add_credential_wallet_items: "Add credential wallet items",
  complete_mandatory_training: "Complete mandatory training",
  review_assigned_clients: "Review assigned clients",
  read_ndis_note_writing_guide: "Read NDIS note-writing guide",
  acknowledge_note_writing_rules: "Acknowledge note-writing rules",
  confirm_readiness: "Confirm readiness",
};

/** Exported so coordinator-facing views (e.g. WorkerDetail's Overview tab) can show which
 * specific step a worker is currently on, instead of just a done/not-done boolean. Order
 * matches backend WORKER_CHECKLIST_DEFAULTS (backend/app/api/onboarding.py) exactly. */
export const CHECKLIST_STEP_ORDER = Object.keys(LABELS);
export const CHECKLIST_LABELS = LABELS;

function toItems(checklist: Record<string, boolean>): ChecklistItem[] {
  return Object.entries(checklist || {}).map(([key, completed]) => ({
    key,
    label: LABELS[key] || key.replace(/_/g, " "),
    completed: Boolean(completed),
  }));
}

function toChecklist(items: ChecklistItem[]) {
  return Object.fromEntries(items.map((item) => [item.key, item.completed]));
}

export async function getMyOnboarding(): Promise<OnboardingState> {
  const raw = await jsonFetch<{ checklist: Record<string, boolean>; onboarding_completed?: boolean }>("/api/onboarding/me");
  return {
    items: toItems(raw.checklist),
    completed: Boolean(raw.onboarding_completed),
  };
}

export async function updateMyOnboarding(items: ChecklistItem[]): Promise<OnboardingState> {
  const raw = await jsonFetch<{ checklist: Record<string, boolean>; onboarding_completed?: boolean }>("/api/onboarding/me", {
    method: "PATCH",
    body: JSON.stringify({ checklist: toChecklist(items) }),
  });
  return {
    items: toItems(raw.checklist),
    completed: Boolean(raw.onboarding_completed),
  };
}

export async function completeMyOnboarding(): Promise<{ completed: boolean; items: ChecklistItem[] }> {
  const raw = await jsonFetch<{ checklist: Record<string, boolean>; onboarding_completed?: boolean }>("/api/onboarding/me/complete", {
    method: "POST",
  });
  return { completed: Boolean(raw.onboarding_completed), items: toItems(raw.checklist) };
}

export async function getTeamOnboarding() {
  return jsonFetch<Array<Record<string, unknown>>>("/api/onboarding/team");
}

export type FinancialDetails = {
  bank_account_name?: string | null;
  bank_bsb?: string | null;
  bank_account_number?: string | null;
  super_fund_name?: string | null;
  super_member_number?: string | null;
  tax_file_number?: string | null;
};

export async function getMyFinancialDetails(): Promise<FinancialDetails> {
  return jsonFetch<FinancialDetails>("/api/onboarding/me/financial-details");
}

export async function updateMyFinancialDetails(details: FinancialDetails): Promise<FinancialDetails> {
  return jsonFetch<FinancialDetails>("/api/onboarding/me/financial-details", {
    method: "PUT",
    body: JSON.stringify(details),
  });
}
