import type { ThemeMode } from "@/services/accessibilityService";

export const THEME_STORAGE_KEY = "carecliq-theme";
const LEGACY_THEME_STORAGE_KEY = "cc-theme";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

/** Read persisted theme preference, migrating legacy cc-theme once if needed. */
export function getStoredThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) return stored;

    const legacy = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacy === "light" || legacy === "dark") {
      localStorage.setItem(THEME_STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
      return legacy;
    }

    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    /* noop */
  }
  return "light";
}

/** Apply dark/light class on <html> synchronously — no wait for React effects or API. */
export function applyThemeModeImmediate(mode: ThemeMode) {
  const root = document.documentElement;
  const isDark = mode === "dark";

  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

/** Call once before React renders to avoid flash of wrong theme. */
export function initTheme() {
  applyThemeModeImmediate(getStoredThemeMode());
}
