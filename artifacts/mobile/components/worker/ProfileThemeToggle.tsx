import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { usePreferences, type ThemeMode } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

const MODES: { id: ThemeMode; icon: keyof typeof Feather.glyphMap; labelKey: "accessibility.theme.light" | "accessibility.theme.dark" | "accessibility.theme.system" }[] = [
  { id: "light", icon: "sun", labelKey: "accessibility.theme.light" },
  { id: "dark", icon: "moon", labelKey: "accessibility.theme.dark" },
  { id: "system", icon: "monitor", labelKey: "accessibility.theme.system" },
];

export function ProfileThemeToggle() {
  const colors = useColors();
  const { themeMode, setThemeMode, t } = usePreferences();

  return (
    <View style={[styles.wrap, { borderBottomColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
        {t("accessibility.theme").toUpperCase()}
      </Text>
      <View style={[styles.grid, { backgroundColor: colors.soft, borderColor: colors.border }]}>
        {MODES.map(({ id, icon, labelKey }) => {
          const selected = themeMode === id;
          return (
            <Pressable
              key={id}
              onPress={() => setThemeMode(id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.option,
                selected && { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Feather name={icon} size={14} color={selected ? colors.primary : colors.mutedForeground} />
              <Text
                style={[
                  styles.optionText,
                  {
                    color: selected ? colors.foreground : colors.mutedForeground,
                    fontFamily: selected ? "Inter_700Bold" : "Inter_500Medium",
                  },
                ]}
                numberOfLines={2}
              >
                {t(labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  label: { fontSize: 10, letterSpacing: 1.2, paddingHorizontal: 2 },
  grid: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  option: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 4,
    paddingVertical: 10,
    minHeight: 64,
  },
  optionText: { fontSize: 10, textAlign: "center", lineHeight: 13 },
});
