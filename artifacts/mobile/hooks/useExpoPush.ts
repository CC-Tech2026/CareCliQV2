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
  });
  await Notifications.setNotificationChannelAsync("safety-alerts", {
    name: "Safety alerts",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 250, 500],
    sound: "default",
    enableVibrate: true,
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

function navigateFromNotificationData(
  router: ReturnType<typeof useRouter>,
  data: Record<string, unknown>,
) {
  const shiftId = typeof data.shift_id === "string" ? data.shift_id : null;
  const notificationType = typeof data.type === "string" ? data.type : null;
  const actionUrl = typeof data.action_url === "string" ? data.action_url : null;

  if (shiftId) {
    const query = notificationType === "compliance_checkin" ? "?checkin=pending" : "";
    router.push(`/shift/${shiftId}${query}` as never);
    return;
  }
  if (actionUrl?.includes("/my-shifts/")) {
    const match = actionUrl.match(/\/my-shifts\/([^/?]+)/);
    if (match?.[1]) router.push(`/shift/${match[1]}?checkin=pending` as never);
  }
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
      const fcmToken = await resolveNativeFcmToken(Notifications);
      if (fcmToken && !cancelled && fcmRegisteredRef.current !== fcmToken) {
        const ok = await registerFcmPushToken(authToken, deviceId, fcmToken);
        if (ok && !cancelled) {
          fcmRegisteredRef.current = fcmToken;
          return;
        }
      }

      try {
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
        if (!projectId) return;
        const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
        if (expoToken.data && !cancelled) {
          await registerExpoPushToken(authToken, deviceId, expoToken.data);
        }
      } catch {
        /* EAS project not linked yet */
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

/** Deep-link when user taps a push notification (background → foreground). */
export function usePushNotificationNavigation() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let sub: { remove: () => void } | null = null;

    void (async () => {
      const Notifications = await loadNotifications();
      if (!Notifications || cancelled) return;
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        navigateFromNotificationData(router, data);
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [router]);
}
