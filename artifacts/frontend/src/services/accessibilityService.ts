import { jsonFetch } from "@/services/http";

export type FontSize = "small" | "default" | "large" | "xl";
export type ThemeMode = "system" | "light" | "dark";
export type AppLanguage = "en" | "vi" | "ar" | "zh-Hans";

export type AccessibilityPreferences = {
  font_size: FontSize;
  theme_mode: ThemeMode;
  high_contrast: boolean;
  dyslexia_font: boolean;
  device_id: string;
};

export function getAccessibilityPreferences(deviceId: string) {
  return jsonFetch<{
    preferences: AccessibilityPreferences;
    preferred_language: AppLanguage;
  }>(`/api/users/me/accessibility?device_id=${encodeURIComponent(deviceId)}`);
}

export function saveAccessibilityPreferences(
  deviceId: string,
  prefs: Partial<Omit<AccessibilityPreferences, "device_id">>,
) {
  return jsonFetch<{ preferences: AccessibilityPreferences }>("/api/users/me/accessibility", {
    method: "PUT",
    body: JSON.stringify({ device_id: deviceId, ...prefs }),
  });
}

export function updatePreferredLanguage(preferred_language: AppLanguage) {
  return jsonFetch<{ preferred_language: AppLanguage }>("/api/users/me/language", {
    method: "PATCH",
    body: JSON.stringify({ preferred_language }),
  });
}
