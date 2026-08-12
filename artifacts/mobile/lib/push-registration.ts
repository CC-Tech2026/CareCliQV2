import { Platform } from "react-native";
import Constants from "expo-constants";

import { getMobileApiBaseUrl } from "@/lib/api-base-url";

type PushRegisterResponse = { registered: boolean };

async function apiBaseUrl(): Promise<string> {
  return getMobileApiBaseUrl();
}

export async function registerExpoPushToken(
  authToken: string,
  deviceId: string,
  pushToken: string,
): Promise<boolean> {
  return registerPushToken(authToken, deviceId, pushToken, "expo");
}

export async function registerFcmPushToken(
  authToken: string,
  deviceId: string,
  pushToken: string,
): Promise<boolean> {
  return registerPushToken(authToken, `${deviceId}:fcm`, pushToken, "fcm");
}

async function registerPushToken(
  authToken: string,
  deviceId: string,
  pushToken: string,
  tokenType: "expo" | "fcm",
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
      token_type: tokenType,
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
