import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Linking, Platform } from "react-native";

import type { CheckinWindowStatus } from "@/lib/worker-api";

const CHECKIN_NOTIF_PREFIX = "compliance-checkin-";
const CHANNEL_ID = "safety-alerts";
const FIRED_IDS_KEY = "ccq_checkin_local_fired_ids";
const EXACT_ALARM_PROMPTED_KEY = "ccq_exact_alarm_prompted";

/** Sync in-memory set so clear + sync can't race via AsyncStorage. */
const firedMemory = new Set<string>();

type NotificationsModule = typeof import("expo-notifications");

function isExpoGo(): boolean {
  return (
    Constants.appOwnership === "expo" ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Constants as any).executionEnvironment === "storeClient"
  );
}

async function loadNotifications(): Promise<NotificationsModule | null> {
  // Scheduling APIs are native-only (not available on web).
  if (Platform.OS === "web" || isExpoGo()) return null;
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}

function notifId(scheduledCheckinId: string): string {
  return `${CHECKIN_NOTIF_PREFIX}${scheduledCheckinId}`;
}

async function readFiredIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(FIRED_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === "string") firedMemory.add(v);
        }
      }
    }
  } catch {
    /* keep memory set */
  }
  return new Set(firedMemory);
}

async function writeFiredIds(ids: Set<string>): Promise<void> {
  for (const id of ids) firedMemory.add(id);
  const trimmed = [...firedMemory].slice(-80);
  await AsyncStorage.setItem(FIRED_IDS_KEY, JSON.stringify(trimmed));
}

async function markFired(scheduledCheckinId: string): Promise<void> {
  firedMemory.add(scheduledCheckinId);
  const ids = await readFiredIds();
  ids.add(scheduledCheckinId);
  await writeFiredIds(ids);
}

/** Synchronous so callers can block re-schedule before async IO finishes. */
export function markLocalCheckinIdsFiredSync(
  scheduledCheckinIds: Array<string | null | undefined>,
): void {
  for (const id of scheduledCheckinIds) {
    if (id) firedMemory.add(id);
  }
}

async function ensureAndroidChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Safety alerts",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 250, 500],
    sound: "default",
    enableVibrate: true,
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Android 12+ needs Alarms & reminders enabled or DATE triggers fall back to
 * inexact alarms that can miss a 5-minute compliance window while backgrounded.
 */
async function ensureAndroidExactAlarmAccess(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const already = await AsyncStorage.getItem(EXACT_ALARM_PROMPTED_KEY);
    if (already) return;
    const pkg = Constants.expoConfig?.android?.package ?? "care.cliq2026";
    try {
      await Linking.sendIntent("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", [
        { key: "android.provider.extra.APP_PACKAGE", value: pkg },
      ]);
    } catch {
      try {
        await Linking.openURL(`package:${pkg}`);
      } catch {
        await Linking.openSettings();
      }
    }
    await AsyncStorage.setItem(EXACT_ALARM_PROMPTED_KEY, "1");
  } catch {
    /* settings UI optional — still attempt inexact schedule */
  }
}

async function ensureNotificationPermission(
  Notifications: NotificationsModule,
): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

function notificationContent(
  Notifications: NotificationsModule,
  params: {
    shiftId: string;
    sessionId?: string | null;
    scheduledCheckinId: string;
  },
) {
  return {
    title: "Compliance Check-in Required",
    body: "Please complete your compliance check-in within 5 minutes.",
    sound: true as const,
    priority: Notifications.AndroidNotificationPriority.MAX,
    ...(Platform.OS === "android"
      ? {
          channelId: CHANNEL_ID,
          sticky: true,
        }
      : {}),
    data: {
      type: "compliance_checkin",
      shift_id: params.shiftId,
      session_id: params.sessionId ?? "",
      scheduled_checkin_id: params.scheduledCheckinId,
      action_url: `/my-shifts/${params.shiftId}`,
    },
  };
}

function coerceDataString(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isComplianceCheckinPresented(item: {
  request: { identifier: string; content: { data?: unknown; title?: string | null } };
}): boolean {
  const identifier = item.request.identifier ?? "";
  if (identifier.startsWith(CHECKIN_NOTIF_PREFIX)) return true;
  const raw = item.request.content.data;
  const data =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
  const type = coerceDataString(data, "type");
  if (type === "compliance_checkin") return true;
  const title = item.request.content.title ?? "";
  return title === "Compliance Check-in Required";
}

/** Dismiss every compliance check-in currently in the system tray (local + FCM). */
export async function dismissPresentedComplianceCheckinNotifications(
  shiftId?: string | null,
): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  let presented: Awaited<ReturnType<NotificationsModule["getPresentedNotificationsAsync"]>> = [];
  try {
    presented = await Notifications.getPresentedNotificationsAsync();
  } catch {
    return;
  }

  for (const item of presented) {
    if (!isComplianceCheckinPresented(item)) continue;

    const raw = item.request.content.data;
    const data =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
    const itemShiftId = coerceDataString(data, "shift_id");
    if (shiftId && itemShiftId && itemShiftId !== shiftId) continue;

    const scheduledId =
      coerceDataString(data, "scheduled_checkin_id") ??
      (item.request.identifier.startsWith(CHECKIN_NOTIF_PREFIX)
        ? item.request.identifier.slice(CHECKIN_NOTIF_PREFIX.length)
        : null);

    try {
      await Notifications.dismissNotificationAsync(item.request.identifier);
    } catch {
      /* already gone */
    }
    if (scheduledId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notifId(scheduledId));
      } catch {
        /* ignore */
      }
      await markFired(scheduledId);
    }
  }
}

/** Cancel + dismiss a check-in notification after the worker opens or completes it. */
export async function clearLocalCheckinNotification(
  scheduledCheckinId: string | null | undefined,
  options?: { shiftId?: string | null },
): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) {
    if (scheduledCheckinId) await markFired(scheduledCheckinId);
    return;
  }

  if (scheduledCheckinId) {
    const id = notifId(scheduledCheckinId);
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* already gone */
    }
    try {
      await Notifications.dismissNotificationAsync(id);
    } catch {
      /* already gone */
    }
    await markFired(scheduledCheckinId);
  }

  // FCM / sticky tray entries often use a different identifier — clear by content.
  await dismissPresentedComplianceCheckinNotifications(options?.shiftId);
}

/**
 * After check-in is opened or submitted: clear tray, cancel schedules, and mark
 * every known upcoming id fired so sync cannot re-post the same alarm.
 */
export async function clearShiftComplianceCheckinNotifications(params: {
  shiftId: string;
  scheduledCheckinId?: string | null;
  upcomingCheckinIds?: Array<string | null | undefined>;
}): Promise<void> {
  const ids = new Set<string>();
  if (params.scheduledCheckinId) ids.add(params.scheduledCheckinId);
  for (const id of params.upcomingCheckinIds ?? []) {
    if (id) ids.add(id);
  }

  // Block sync re-posts immediately (before AsyncStorage / dismiss finish).
  markLocalCheckinIdsFiredSync([...ids]);

  const Notifications = await loadNotifications();
  if (Notifications) {
    for (const id of ids) {
      const localId = notifId(id);
      try {
        await Notifications.cancelScheduledNotificationAsync(localId);
      } catch {
        /* already gone */
      }
      try {
        await Notifications.dismissNotificationAsync(localId);
      } catch {
        /* already gone */
      }
      await markFired(id);
    }
  } else {
    for (const id of ids) {
      await markFired(id);
    }
  }

  // Sweep tray for FCM / sticky entries that use a different identifier.
  await dismissPresentedComplianceCheckinNotifications(params.shiftId);
}

/** Mark a check-in alarm as already delivered so sync won't recreate it. */
export async function markLocalCheckinNotificationFired(
  scheduledCheckinId: string | null | undefined,
): Promise<void> {
  if (!scheduledCheckinId) return;
  await markFired(scheduledCheckinId);
}

/** Schedule device-local check-in alarms so they fire even when the phone is offline. */
export async function syncLocalCheckinNotifications(params: {
  shiftId: string;
  sessionId?: string | null;
  checkinStatus?: CheckinWindowStatus | null;
  shiftActive: boolean;
}): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const { shiftId, sessionId, checkinStatus, shiftActive } = params;
  const upcoming = checkinStatus?.upcoming_checkins ?? [];
  const fired = await readFiredIds();

  const keepIds = new Set(
    upcoming
      .map((item) => (item.id ? notifId(item.id) : ""))
      .filter(Boolean),
  );

  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of existing) {
    if (!item.identifier.startsWith(CHECKIN_NOTIF_PREFIX)) continue;
    // Drop stale / already-fired schedules. Keep future ones only if still upcoming.
    const checkinId = item.identifier.slice(CHECKIN_NOTIF_PREFIX.length);
    if (fired.has(checkinId) || !keepIds.has(item.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  }

  if (!shiftActive || !checkinStatus?.applicable || !upcoming.length) {
    return;
  }

  const granted = await ensureNotificationPermission(Notifications);
  if (!granted) return;

  await ensureAndroidChannel(Notifications);
  await ensureAndroidExactAlarmAccess();

  const now = Date.now();
  const existingIds = new Set(
    (await Notifications.getAllScheduledNotificationsAsync())
      .map((item) => item.identifier)
      .filter((id) => id.startsWith(CHECKIN_NOTIF_PREFIX)),
  );

  for (const item of upcoming) {
    if (!item.id || !item.scheduled_at) continue;
    if (fired.has(item.id)) continue;

    const when = new Date(item.scheduled_at).getTime();
    if (Number.isNaN(when)) continue;

    const id = notifId(item.id);
    const content = notificationContent(Notifications, {
      shiftId,
      sessionId,
      scheduledCheckinId: item.id,
    });

    // Still in the future — schedule an exact wake-up alarm.
    if (when > now) {
      if (existingIds.has(id)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(when),
          channelId: CHANNEL_ID,
        },
      });
      continue;
    }

    // Already due / prompted — FCM often misses Android background; fire a local
    // tray notification once so the worker still sees it when the app is backgrounded.
    // Skip when the window is no longer actionable (already checked in / cooldown).
    const stillDue =
      Boolean(checkinStatus?.can_submit_checkin) || Boolean(checkinStatus?.checkin_overdue);
    if (
      stillDue &&
      (item.status === "prompted" || item.status === "pending" || item.status === "due")
    ) {
      if (existingIds.has(id)) {
        try {
          await Notifications.cancelScheduledNotificationAsync(id);
        } catch {
          /* ignore */
        }
      }
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content,
        trigger: null,
      });
      await markFired(item.id);
    }
  }
}

export async function cancelLocalCheckinNotifications(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of existing) {
    if (item.identifier.startsWith(CHECKIN_NOTIF_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  }
}
