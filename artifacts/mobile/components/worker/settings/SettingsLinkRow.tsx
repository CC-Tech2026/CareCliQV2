import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value?: string;
  onPress: () => void;
  showDivider?: boolean;
};

export function SettingsLinkRow({ icon, label, value, onPress, showDivider }: Props) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.soft },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.soft }]}>
        <Feather name={icon} size={18} color={colors.composerPurple} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
          {label}
        </Text>
        {value ? (
          <Text
            style={[styles.value, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
            numberOfLines={2}
          >
            {value}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 3 },
  label: { fontSize: 15, lineHeight: 20 },
  value: { fontSize: 12, lineHeight: 16 },
});
