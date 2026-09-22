import { apiFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";

export type MileageEstimate = {
  shift_id: string;
  home_address_set: boolean;
  destination_address?: string | null;
  rate_cents: number;
  rate_display: string;
  distance_km?: number | null;
  distance_text?: string | null;
  estimated_amount_cents?: number | null;
  available: boolean;
  reason?: string | null;
  navigation_url?: string | null;
  draft_mileage?: {
    id: string;
    claimed_km?: number | null;
    calculated_km?: number | null;
    amount_cents: number;
    status: string;
    created_at?: string | null;
  } | null;
};

export type TravelExpense = {
  id: string;
  shift_id: string;
  expense_type: "mileage" | "transit";
  status: string;
  claimed_km?: number | null;
  calculated_km?: number | null;
  amount_cents: number;
  transit_type?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  paid_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  correction_of_id?: string | null;
  /** The worker's own branch zone. */
  timezone?: string | null;
};

export function getShiftTransitDraft(shiftId: string) {
  return jsonFetch<{
    draft_transit: {
      id: string;
      amount_cents: number;
      transit_type: string;
      receipt_storage_path?: string | null;
      status: string;
    } | null;
  }>(`/api/worker/travel/shifts/${shiftId}/transit-draft`);
}

export function getRejectedTravelExpenses() {
  return jsonFetch<{ items: TravelExpense[] }>("/api/worker/travel/rejected");
}

export async function requestTravelCorrection(
  expenseId: string,
  payload: { claimed_km?: number; amount_cents?: number; transit_type?: string; receipt?: File },
) {
  const form = new FormData();
  if (payload.claimed_km != null) form.append("claimed_km", String(payload.claimed_km));
  if (payload.amount_cents != null) form.append("amount_cents", String(payload.amount_cents));
  if (payload.transit_type) form.append("transit_type", payload.transit_type);
  if (payload.receipt) form.append("receipt", payload.receipt);

  const response = await apiFetch(`/api/worker/travel/expenses/${expenseId}/correction`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not create correction.");
  }
  return response.json() as Promise<TravelExpense>;
}

export function getTravelRate() {
  return jsonFetch<{ rate_cents: number; rate_display: string; currency: string }>(
    "/api/worker/travel/rate",
  );
}

export function getShiftMileageEstimate(shiftId: string) {
  return jsonFetch<MileageEstimate>(`/api/worker/travel/shifts/${shiftId}/mileage-estimate`);
}

export function saveMileageExpense(shiftId: string, claimed_km: number, calculated_km?: number) {
  return jsonFetch<TravelExpense>(`/api/worker/travel/shifts/${shiftId}/mileage`, {
    method: "POST",
    body: JSON.stringify({ claimed_km, calculated_km }),
  });
}

export async function saveTransitExpense(
  shiftId: string,
  payload: { amount_cents: number; transit_type: string; receipt?: File },
) {
  const form = new FormData();
  form.append("amount_cents", String(payload.amount_cents));
  form.append("transit_type", payload.transit_type);
  if (payload.receipt) form.append("receipt", payload.receipt);
  const response = await apiFetch(`/api/worker/travel/shifts/${shiftId}/transit`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not save transit expense.");
  }
  return response.json() as Promise<TravelExpense>;
}

export function getTravelDrafts() {
  return jsonFetch<{ drafts: TravelExpense[] }>("/api/worker/travel/drafts");
}

export function submitTravelExpenses() {
  return jsonFetch<{ submission_id: string; total_amount_cents: number; expense_count: number }>(
    "/api/worker/travel/submit",
    { method: "POST", body: JSON.stringify({ confirm: true }) },
  );
}

export function getTravelSummary() {
  return jsonFetch<{
    months: Array<{
      month: string;
      claimed_cents: number;
      approved_cents: number;
      paid_cents: number;
      items: TravelExpense[];
    }>;
  }>("/api/worker/travel/summary");
}

export async function downloadTravelTaxCsv() {
  const { apiFetch } = await import("@/lib/api-fetch");
  const response = await apiFetch("/api/worker/travel/export/csv");
  if (!response.ok) throw new Error("Export failed.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "travel-expenses-tax.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
