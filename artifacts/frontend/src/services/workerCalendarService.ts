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

export type CalendarFeedStatus = {
  active: boolean;
  created_at: string | null;
  /** When the worker's calendar app last fetched the link. */
  last_accessed_at: string | null;
};

export function getCalendarFeedStatus() {
  return jsonFetch<CalendarFeedStatus>("/api/worker/calendar/feed");
}

export function stopCalendarFeed() {
  return jsonFetch<{ active: false }>("/api/worker/calendar/feed", { method: "DELETE" });
}

/** The feed's full https address. It's served by the API, which is on a
 *  different host from the website in production, so the website's own
 *  origin would only return the web app. */
export function calendarFeedUrl(feedPath: string, apiBase: string | undefined = import.meta.env.VITE_API_URL) {
  const base = (apiBase || window.location.origin).replace(/\/$/, "");
  return `${base}${feedPath}`;
}

/** Links that open each calendar app's "subscribe to this calendar" screen. */
export function calendarSubscribeLinks(feedUrl: string) {
  const webcal = feedUrl.replace(/^https?:\/\//, "webcal://");
  const name = encodeURIComponent("CareCliQ shifts");
  return {
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlookPersonal: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${name}`,
    outlookWork: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${name}`,
    webcal,
  };
}
