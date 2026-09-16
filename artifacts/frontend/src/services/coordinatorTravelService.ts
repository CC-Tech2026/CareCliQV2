import { jsonFetch } from "@/services/http";

export type TravelSubmissionExpense = {
  id: string;
  expense_type: string;
  amount_cents: number;
  claimed_km?: number | null;
  transit_type?: string | null;
  shift_id: string;
};

export type TravelSubmission = {
  id: string;
  worker_id: string;
  worker_name: string;
  total_amount_cents: number;
  status: string;
  submitted_at: string;
  expenses: TravelSubmissionExpense[];
  /** The submitting worker's own branch zone. */
  timezone?: string | null;
};

export function getCoordinatorTravelSubmissions() {
  return jsonFetch<{ submissions: TravelSubmission[] }>("/api/coordinator/travel/submissions");
}

export function getCoordinatorTravelSettings() {
  return jsonFetch<{ mileage_rate_cents: number; rate_display: string; currency: string }>(
    "/api/coordinator/travel/settings",
  );
}

export function updateCoordinatorTravelRate(mileage_rate_cents: number) {
  return jsonFetch<{ mileage_rate_cents: number; rate_display: string }>(
    "/api/coordinator/travel/settings",
    {
      method: "PUT",
      body: JSON.stringify({ mileage_rate_cents }),
    },
  );
}

export function actionTravelSubmission(
  submissionId: string,
  payload: { approve: boolean; rejection_reason?: string; mark_paid?: boolean },
) {
  return jsonFetch<{ submission_id: string; status: string }>(
    `/api/coordinator/travel/submissions/${submissionId}/action`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}
