import { Platform } from "react-native";

/**
 * CareCliQ type scale — Mobile UI/UX Redesign §3.3
 * Families are variable fonts; only load the weights listed here.
 */

const platformFont = (name: string): string =>
  Platform.OS === "web"
    ? `${name}, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    : name;

export const FontFamily = {
  display: platformFont("Inter_700Bold"),
  h1: platformFont("Inter_700Bold"),
  h2: platformFont("Inter_600SemiBold"),
  body: platformFont("Inter_400Regular"),
  bodyStrong: platformFont("Inter_600SemiBold"),
  caption: platformFont("Inter_400Regular"),
  label: platformFont("Inter_500Medium"),
  /** Common Inter weights still used across the app */
  interRegular: platformFont("Inter_400Regular"),
  interMedium: platformFont("Inter_500Medium"),
  interSemiBold: platformFont("Inter_600SemiBold"),
  interBold: platformFont("Inter_700Bold"),
} as const;

export type TypeToken =
  | "display"
  | "h1"
  | "h2"
  | "body"
  | "bodyStrong"
  | "caption"
  | "label";

export type TypeStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
};

export const Typography: Record<TypeToken, TypeStyle> = {
  display: {
    fontFamily: FontFamily.display,
    fontSize: 28,
    lineHeight: 34,
  },
  h1: {
    fontFamily: FontFamily.h1,
    fontSize: 22,
    lineHeight: 28,
  },
  h2: {
    fontFamily: FontFamily.h2,
    fontSize: 17,
    lineHeight: 22,
  },
  body: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    lineHeight: 22,
  },
  bodyStrong: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    lineHeight: 22,
  },
  caption: {
    fontFamily: FontFamily.caption,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontFamily: FontFamily.label,
    fontSize: 11,
    lineHeight: 14,
  },
};
