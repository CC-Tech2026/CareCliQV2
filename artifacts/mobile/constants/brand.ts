/**
 * CareCliQ brand primitives — single source of truth.
 * UI code should consume light/dark tokens via `useColors()` / `useTheme()`,
 * not these hex values directly (except chart/data-viz when noted).
 *
 * Spec: CareCliQ Mobile App — UI/UX Redesign v1.0 §3
 */

export const Brand = {
  /** CareCliQ Purple — primary buttons, tabs, links, focus, splash, selected */
  purple: "#4B3F91",
  /** Light Grey — app background (never use white for screen bg) */
  ivory: "#F2F3F5",
  /** Card White — cards, sheets, inputs, tab bar */
  white: "#FFFFFF",
  /** Dark Navy — body/heading ink + home hero card */
  navy: "#2D2D3D",
  /** Pink — accent only (kickers, dots). Never body text / buttons / large fills */
  pink: "#E8457A",
  /** Purple Tint 10 — selected rows, chips at rest, icon containers, table stripes */
  purpleTint10: "#EEECF7",

  success: "#2E7D5B",
  warning: "#B97A1A",
  error: "#C23B3B",

  /**
   * Deprecated product purple. Do not use for UI chrome.
   * Allowed only as a mid-purple data-visualisation tint.
   */
  legacyPurple: "#6E79C2",
} as const;

/** Dark-mode adaptations of the same brand (legible on deep navy surfaces). */
export const BrandDark = {
  purple: "#8B7FD4",
  purpleMuted: "#A89CE8",
  purpleTint: "#2A2840",
  ivory: "#16151F",
  white: "#1F1E2A",
  navy: "#F5F4FA",
  pink: "#F472B6",
  success: "#4ADE80",
  warning: "#FBBF24",
  error: "#F87171",
  muted: "#A8A6B8",
  border: "#343246",
} as const;

export type BrandKey = keyof typeof Brand;
