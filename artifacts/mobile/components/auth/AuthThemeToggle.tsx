import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { getAuthColors } from "@/constants/auth-colors";
import { usePreferences, type ThemeMode } from "@/context/PreferencesContext";

const MODES: {
  id: ThemeMode;
  icon: keyof typeof Feather.glyphMap;
  labelKey:
    | "accessibility.theme.light"
    | "accessibility.theme.dark"
    | "accessibility.theme.system";
}[] = [
  { id: "light", icon: "sun", labelKey: "accessibility.theme.light" },
  { id: "dark", icon: "moon", labelKey: "accessibility.theme.dark" },
  { id: "system", icon: "monitor", labelKey: "accessibility.theme.system" },
];

/**
 * `icon` is one quiet round button that steps through light, dark and
 * system; the full three-part switch stays for settings-style places.
 */
export function AuthThemeToggle({
  variant = "full",
}: {
  variant?: "full" | "icon";
}) {
  const { themeMode, setThemeMode, resolvedScheme, t } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  if (variant === "icon") {
    const index = Math.max(
      0,
      MODES.findIndex((m) => m.id === themeMode),
    );
    const current = MODES[index];
    const next = MODES[(index + 1) % MODES.length];
    return (
      <Pressable
        onPress={() => setThemeMode(next.id)}
        accessibilityRole="button"
        accessibilityLabel={t(current.labelKey)}
        accessibilityHint={t(next.labelKey)}
        hitSlop={8}
        style={({ pressed }) => [
          styles.iconBtn,
          {
            borderColor: auth.inputBorder,
            backgroundColor: auth.inputBg,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Feather name={current.icon} size={16} color={auth.muted} />
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: auth.formBg, borderColor: auth.inputBorder },
      ]}
    >
      {MODES.map(({ id, icon }) => {
        const selected = themeMode === id;
        return (
          <Pressable
            key={id}
            onPress={() => setThemeMode(id)}
            accessibilityRole="button"
            accessibilityLabel={t(MODES.find((m) => m.id === id)!.labelKey)}
            style={[styles.btn, selected && { backgroundColor: auth.plum }]}
          >
            <Feather
              name={icon}
              size={14}
              color={selected ? "#FFFFFF" : auth.muted}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 999,
    padding: 2,
    gap: 2,
  },
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
