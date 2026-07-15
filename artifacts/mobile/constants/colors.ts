import { Brand, BrandDark } from "@/constants/brand";

export type ColorSchemeTokens = {
  text: string;
  tint: string;

  background: string;
  foreground: string;

  card: string;
  cardForeground: string;

  primary: string;
  primaryForeground: string;

  secondary: string;
  secondaryForeground: string;

  muted: string;
  mutedForeground: string;

  accent: string;
  accentForeground: string;

  destructive: string;
  destructiveForeground: string;

  success: string;
  successForeground: string;

  warning: string;
  warningForeground: string;

  border: string;
  input: string;

  soft: string;
  activeBg: string;
  alertBg: string;

  clockInBg: string;
  clockInBorder: string;
  clockInText: string;
  clockInIcon: string;
  composerPink: string;
  composerPurple: string;

  dangerBg: string;
  dangerBorder: string;
  dangerText: string;
  dangerIcon: string;

  navy: string;
  pink: string;
  lime: string;
  blue: string;

  heroCard: string;
  heroMuted: string;
  progressTrack: string;
  statusDocumentedBg: string;
  statusProgressBg: string;
  statusUpcomingBg: string;
};

const light: ColorSchemeTokens = {
  text: Brand.navy,
  tint: Brand.pink,

  background: Brand.ivory,
  foreground: Brand.navy,

  card: Brand.white,
  cardForeground: Brand.navy,

  primary: Brand.purple,
  primaryForeground: Brand.white,

  secondary: Brand.purpleTint10,
  secondaryForeground: Brand.purple,

  muted: Brand.purpleTint10,
  mutedForeground: "#6B6B7A",

  accent: Brand.pink,
  accentForeground: Brand.white,

  destructive: Brand.error,
  destructiveForeground: Brand.white,

  success: Brand.success,
  successForeground: Brand.white,

  warning: Brand.warning,
  warningForeground: Brand.white,

  border: Brand.purpleTint10,
  input: "#D9D6E8",

  soft: Brand.purpleTint10,
  activeBg: Brand.purpleTint10,
  alertBg: "rgba(232,69,122,0.08)",

  clockInBg: "#E3F0EA",
  clockInBorder: "#B7D6C8",
  clockInText: Brand.success,
  clockInIcon: Brand.success,
  composerPink: Brand.pink,
  composerPurple: Brand.purple,

  dangerBg: "#FBEEEE",
  dangerBorder: "#F0C4C4",
  dangerText: "#791F1F",
  dangerIcon: Brand.error,

  navy: Brand.navy,
  pink: Brand.pink,
  lime: Brand.success,
  blue: Brand.purple,

  heroCard: Brand.navy,
  heroMuted: "#B9B6C9",
  progressTrack: "#4A4960",
  statusDocumentedBg: "#E3F0EA",
  statusProgressBg: "#F7EEDD",
  statusUpcomingBg: Brand.purpleTint10,
};

const dark: ColorSchemeTokens = {
  text: BrandDark.navy,
  tint: BrandDark.pink,

  background: BrandDark.ivory,
  foreground: BrandDark.navy,

  card: BrandDark.white,
  cardForeground: BrandDark.navy,

  primary: BrandDark.purple,
  primaryForeground: BrandDark.ivory,

  secondary: BrandDark.purpleTint,
  secondaryForeground: BrandDark.purpleMuted,

  muted: BrandDark.purpleTint,
  mutedForeground: BrandDark.muted,

  accent: BrandDark.pink,
  accentForeground: BrandDark.ivory,

  destructive: BrandDark.error,
  destructiveForeground: BrandDark.ivory,

  success: BrandDark.success,
  successForeground: BrandDark.ivory,

  warning: BrandDark.warning,
  warningForeground: BrandDark.ivory,

  border: BrandDark.border,
  input: BrandDark.border,

  soft: BrandDark.purpleTint,
  activeBg: BrandDark.purpleTint,
  alertBg: "rgba(244,114,182,0.16)",

  clockInBg: "rgba(74,222,128,0.12)",
  clockInBorder: "rgba(74,222,128,0.35)",
  clockInText: "#86EFAC",
  clockInIcon: BrandDark.success,
  composerPink: BrandDark.pink,
  composerPurple: BrandDark.purpleMuted,

  dangerBg: "rgba(248,113,113,0.12)",
  dangerBorder: "rgba(248,113,113,0.35)",
  dangerText: "#FCA5A5",
  dangerIcon: BrandDark.error,

  navy: BrandDark.purpleMuted,
  pink: BrandDark.pink,
  lime: BrandDark.success,
  blue: BrandDark.purpleMuted,

  heroCard: "#1A1824",
  heroMuted: "#9A97AD",
  progressTrack: "#3A3850",
  statusDocumentedBg: "rgba(46,125,91,0.22)",
  statusProgressBg: "rgba(185,122,26,0.22)",
  statusUpcomingBg: "rgba(75,63,145,0.28)",
};

/**
 * Semantic colour tokens for light + dark.
 * Prefer `useColors()` in components — edit brand.ts to re-theme the app.
 */
const colors = {
  light,
  dark,
  /** @deprecated Prefer `radius.md` from layout tokens via `useTheme()`. */
  radius: 12,
};

export default colors;
