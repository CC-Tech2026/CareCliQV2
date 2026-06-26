export type Theme = "light" | "dark";

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("cc-theme") as Theme | null;
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try { localStorage.setItem("cc-theme", theme); } catch { /* noop */ }
}

/** Call once before React renders to avoid flash of wrong theme. */
export function initTheme() {
  applyTheme(getStoredTheme());
}
