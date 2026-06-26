/**
 * CareCliQ Design System
 * Healthcare-focused, accessible, professional UI design tokens
 * 
 * Principles:
 * - Trust & Clarity: Blues, teals, and greens for healthcare context
 * - Semantic Colors: Status indication (good/warning/critical)
 * - Professional: Subtle shadows, generous spacing, clear hierarchy
 * - Accessible: High contrast ratios, clear typography
 * - Consistent: Single source of truth for all pages
 */

import { CC, CC_STATUS } from "@/lib/brand-tokens";

// ── Brand Colors ──────────────────────────────────────────────────────────────

export const BRAND = {
  primary:   CC.plum,
  secondary: CC.coral,
} as const;

// ── Semantic Status Colors ────────────────────────────────────────────────────
export const STATUS = {
  success:   CC_STATUS.success,
  warning:   CC_STATUS.warning,
  critical:  CC_STATUS.critical,
  info:      CC_STATUS.info,
  inactive:  CC.muted,
} as const;

// ── Text Colors ───────────────────────────────────────────────────────────────
export const TEXT = {
  primary:   CC.text,
  secondary: CC.muted,
  muted:     CC.muted,
  inverted:  "#FFFFFF",
} as const;

// ── Background Colors ─────────────────────────────────────────────────────────
export const BACKGROUND = {
  page:      CC.surface,
  section:   CC.bg,
  card:      CC.surface,
  overlay:   "rgba(15, 23, 42, 0.5)",
} as const;

// ── Border & Divider Colors ───────────────────────────────────────────────────
export const BORDER = {
  light:     CC.border,
  default:   CC.border,
  strong:    CC.muted,
} as const;

// ── Status Background Colors (light tints for badges/backgrounds) ────────────
export const STATUS_BG = {
  success:   CC_STATUS.successBg,
  warning:   CC_STATUS.warningBg,
  critical:  CC_STATUS.criticalBg,
  info:      CC_STATUS.infoBg,
  inactive:  CC.bg,
} as const;

// ── Spacing Scale (8px base) ──────────────────────────────────────────────────
export const SPACING = {
  xs:    "0.25rem",  // 4px
  sm:    "0.5rem",   // 8px
  md:    "1rem",     // 16px
  lg:    "1.5rem",   // 24px
  xl:    "2rem",     // 32px
  xxl:   "3rem",     // 48px
} as const;

// ── Shadows (healthcare: subtle, professional) ────────────────────────────────
export const SHADOWS = {
  none:      "none",
  xs:        "0 1px 2px 0 rgba(15, 23, 42, 0.05)",
  sm:        "0 1px 3px 0 rgba(15, 23, 42, 0.08), 0 1px 2px 0 rgba(15, 23, 42, 0.04)",
  md:        "0 4px 6px -1px rgba(15, 23, 42, 0.1), 0 2px 4px -1px rgba(15, 23, 42, 0.06)",
  lg:        "0 10px 15px -3px rgba(15, 23, 42, 0.12), 0 4px 6px -2px rgba(15, 23, 42, 0.05)",
  xl:        "0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 10px 10px -5px rgba(15, 23, 42, 0.04)",
  card:      "0 1px 3px 0 rgba(15, 23, 42, 0.08), 0 1px 2px 0 rgba(15, 23, 42, 0.04)",
} as const;

// ── Radius (healthcare: rounded but professional) ───────────────────────────
export const RADIUS = {
  none:      "0",
  sm:        "0.375rem",   // 6px - Subtle
  md:        "0.5rem",     // 8px - Default
  lg:        "0.75rem",    // 12px - Cards, modals
  xl:        "1rem",       // 16px - Large components
  full:      "9999px",     // Fully rounded (pills)
} as const;

// ── Typography (professional healthcare context) ───────────────────────────
export const TYPOGRAPHY = {
  // Page heading
  pageTitle: {
    fontSize: "28px",
    fontWeight: "900",
    letterSpacing: "-0.5px",
    lineHeight: "1.2",
  },
  // Section heading
  sectionTitle: {
    fontSize: "18px",
    fontWeight: "700",
    letterSpacing: "-0.25px",
    lineHeight: "1.3",
  },
  // Card heading
  cardTitle: {
    fontSize: "16px",
    fontWeight: "600",
    letterSpacing: "0",
    lineHeight: "1.4",
  },
  // Body text
  body: {
    fontSize: "14px",
    fontWeight: "400",
    letterSpacing: "0",
    lineHeight: "1.5",
  },
  // Small/caption
  caption: {
    fontSize: "12px",
    fontWeight: "500",
    letterSpacing: "0.5px",
    lineHeight: "1.4",
  },
  // Label
  label: {
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "0.75px",
    lineHeight: "1.3",
    textTransform: "uppercase",
  },
} as const;

// ── Component Spacing ─────────────────────────────────────────────────────────
export const COMPONENT = {
  // Button padding
  buttonSmall:    "0.5rem 1rem",     // sm: 8-16px
  buttonDefault:  "0.75rem 1.5rem",  // md: 12-24px
  buttonLarge:    "1rem 2rem",       // lg: 16-32px
  
  // Card padding
  cardSmall:      "1rem",            // 16px
  cardDefault:    "1.5rem",          // 24px
  cardLarge:      "2rem",            // 32px
  
  // Input height
  inputSmall:     "32px",
  inputDefault:   "40px",
  inputLarge:     "48px",
} as const;

// ── Transitions (subtle, professional) ────────────────────────────────────────
export const TRANSITION = {
  fast:      "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  normal:    "250ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow:      "350ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

// ── Z-Index Scale (consistent layering) ───────────────────────────────────────
export const Z_INDEX = {
  base:       0,
  dropdown:   100,
  sticky:     200,
  modal:      400,
  tooltip:    500,
  notification: 600,
} as const;

// ── Utility color helpers for healthcare context ───────────────────────────────
export function getStatusColor(status?: string) {
  switch (status?.toLowerCase()) {
    case "compliant":
    case "valid":
    case "safe":
    case "active":
    case "good":
    case "success":
      return STATUS.success;
    case "expiring":
    case "warning":
    case "needs_attention":
    case "pending":
      return STATUS.warning;
    case "non_compliant":
    case "expired":
    case "critical":
    case "error":
    case "urgent":
    case "at_risk":
      return STATUS.critical;
    default:
      return STATUS.info;
  }
}

export function getStatusBgColor(status?: string) {
  switch (status?.toLowerCase()) {
    case "compliant":
    case "valid":
    case "safe":
    case "active":
    case "good":
    case "success":
      return STATUS_BG.success;
    case "expiring":
    case "warning":
    case "needs_attention":
    case "pending":
      return STATUS_BG.warning;
    case "non_compliant":
    case "expired":
    case "critical":
    case "error":
    case "urgent":
    case "at_risk":
      return STATUS_BG.critical;
    default:
      return STATUS_BG.info;
  }
}

// ── Combined color sets for different contexts ────────────────────────────────
export const ROLE_COLORS = {
  support_worker: {
    color: "#2563EB",          // Blue - Clinical work
    bg: "#DBEAFE",
    accent: BRAND.primary,
  },
  support_coordinator: {
    color: "#7C3AED",          // Violet - Team oversight
    bg: "#EDE9FE",
    accent: BRAND.secondary,
  },
  allied_health: {
    color: "#059669",          // Teal - Clinical practice
    bg: "#D1FAE5",
    accent: STATUS.success,
  },
  managing_director: {
    color: "#DC2626",          // Red - Executive oversight
    bg: "#FEE2E2",
    accent: STATUS.critical,
  },
} as const;

// ── Export all as a single design system object ────────────────────────────────
export const DESIGN_SYSTEM = {
  BRAND,
  STATUS,
  TEXT,
  BACKGROUND,
  BORDER,
  STATUS_BG,
  SPACING,
  SHADOWS,
  RADIUS,
  TYPOGRAPHY,
  COMPONENT,
  TRANSITION,
  Z_INDEX,
  ROLE_COLORS,
  getStatusColor,
  getStatusBgColor,
} as const;

export type DesignSystem = typeof DESIGN_SYSTEM;
