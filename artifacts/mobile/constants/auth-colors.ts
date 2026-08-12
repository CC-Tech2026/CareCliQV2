import type { ResolvedScheme } from "@/context/PreferencesContext";

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
};

const light: AuthColors = {
  shellBg: "#FFFFFF",
  formBg: "#FFFFFF",
  marketingBg: "#FDF6EE",
  headline: "#1A1A2E",
  marketingMuted: "#6A6A77",
  marketingBody: "#33334A",
  accent: "#7C3AED",
  inputBorder: "#E8E8EA",
  inputBg: "#F4EDE6",
  cardBg: "rgba(255, 255, 255, 0.7)",
  cardBorder: "rgba(26, 26, 46, 0.10)",
  statValue: "#1A1A2E",
  statCardBorder: "rgba(26, 26, 46, 0.10)",
  footer: "#94A3B8",
  dragHandle: "#E8E8EA",
  text: "#0D0D55",
  muted: "#6B6B8A",
  plum: "#7C3AED",
  coral: "#E8457A",
  cta: "#E8457A",
  valid: "#22C55E",
};

const dark: AuthColors = {
  shellBg: "#1A1A2E",
  formBg: "#2C2C3F",
  marketingBg: "#1A1A2E",
  headline: "#F9FAFB",
  marketingMuted: "#9CA3AF",
  marketingBody: "#D1D5DB",
  accent: "#A78BFA",
  inputBorder: "#4B5563",
  inputBg: "#374151",
  cardBg: "rgba(31, 41, 55, 0.85)",
  cardBorder: "rgba(249, 250, 251, 0.12)",
  statValue: "#F9FAFB",
  statCardBorder: "rgba(249, 250, 251, 0.12)",
  footer: "#6B7280",
  dragHandle: "#4B5563",
  text: "#F9FAFB",
  muted: "#9CA3AF",
  plum: "#F472B6",
  coral: "#A78BFA",
  cta: "#A78BFA",
  valid: "#4ADE80",
};

export function getAuthColors(scheme: ResolvedScheme): AuthColors {
  return scheme === "dark" ? dark : light;
}

export const TRUST_AVATARS = [
  { i: "SM", bg: "#E8457A" },
  { i: "AK", bg: "#0D7C66" },
  { i: "LP", bg: "#7B3F9E" },
  { i: "JW", bg: "#C0392B" },
  { i: "RN", bg: "#1A6FA8" },
];
