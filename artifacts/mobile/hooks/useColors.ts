import { useContext } from "react";
import { useColorScheme } from "react-native";

import colors from "@/constants/colors";
import { PreferencesContext } from "@/context/PreferencesContext";

/**
 * Returns the design tokens for the active color scheme.
 *
 * The scheme is driven by the user's theme preference (system/light/dark) from
 * {@link PreferencesContext}. When rendered outside the provider (e.g. early
 * boot or the error boundary), it falls back to the device color scheme.
 */
export function useColors() {
  const deviceScheme = useColorScheme();
  const prefs = useContext(PreferencesContext);
  const scheme = prefs?.resolvedScheme ?? (deviceScheme === "dark" ? "dark" : "light");
  const highContrast = prefs?.highContrast ?? false;
  const base = scheme === "dark" ? colors.dark : colors.light;

  const palette = highContrast
    ? {
        ...base,
        background: scheme === "dark" ? "#000000" : "#FFFFFF",
        foreground: scheme === "dark" ? "#FFFFFF" : "#000000",
        card: scheme === "dark" ? "#0A0A0A" : "#FFFFFF",
        cardForeground: scheme === "dark" ? "#FFFFFF" : "#000000",
        mutedForeground: scheme === "dark" ? "#E5E5E5" : "#1F1F1F",
        border: scheme === "dark" ? "#FFFFFF" : "#000000",
        text: scheme === "dark" ? "#FFFFFF" : "#000000",
      }
    : base;

  return { ...palette, radius: colors.radius, scheme, highContrast };
}
