import { jsonFetch } from "@/services/http";

export type CalendarShiftStatus = "confirmed" | "tentative" | "cancelled";

export type CalendarShift = {
  id: string;
  participant_id?: string;
  participant_name?: string;
  participant_first_name?: string;
  participant_suburb?: string;
  participant_address?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  status: string;
  confirmation_status?: string;
  calendar_status: CalendarShiftStatus;
  participant_colour?: string;
  visual_state?: string;
  coordinator_notes?: string | null;
  /** Participant's branch zone — the backend already resolves this. */
  timezone?: string | null;
};

export type TimeOffBlock = {
  request_id: string;
  start_date: string;
  end_date: string;
  reason_code?: string;
  label: string;
};

export type WorkerCalendarResponse = {
  shifts: CalendarShift[];
  time_off_blocks: TimeOffBlock[];
  start_date: string;
  end_date: string;
};

export function getWorkerCalendar(startDate: string, endDate: string) {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  return jsonFetch<WorkerCalendarResponse>(`/api/worker/shifts/calendar?${params}`);
}

export function createCalendarFeedToken() {
  return jsonFetch<{ feed_path: string; token: string; regenerated: boolean }>(
    "/api/worker/calendar/feed-token",
    { method: "POST" },
  );
}
