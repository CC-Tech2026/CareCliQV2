import { workerFetch } from "@/lib/worker-fetch";

/** Same API and shapes as the web's NotificationPreferencesEditor
 *  (GET/PUT /api/users/me/notification-preferences). Saving applies to every
 *  device the worker uses, so a choice made here also holds on the web. */

export type NotificationChannel = "push" | "email" | "sms";
export type NotificationPrefs = Record<string, Record<NotificationChannel, boolean>>;
export type QuietHours = { enabled: boolean; from: string; to: string; timezone: string };

type PrefsResponse = {
  device_id: string;
  preferences: NotificationPrefs;
  quiet_hours: Partial<QuietHours> | null;
};

/** The worker's groups, matching WORKER_NOTIF_GROUPS on the web profile page.
 *  Toggling a group sets every backend event in `keys`. */
export const WORKER_NOTIFICATION_GROUPS = [
  { id: "shiftReminders", keys: ["shift_reminder"] },
  { id: "shiftChanges", keys: ["shift_change", "shift_cancel"] },
  { id: "shiftOffers", keys: ["shift_offer"] },
  { id: "messages", keys: ["coordinator_message"] },
  { id: "duringShift", keys: ["task_reminder", "medication_dose_reminder", "long_shift_checkin"] },
  { id: "feedback", keys: ["feedback_received", "shift_feedback_received"] },
  { id: "credentials", keys: ["certification_expiry"] },
  { id: "training", keys: ["training_recommended", "training_request_update"] },
  { id: "team", keys: ["buddy_assigned", "availability_update_requested"] },
] as const;

export type WorkerNotificationGroupId = (typeof WORKER_NOTIFICATION_GROUPS)[number]["id"];

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export async function getNotificationPreferences(deviceId: string) {
  const data = await workerFetch<PrefsResponse>(
    `/api/users/me/notification-preferences?device_id=${encodeURIComponent(deviceId)}`,
  );
  const quiet: QuietHours = {
    enabled: data.quiet_hours?.enabled ?? false,
    from: data.quiet_hours?.from || "22:00",
    to: data.quiet_hours?.to || "07:00",
    timezone: data.quiet_hours?.timezone || deviceTimezone(),
  };
  return { preferences: data.preferences, quietHours: quiet };
}

export function saveNotificationPreferences(deviceId: string, preferences: NotificationPrefs, quietHours: QuietHours) {
  // Saved in this phone's zone, so 22:00 means 22:00 where the worker is.
  return workerFetch<PrefsResponse>("/api/users/me/notification-preferences", {
    method: "PUT",
    body: JSON.stringify({
      device_id: deviceId,
      preferences,
      quiet_hours: { ...quietHours, timezone: deviceTimezone() || quietHours.timezone },
    }),
  });
}

export type TestNotificationResult = {
  app: { devices: number; delivered: number; enabled: boolean };
  browser: { devices: number; delivered: number; enabled: boolean };
};

/** POST /api/notifications/devices/test: one test to every device the worker has. */
export function sendTestNotification() {
  return workerFetch<TestNotificationResult>("/api/notifications/devices/test", { method: "POST" });
}
