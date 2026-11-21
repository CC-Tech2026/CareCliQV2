import { Platform } from "react-native";
import { workerFetch } from "@/lib/worker-fetch";

/** Travel claims: a car trip (kilometres, checked against the route from
 * home to the participant) or a fare, each with its evidence. Claims are
 * drafts until the worker sends them to the office together. */

export const TRANSIT_TYPES = [
  { value: "bus", label: "Bus" },
  { value: "train", label: "Train" },
  { value: "tram", label: "Tram" },
  { value: "ferry", label: "Ferry" },
  { value: "other", label: "Taxi or other" },
] as const;
export type TransitType = (typeof TRANSIT_TYPES)[number]["value"];

/** Same rules as the server (travel_expense_service.missing_evidence). */
export const RECEIPT_REQUIRED_CENTS = 1000;
const DISTANCE_EXPLAIN_RATIO = 0.1;
const DISTANCE_EXPLAIN_MIN_KM = 1;
export const TRIP_DETAILS_MIN_CHARS = 10;

export type MileageEstimate = {
  shift_id: string;
  home_address_set: boolean;
  destination_address: string | null;
  rate_cents: number;
  rate_display: string;
  distance_km: number | null;
  distance_text?: string | null;
  estimated_amount_cents: number | null;
  available: boolean;
  reason?: string | null;
  draft_mileage?: TravelExpense | null;
};

export type TravelExpense = {
  id: string;
  shift_id: string;
  expense_type: "mileage" | "transit";
  status: "draft" | "submitted" | "approved" | "paid" | "rejected";
  claimed_km?: number | null;
  calculated_km?: number | null;
  amount_cents: number;
  transit_type?: TransitType | null;
  receipt_storage_path?: string | null;
  trip_details?: string | null;
  rejection_reason?: string | null;
  created_at?: string;
  timezone?: string | null;
};

export type EvidencePhoto = { uri: string; name: string; type: string };

export function mileageNeedsExplanation(claimedKm: number, calculatedKm?: number | null): boolean {
  if (!calculatedKm) return true;
  const diff = Math.abs(claimedKm - calculatedKm);
  return diff > DISTANCE_EXPLAIN_MIN_KM && diff / calculatedKm > DISTANCE_EXPLAIN_RATIO;
}

/** What a draft still needs before it can be sent, or null. */
export function missingEvidence(expense: TravelExpense): string | null {
  if (expense.expense_type === "mileage") {
    if (expense.claimed_km == null) return "the distance";
    if (
      mileageNeedsExplanation(Number(expense.claimed_km), expense.calculated_km != null ? Number(expense.calculated_km) : null) &&
      (expense.trip_details ?? "").trim().length < TRIP_DETAILS_MIN_CHARS
    ) {
      return "where you drove and why";
    }
    return null;
  }
  if (expense.amount_cents > RECEIPT_REQUIRED_CENTS && !expense.receipt_storage_path) return "a receipt photo";
  return null;
}

async function appendPhoto(form: FormData, field: string, photo: EvidencePhoto) {
  if (Platform.OS === "web") {
    const blob = await (await fetch(photo.uri)).blob();
    form.append(field, blob, photo.name);
  } else {
    form.append(field, { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
  }
}

export function getShiftMileageEstimate(shiftId: string) {
  return workerFetch<MileageEstimate>(`/api/worker/travel/shifts/${shiftId}/mileage-estimate`);
}

export function getShiftFareDraft(shiftId: string) {
  return workerFetch<{ draft_transit?: TravelExpense | null }>(`/api/worker/travel/shifts/${shiftId}/transit-draft`);
}

export async function saveCarTrip(
  shiftId: string,
  input: { claimedKm: number; calculatedKm?: number | null; tripDetails?: string; photo?: EvidencePhoto | null },
) {
  const form = new FormData();
  form.append("claimed_km", String(input.claimedKm));
  if (input.calculatedKm) form.append("calculated_km", String(input.calculatedKm));
  if (input.tripDetails?.trim()) form.append("trip_details", input.tripDetails.trim());
  if (input.photo) await appendPhoto(form, "evidence", input.photo);
  return workerFetch<TravelExpense>(`/api/worker/travel/shifts/${shiftId}/mileage-claim`, { method: "POST", body: form });
}

export async function saveFare(
  shiftId: string,
  input: { amountCents: number; transitType: TransitType; tripDetails?: string; receipt?: EvidencePhoto | null },
) {
  const form = new FormData();
  form.append("amount_cents", String(input.amountCents));
  form.append("transit_type", input.transitType);
  if (input.tripDetails?.trim()) form.append("trip_details", input.tripDetails.trim());
  if (input.receipt) await appendPhoto(form, "receipt", input.receipt);
  return workerFetch<TravelExpense>(`/api/worker/travel/shifts/${shiftId}/transit`, { method: "POST", body: form });
}

export function getTravelDrafts() {
  return workerFetch<{ drafts: TravelExpense[] }>("/api/worker/travel/drafts");
}

/** A sent claim and where it is. Approved claims are paid with wages. */
export type SentTravelClaim = {
  id: string;
  shift_id?: string | null;
  status: "submitted" | "approved" | "paid" | "rejected";
  kind: "km" | "fares";
  km?: number | null;
  transit_type?: TransitType | null;
  amount_cents: number;
  submitted_at?: string | null;
  approved_at?: string | null;
  paid_at?: string | null;
  rejection_reason?: string | null;
};

export function getSentTravelClaims() {
  return workerFetch<{ claims: SentTravelClaim[] }>("/api/worker/travel/claims");
}

/** Where a sent claim is, in the worker's words. */
export function claimStatus(c: SentTravelClaim): string {
  if (c.status === "paid") return "Paid with your wages";
  if (c.status === "approved") return "Approved: paid in your next pay";
  if (c.status === "rejected") return c.rejection_reason ? `Not approved: ${c.rejection_reason}` : "Not approved";
  return "Waiting for the office to approve";
}

export function sendTravelClaims() {
  return workerFetch<{ submission_id: string; total_amount_cents: number; expense_count: number }>(
    "/api/worker/travel/submit",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) },
  );
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
