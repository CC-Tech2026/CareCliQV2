import { useContext } from "react";
import { useColorScheme } from "react-native";

import colors, { type ColorSchemeTokens } from "@/constants/colors";
import { ButtonHeight, Elevation, IconSize, Radius, Spacing, TouchTarget } from "@/constants/layout";
import { FontFamily, Typography, type TypeStyle, type TypeToken } from "@/constants/typography";
import { PreferencesContext } from "@/context/PreferencesContext";

export type ThemeColors = ColorSchemeTokens & {
  radius: number;
  scheme: "light" | "dark";
  highContrast: boolean;
};

/**
 * Returns the design tokens for the active color scheme.
 *
 * The scheme is driven by the user's theme preference (system/light/dark) from
 * {@link PreferencesContext}. When rendered outside the provider (e.g. early
 * boot or the error boundary), it falls back to the device color scheme.
 */
export function useColors(): ThemeColors {
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

  return { ...palette, radius: Radius.md, scheme, highContrast };
}

/**
 * Full theme: colours + type + layout. Prefer this when applying type tokens.
 */
export function useTheme() {
  const colorTokens = useColors();
  return {
    colors: colorTokens,
    typography: Typography,
    font: FontFamily,
    spacing: Spacing,
    radius: Radius,
    elevation: Elevation,
    icon: IconSize,
    buttonHeight: ButtonHeight,
    touchTarget: TouchTarget,
    type: (token: TypeToken): TypeStyle => Typography[token],
  };
}
