/**
 * CareCliQ shape, spacing & elevation — Mobile UI/UX Redesign §3.4
 */

/** 4pt base grid */
export const Spacing = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  20: 20,
  24: 24,
  32: 32,
  /** Screen horizontal gutters */
  gutter: 16,
  /** Card padding */
  card: 16,
  /** List row vertical padding */
  listRowY: 12,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** Minimum interactive target (iOS HIG / Material) */
export const TouchTarget = 44;

/** Primary button height */
export const ButtonHeight = {
  primary: 48,
} as const;

export const IconSize = {
  default: 24,
  stroke: 1.8,
} as const;

/** Navy @ alpha for elevation (prefer 1px border + subtle shadow) */
const navyRgb = "45, 45, 61";

export const Elevation = {
  /** Card: y2 blur8 @ 6% navy */
  card: {
    shadowColor: `rgb(${navyRgb})`,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  /** Tab bar: y-2 blur12 @ 8% navy */
  tabBar: {
    shadowColor: `rgb(${navyRgb})`,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
} as const;
