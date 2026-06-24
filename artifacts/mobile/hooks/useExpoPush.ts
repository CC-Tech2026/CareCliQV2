import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { getExpoProjectId, registerExpoPushToken } from "@/lib/push-registration";
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

async function resolveExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "CareScribe",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync("safety-alerts", {
      name: "Safety alerts",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
    });
  }

  const projectId = getExpoProjectId();
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return token.data;
}

/**
 * Registers Expo push token with backend when an auth token is available.
 * Re-runs when the app returns to foreground (token rotation).
 */
export function useExpoPushRegistration() {
  const registeredRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      const authToken = await readMobileAuthToken();
      if (!authToken || cancelled) return;

      const pushToken = await resolveExpoPushToken();
      if (!pushToken || cancelled) return;
      if (registeredRef.current === pushToken) return;

      const deviceId = await getMobileDeviceId();
      const ok = await registerExpoPushToken(authToken, deviceId, pushToken);
      if (ok && !cancelled) {
        registeredRef.current = pushToken;
      }
    }

    void sync();
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      void sync();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
}

/** Deep-link when user taps a push notification. */
export function usePushNotificationNavigation() {
  const router = useRouter();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const actionUrl = typeof data.action_url === "string" ? data.action_url : null;
      const shiftId = typeof data.shift_id === "string" ? data.shift_id : null;

      if (shiftId) {
        router.push(`/session/${shiftId}` as never);
      } else if (actionUrl?.includes("/my-shifts/")) {
        const match = actionUrl.match(/\/my-shifts\/([^/?]+)/);
        if (match?.[1]) router.push(`/session/${match[1]}` as never);
      }
    });

    return () => sub.remove();
  }, [router]);
}
