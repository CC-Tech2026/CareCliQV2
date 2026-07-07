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
  const palette = scheme === "dark" ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius, scheme };
}
