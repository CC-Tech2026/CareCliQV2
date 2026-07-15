/**
 * CareCliQ theme barrel — import brand/layout/type from one place when needed
 * outside React. Prefer `useColors()` / `useTheme()` in components.
 */
export { Brand, BrandDark } from "@/constants/brand";
export { default as colors } from "@/constants/colors";
export type { ColorSchemeTokens } from "@/constants/colors";
export { getAuthColors, TRUST_AVATARS } from "@/constants/auth-colors";
export type { AuthColors } from "@/constants/auth-colors";
export {
  ButtonHeight,
  Elevation,
  IconSize,
  Radius,
  Spacing,
  TouchTarget,
} from "@/constants/layout";
export { FontFamily, Typography } from "@/constants/typography";
export type { TypeStyle, TypeToken } from "@/constants/typography";
