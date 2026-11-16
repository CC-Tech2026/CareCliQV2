import { getMobileApiBaseUrl } from "@/lib/api-base-url";
import { workerFetch } from "@/lib/worker-fetch";

export type CalendarFeedStatus = {
  active: boolean;
  created_at: string | null;
  /** When the worker's calendar app last fetched the link. */
  last_accessed_at: string | null;
};

export function getCalendarFeedStatus() {
  return workerFetch<CalendarFeedStatus>("/api/worker/calendar/feed");
}

/** A new private link. The old one, if any, stops working. */
export function createCalendarFeed() {
  return workerFetch<{ feed_path: string; token: string; regenerated: boolean }>(
    "/api/worker/calendar/feed-token",
    { method: "POST" },
  );
}

export function stopCalendarFeed() {
  return workerFetch<{ active: false }>("/api/worker/calendar/feed", { method: "DELETE" });
}

export function calendarFeedUrl(feedPath: string): string {
  return `${getMobileApiBaseUrl().replace(/\/$/, "")}${feedPath}`;
}

/** Links that open each calendar app's "subscribe to this calendar" screen. */
export function calendarSubscribeLinks(feedUrl: string) {
  const webcal = feedUrl.replace(/^https?:\/\//, "webcal://");
  const name = encodeURIComponent("CareCliQ shifts");
  return {
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${name}`,
    webcal,
  };
}
