import type { ResolvedScheme } from "@/context/PreferencesContext";
import { Brand, BrandDark } from "@/constants/brand";

export type AuthColors = {
  shellBg: string;
  formBg: string;
  marketingBg: string;
  headline: string;
  marketingMuted: string;
  marketingBody: string;
  accent: string;
  inputBorder: string;
  inputBg: string;
  cardBg: string;
  cardBorder: string;
  statValue: string;
  statCardBorder: string;
  footer: string;
  dragHandle: string;
  text: string;
  muted: string;
  plum: string;
  coral: string;
  cta: string;
  valid: string;
  error: string;
};

/**
 * Auth / onboarding surfaces — same CareCliQ brand as the rest of the app.
 * `plum` / `cta` map to CareCliQ Purple; `coral` is Pink accent only.
 */
const light: AuthColors = {
  shellBg: Brand.ivory,
  formBg: Brand.white,
  marketingBg: Brand.ivory,
  headline: Brand.navy,
  marketingMuted: "#6B6B7A",
  marketingBody: Brand.navy,
  accent: Brand.purple,
  inputBorder: Brand.purpleTint10,
  inputBg: Brand.purpleTint10,
  cardBg: "rgba(255, 255, 255, 0.92)",
  cardBorder: "rgba(45, 45, 61, 0.10)",
  statValue: Brand.navy,
  statCardBorder: "rgba(45, 45, 61, 0.10)",
  footer: "#6B6B7A",
  dragHandle: Brand.purpleTint10,
  text: Brand.navy,
  muted: "#6B6B7A",
  plum: Brand.purple,
  coral: Brand.pink,
  cta: Brand.purple,
  valid: Brand.success,
  error: Brand.error,
};

const dark: AuthColors = {
  shellBg: BrandDark.ivory,
  formBg: BrandDark.white,
  marketingBg: BrandDark.ivory,
  headline: BrandDark.navy,
  marketingMuted: BrandDark.muted,
  marketingBody: BrandDark.navy,
  accent: BrandDark.purple,
  inputBorder: BrandDark.border,
  inputBg: BrandDark.purpleTint,
  cardBg: "rgba(31, 30, 42, 0.92)",
  cardBorder: "rgba(245, 244, 250, 0.12)",
  statValue: BrandDark.navy,
  statCardBorder: "rgba(245, 244, 250, 0.12)",
  footer: BrandDark.muted,
  dragHandle: BrandDark.border,
  text: BrandDark.navy,
  muted: BrandDark.muted,
  plum: BrandDark.purple,
  coral: BrandDark.pink,
  cta: BrandDark.purple,
  valid: BrandDark.success,
  error: BrandDark.error,
};

export function getAuthColors(scheme: ResolvedScheme): AuthColors {
  return scheme === "dark" ? dark : light;
}

export const TRUST_AVATARS = [
  { i: "SM", bg: Brand.pink },
  { i: "AK", bg: Brand.success },
  { i: "LP", bg: Brand.purple },
  { i: "JW", bg: Brand.error },
  { i: "RN", bg: Brand.legacyPurple },
];
