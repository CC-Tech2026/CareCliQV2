import type { ThemeMode } from "@/services/accessibilityService";

/** Apply dark/light class on <html> synchronously — no wait for React effects or API. */
export function applyThemeModeImmediate(mode: ThemeMode) {
  const root = document.documentElement;
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}
