import { format, parseISO } from "date-fns";
import { appLocalDateKey, APP_TIMEZONE, formatAppTime } from "@/lib/datetime";
import type { UserNotification } from "@/services/notificationService";

/** Match backend `notification_service._format_shift_time` for payload fallbacks. */
export function formatNotificationShiftTime(iso: string): string {
  try {
    const day = format(parseISO(`${appLocalDateKey(iso)}T12:00:00`), "EEE d MMM yyyy");
    const time = formatAppTime(iso);
    const tz =
      new Intl.DateTimeFormat("en-AU", {
        timeZone: APP_TIMEZONE,
        timeZoneName: "short",
      })
        .formatToParts(new Date(iso))
        .find((part) => part.type === "timeZoneName")?.value ?? "ACST";
    return `${day}, ${time} ${tz}`;
  } catch {
    return iso;
  }
}

export function extractNotificationNewStart(notification: UserNotification): string | null {
  const body = notification.body.trim();
  const fromBody =
    body.match(/New start:\s*(.+?)\.?\s*$/i)?.[1]?.trim()
    ?? body.match(/Now:\s*Start:\s*([^·.]+)/i)?.[1]?.trim()
    ?? body.match(/Shift cancelled:\s*([^,]+)/i)?.[1]?.trim();

  if (fromBody) return fromBody.replace(/\.$/, "");

  const payloadNew = notification.payload?.new as Record<string, unknown> | undefined;
  const scheduledStart = payloadNew?.scheduled_start;
  if (typeof scheduledStart === "string" && scheduledStart) {
    return formatNotificationShiftTime(scheduledStart);
  }

  if (notification.event_type === "shift_cancel") {
    return null;
  }

  return null;
}

/** Short line shown under the prominent new-start time (mobile toast). */
export function extractNotificationSummary(notification: UserNotification): string {
  const body = notification.body.trim();
  const beforeNewStart = body.split(/New start:/i)[0]?.trim() ?? body;
  const beforeWas = beforeNewStart.split(/Was:/i)[0]?.trim() ?? beforeNewStart;
  return beforeWas.replace(/\.\s*$/, "").trim();
}

export function notificationAccentColor(
  bannerStyle: UserNotification["banner_style"],
): { text: string; muted: string; border: string } {
  if (bannerStyle === "red") {
    return { text: "#991B1B", muted: "#B91C1C", border: "#FECACA" };
  }
  if (bannerStyle === "yellow") {
    return { text: "#854D0E", muted: "#A16207", border: "#FDE047" };
  }
  return { text: "#9A3412", muted: "#C2410C", border: "#FDBA74" };
}
