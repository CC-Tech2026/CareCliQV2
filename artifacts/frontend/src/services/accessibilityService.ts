import { jsonFetch } from "@/services/http";

export type FontSize = "small" | "default" | "large" | "xl";
// "System" is deliberately not an option — see AccessibilityPanel.tsx's
// THEME_OPTIONS comment. Theme is a fixed, explicit user choice.
export type ThemeMode = "light" | "dark";
export type AppLanguage = "en" | "vi" | "ar" | "zh-Hans";
export type NavLayout = "topbar" | "sidebar" | "bottombar";

export type AccessibilityPreferences = {
  font_size: FontSize;
  theme_mode: ThemeMode;
  high_contrast: boolean;
  dyslexia_font: boolean;
  nav_layout: NavLayout;
  nav_color: string | null;
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
  prefs: Partial<Omit<AccessibilityPreferences, "device_id">> & { nav_color_clear?: boolean },
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
