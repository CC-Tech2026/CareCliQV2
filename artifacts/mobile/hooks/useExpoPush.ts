import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { registerExpoPushToken, registerFcmPushToken } from "@/lib/push-registration";
import { getMobileDeviceId, readMobileAuthToken } from "@/lib/session";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureNotificationChannels(): Promise<void> {
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

async function requestPushPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/** Native FCM/APNs device token — used by backend firebase-admin on EAS builds. */
async function resolveNativeFcmToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
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
 * Registers FCM (Android/iOS) push tokens with the backend.
 * Requires an EAS development/production build with google-services.json (Android).
 */
export function useExpoPushRegistration() {
  const fcmRegisteredRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (!Device.isDevice) return;
      const authToken = await readMobileAuthToken();
      if (!authToken || cancelled) return;

      const granted = await requestPushPermission();
      if (!granted || cancelled) return;

      await ensureNotificationChannels();

      const deviceId = await getMobileDeviceId();
      const fcmToken = await resolveNativeFcmToken();
      if (fcmToken && !cancelled && fcmRegisteredRef.current !== fcmToken) {
        const ok = await registerFcmPushToken(authToken, deviceId, fcmToken);
        if (ok && !cancelled) {
          fcmRegisteredRef.current = fcmToken;
          return;
        }
      }

      // Expo Go / dev fallback only when native FCM token is unavailable
      try {
        const Constants = await import("expo-constants");
        const projectId =
          Constants.default.expoConfig?.extra?.eas?.projectId ??
          (Constants.default.easConfig as { projectId?: string } | undefined)?.projectId;
        if (!projectId) return;
        const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
        if (expoToken.data && !cancelled) {
          await registerExpoPushToken(authToken, deviceId, expoToken.data);
        }
      } catch {
        /* EAS project not linked yet */
      }
    }

    void sync();
    const responseSub = Notifications.addNotificationResponseReceivedListener(() => {
      void sync();
    });

    return () => {
      cancelled = true;
      responseSub.remove();
    };
  }, []);
}

/** Deep-link when user taps a push notification (background → foreground). */
export function usePushNotificationNavigation() {
  const router = useRouter();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      navigateFromNotificationData(router, data);
    });

    return () => sub.remove();
  }, [router]);
}
