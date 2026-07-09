import { getMobileDeviceId } from "@/lib/session";
import { workerFetch } from "@/lib/worker-fetch";

export type AccessibilityPreferences = {
  font_size: "small" | "default" | "large" | "xl";
  theme_mode: "system" | "light" | "dark";
  high_contrast: boolean;
  dyslexia_font: boolean;
  device_id: string;
};

export function getAccessibilityPreferences(deviceId: string) {
  return workerFetch<{
    preferences: AccessibilityPreferences;
    preferred_language: string;
  }>(`/api/users/me/accessibility?device_id=${encodeURIComponent(deviceId)}`);
}

export function saveAccessibilityPreferences(
  deviceId: string,
  prefs: Partial<Omit<AccessibilityPreferences, "device_id">>,
) {
  return workerFetch<{ preferences: AccessibilityPreferences }>("/api/users/me/accessibility", {
    method: "PUT",
    body: JSON.stringify({ device_id: deviceId, ...prefs }),
  });
}
