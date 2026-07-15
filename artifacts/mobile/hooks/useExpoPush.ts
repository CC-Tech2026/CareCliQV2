import Constants from "expo-constants";
import { Platform } from "react-native";
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { registerExpoPushToken, registerFcmPushToken } from "@/lib/push-registration";
import { getMobileDeviceId, readMobileAuthToken } from "@/lib/session";

type NotificationsModule = typeof import("expo-notifications");

let notificationsModule: NotificationsModule | null | undefined;

/** Expo Go (SDK 53+) throws on importing expo-notifications for Android push. */
function isExpoGo(): boolean {
  return (
    Constants.appOwnership === "expo" ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Constants as any).executionEnvironment === "storeClient"
  );
}

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (notificationsModule !== undefined) return notificationsModule;
  if (isExpoGo()) {
    notificationsModule = null;
    return null;
  }
  try {
    notificationsModule = await import("expo-notifications");
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    return notificationsModule;
  } catch {
    notificationsModule = null;
    return null;
  }
}

async function ensureNotificationChannels(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "CareCliQ",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync("safety-alerts", {
    name: "Safety alerts",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 250, 500],
    sound: "default",
    enableVibrate: true,
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

async function requestPushPermission(Notifications: NotificationsModule): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/** Native FCM/APNs device token — used by backend firebase-admin (works on emulator + device). */
async function resolveNativeFcmToken(Notifications: NotificationsModule): Promise<string | null> {
  try {
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    const token = deviceToken?.data;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function navigateFromNotificationData(
  router: ReturnType<typeof useRouter>,
  data: Record<string, unknown>,
) {
  const shiftId = coerceString(data.shift_id);
  const notificationType = coerceString(data.type);
  const actionUrl = coerceString(data.action_url);
  const scheduledCheckinId = coerceString(data.scheduled_checkin_id);

  if (notificationType === "compliance_checkin" || scheduledCheckinId) {
    void import("@/lib/local-checkin-notifications").then(({ clearLocalCheckinNotification }) =>
      clearLocalCheckinNotification(scheduledCheckinId),
    );
  }

  if (shiftId) {
    if (notificationType === "compliance_checkin") {
      const q = scheduledCheckinId
        ? `?checkin=pending&scheduled_checkin_id=${encodeURIComponent(scheduledCheckinId)}`
        : "?checkin=pending";
      router.push(`/shift/${shiftId}${q}` as never);
      return true;
    }
    router.push(`/shift/${shiftId}` as never);
    return true;
  }
  if (actionUrl?.includes("/my-shifts/")) {
    const match = actionUrl.match(/\/my-shifts\/([^/?]+)/);
    if (match?.[1]) {
      const q = scheduledCheckinId
        ? `?checkin=pending&scheduled_checkin_id=${encodeURIComponent(scheduledCheckinId)}`
        : "?checkin=pending";
      router.push(`/shift/${match[1]}${q}` as never);
      return true;
    }
  }
  return false;
}

function readNotificationData(
  response: {
    notification: { request: { content: { data?: unknown } } };
  },
): Record<string, unknown> {
  const raw = response.notification.request.content.data;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Requests notification permission on app open, then registers FCM/Expo tokens
 * once the worker is authenticated. Cannot auto-grant (OS requires user tap).
 * No-ops in Expo Go (push requires a development/EAS build on SDK 53+).
 */
export function useExpoPushRegistration(isAuthenticated: boolean) {
  const fcmRegisteredRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let responseSub: { remove: () => void } | null = null;

    async function ensurePermissionAndChannels(
      Notifications: NotificationsModule,
    ): Promise<boolean> {
      const granted = await requestPushPermission(Notifications);
      if (!granted || cancelled) return false;
      await ensureNotificationChannels(Notifications);
      return true;
    }

    async function sync() {
      const Notifications = await loadNotifications();
      if (!Notifications || cancelled) return;

      // Prompt as soon as CareCliQ opens (before / without login).
      const granted = await ensurePermissionAndChannels(Notifications);
      if (!granted || cancelled) return;

      const authToken = await readMobileAuthToken();
      if (!authToken || cancelled) return;

      const deviceId = await getMobileDeviceId();

      // Register FCM and Expo whenever possible. Compliance check-in push tries FCM
      // first, then Expo — skipping Expo after a successful FCM register leaves no
      // fallback when Firebase is disabled/misconfigured on the backend.
      const fcmToken = await resolveNativeFcmToken(Notifications);
      if (fcmToken && !cancelled && fcmRegisteredRef.current !== fcmToken) {
        const ok = await registerFcmPushToken(authToken, deviceId, fcmToken);
        if (ok && !cancelled) {
          fcmRegisteredRef.current = fcmToken;
        }
      }

      try {
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
        if (!projectId || cancelled) return;
        const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
        if (expoToken.data && !cancelled) {
          await registerExpoPushToken(authToken, deviceId, expoToken.data);
        }
      } catch {
        /* EAS project not linked / Expo push unavailable on this build */
      }
    }

    void (async () => {
      const Notifications = await loadNotifications();
      if (!Notifications || cancelled) return;
      responseSub = Notifications.addNotificationResponseReceivedListener(() => {
        void sync();
      });
      void sync();
    })();

    return () => {
      cancelled = true;
      responseSub?.remove();
    };
  }, [isAuthenticated]);
}

/**
 * Deep-link to shift details when the worker taps a push/local notification
 * (background, killed app, or foreground).
 */
export function usePushNotificationNavigation(
  isAuthenticated: boolean,
  isAuthLoading: boolean,
) {
  const router = useRouter();
  const pendingDataRef = useRef<Record<string, unknown> | null>(null);
  const handledResponseIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let responseSub: { remove: () => void } | null = null;
    let receivedSub: { remove: () => void } | null = null;

    function tryNavigate(data: Record<string, unknown>) {
      if (!isAuthenticated || isAuthLoading) {
        pendingDataRef.current = data;
        return;
      }
      pendingDataRef.current = null;
      // Defer so RootLayoutNav auth redirects don't clobber the deep link.
      setTimeout(() => {
        if (cancelled) return;
        navigateFromNotificationData(router, data);
      }, 350);
    }

    void (async () => {
      const Notifications = await loadNotifications();
      if (!Notifications || cancelled) return;

      // Cold start: app opened from a notification tap while killed.
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last && !cancelled) {
          const responseId =
            last.notification.request.identifier ||
            `${last.notification.date}-${JSON.stringify(last.notification.request.content.data ?? {})}`;
          if (!handledResponseIdsRef.current.has(responseId)) {
            handledResponseIdsRef.current.add(responseId);
            tryNavigate(readNotificationData(last));
          }
        }
      } catch {
        /* optional API */
      }

      // When a local check-in alarm actually fires, mark it so sync won't recreate it.
      receivedSub = Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) return;
        const payload = data as Record<string, unknown>;
        if (coerceString(payload.type) !== "compliance_checkin") return;
        const scheduledId = coerceString(payload.scheduled_checkin_id);
        void import("@/lib/local-checkin-notifications").then(({ markLocalCheckinNotificationFired }) =>
          markLocalCheckinNotificationFired(scheduledId),
        );
      });

      responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
        const responseId =
          response.notification.request.identifier ||
          `${response.notification.date}-${JSON.stringify(response.notification.request.content.data ?? {})}`;
        if (handledResponseIdsRef.current.has(responseId)) return;
        handledResponseIdsRef.current.add(responseId);
        tryNavigate(readNotificationData(response));
      });
    })();

    return () => {
      cancelled = true;
      responseSub?.remove();
      receivedSub?.remove();
    };
  }, [router, isAuthenticated, isAuthLoading]);

  // Flush a notification that arrived before auth finished loading.
  useEffect(() => {
    if (!isAuthenticated || isAuthLoading || !pendingDataRef.current) return;
    const data = pendingDataRef.current;
    pendingDataRef.current = null;
    const timer = setTimeout(() => {
      navigateFromNotificationData(router, data);
    }, 350);
    return () => clearTimeout(timer);
  }, [isAuthenticated, isAuthLoading, router]);
}
