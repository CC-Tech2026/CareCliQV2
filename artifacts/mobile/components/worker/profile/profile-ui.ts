import { Platform, type ViewStyle } from "react-native";

export function elevatedCardShadow(isDark: boolean): ViewStyle {
  return Platform.select({
    ios: {
      shadowColor: isDark ? "#000000" : "#0D0D55",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.28 : 0.08,
      shadowRadius: 12,
    },
    android: { elevation: 3 },
    default: {},
  }) as ViewStyle;
}

export function formatWorkerRole(role?: string | null): string {
  if (!role) return "Support Worker";
  const labels: Record<string, string> = {
    support_worker: "Support Worker",
    support_coordinator: "Support Coordinator",
  };
  if (labels[role]) return labels[role];
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatProfileSubtitle(parts: Array<string | null | undefined>): string {
  return parts.filter((part) => Boolean(part && String(part).trim())).join(" · ");
}
