import { jsonFetch } from "@/services/http";

export type ScheduleRequestType = "time_off" | "preferred_shift" | "shift_swap";
export type ScheduleRequestStatus = "pending" | "approved" | "declined";

export type ScheduleRequest = {
  id: string;
  request_type: ScheduleRequestType;
  status: ScheduleRequestStatus;
  worker_notes?: string | null;
  coordinator_notes?: string | null;
  resolved_at?: string | null;
  created_at: string;
  time_off?: {
    start_date: string;
    end_date: string;
    reason_code: string;
  };
  preferred_shift?: {
    participant_id: string;
    preferred_days: number[];
    participants?: { full_name: string };
  };
  shift_swap?: {
    shift_id: string;
    shift?: {
      scheduled_start?: string;
      scheduled_end?: string;
      participant_name?: string;
    };
  };
};

const REASON_LABELS: Record<string, string> = {
  annual_leave: "Annual leave",
  personal_leave: "Personal leave",
  medical: "Medical",
  family_emergency: "Family emergency",
  other: "Other",
};

export function timeOffReasonLabel(code?: string) {
  return REASON_LABELS[code ?? ""] ?? code ?? "Time off";
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatPreferredDays(days: number[]) {
  return days.map((d) => DAY_LABELS[d - 1] ?? String(d)).join(", ");
}

export function listScheduleRequests(filters?: { request_type?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.request_type) params.set("request_type", filters.request_type);
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString();
  return jsonFetch<{ requests: ScheduleRequest[] }>(
    `/api/worker/schedule-requests${qs ? `?${qs}` : ""}`,
  );
}

export function createTimeOffRequest(body: {
  start_date: string;
  end_date: string;
  reason_code: string;
  worker_notes?: string;
}) {
  return jsonFetch<ScheduleRequest>("/api/worker/schedule-requests/time-off", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createPreferredShiftRequest(body: {
  participant_id: string;
  preferred_days: number[];
  worker_notes?: string;
}) {
  return jsonFetch<ScheduleRequest>("/api/worker/schedule-requests/preferred-shift", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createShiftSwapRequest(body: { shift_id: string; worker_notes?: string }) {
  return jsonFetch<ScheduleRequest>("/api/worker/schedule-requests/shift-swap", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listCoordinatorScheduleRequests(status = "pending", requestType?: string) {
  const params = new URLSearchParams({ status });
  if (requestType) params.set("request_type", requestType);
  return jsonFetch<{ requests: ScheduleRequest[] }>(
    `/api/coordinator/schedule-requests?${params}`,
  );
}

export function resolveCoordinatorScheduleRequest(
  requestId: string,
  body: { status: "approved" | "declined"; coordinator_notes?: string },
) {
  return jsonFetch<ScheduleRequest>(`/api/coordinator/schedule-requests/${requestId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function requestWorkerAvailabilityUpdate(workerId: string) {
  return jsonFetch<{ ok: boolean }>(
    `/api/coordinator/workers/${workerId}/availability/request-update`,
    { method: "POST" },
  );
}
