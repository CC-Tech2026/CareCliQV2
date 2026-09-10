import { FontFamily } from "@/constants/typography";
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

export function SettingsLinkRow({
  icon,
  label,
  value,
  onPress,
  showDivider,
}: Props) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && {
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        pressed && { backgroundColor: colors.soft },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.soft }]}>
        <Feather name={icon} size={18} color={colors.composerPurple} />
      </View>
      <View style={styles.copy}>
        <Text
          style={[
            styles.label,
            { color: colors.foreground, fontFamily: FontFamily.interBold },
          ]}
        >
          {label}
        </Text>
        {value ? (
          <Text
            style={[
              styles.value,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
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
  value: { fontSize: 13, lineHeight: 19 },
});
