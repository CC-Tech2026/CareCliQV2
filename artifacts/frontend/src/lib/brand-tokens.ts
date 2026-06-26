/**
 * CareCliQ brand tokens — always reference CSS variables so theme,
 * dark mode, and high-contrast palettes can override colours globally.
 */
export const CC = {
  plum: "var(--cc-plum)",
  coral: "var(--cc-coral)",
  text: "var(--cc-text)",
  muted: "var(--cc-muted)",
  border: "var(--cc-border)",
  bg: "var(--cc-bg)",
  active: "var(--cc-active)",
  surface: "var(--cc-surface)",
  plumSubtle: "var(--cc-plum-subtle)",
  plumSoft: "var(--cc-plum-soft)",
  plumMedium: "var(--cc-plum-medium)",
  plumRing: "var(--cc-plum-ring)",
  coralSoft: "var(--cc-coral-soft)",
  coralRing: "var(--cc-coral-ring)",
} as const;

/** Status palette — icon + colour pairs; use AccessibleStatusBadge for UI. */
export const CC_STATUS = {
  success: "var(--cc-status-success)",
  successBg: "var(--cc-status-success-bg)",
  warning: "var(--cc-status-warning)",
  warningBg: "var(--cc-status-warning-bg)",
  critical: "var(--cc-status-critical)",
  criticalBg: "var(--cc-status-critical-bg)",
  info: "var(--cc-status-info)",
  infoBg: "var(--cc-status-info-bg)",
} as const;
