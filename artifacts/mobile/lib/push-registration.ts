import { Platform } from "react-native";
import Constants from "expo-constants";

type PushRegisterResponse = { registered: boolean };

async function apiBaseUrl(): Promise<string> {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return "";
}

export async function registerExpoPushToken(
  authToken: string,
  deviceId: string,
  pushToken: string,
): Promise<boolean> {
  const base = await apiBaseUrl();
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

  const res = await fetch(`${base}/api/worker/notifications/push-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      "X-Device-Id": deviceId,
    },
    body: JSON.stringify({
      device_id: deviceId,
      push_token: pushToken,
      platform,
    }),
  });

  if (!res.ok) return false;
  const data = (await res.json()) as PushRegisterResponse;
  return Boolean(data.registered);
}

export function getExpoProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId
  );
}
