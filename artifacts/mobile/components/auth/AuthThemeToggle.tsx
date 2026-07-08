import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { getAuthColors } from "@/constants/auth-colors";
import { usePreferences, type ThemeMode } from "@/context/PreferencesContext";

const MODES: { id: ThemeMode; icon: keyof typeof Feather.glyphMap; labelKey: "accessibility.theme.light" | "accessibility.theme.dark" | "accessibility.theme.system" }[] = [
  { id: "light", icon: "sun", labelKey: "accessibility.theme.light" },
  { id: "dark", icon: "moon", labelKey: "accessibility.theme.dark" },
  { id: "system", icon: "monitor", labelKey: "accessibility.theme.system" },
];

export function AuthThemeToggle() {
  const { themeMode, setThemeMode, resolvedScheme, t } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  return (
    <View style={[styles.wrap, { backgroundColor: auth.formBg, borderColor: auth.inputBorder }]}>
      {MODES.map(({ id, icon }) => {
        const selected = themeMode === id;
        return (
          <Pressable
            key={id}
            onPress={() => setThemeMode(id)}
            accessibilityRole="button"
            accessibilityLabel={t(MODES.find((m) => m.id === id)!.labelKey)}
            style={[
              styles.btn,
              selected && { backgroundColor: auth.plum },
            ]}
          >
            <Feather name={icon} size={14} color={selected ? "#FFFFFF" : auth.muted} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
