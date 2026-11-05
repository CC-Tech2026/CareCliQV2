import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  icon?: keyof typeof Feather.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
};

/**
 * A simple, accessible list row. Designed to sit in a grouped navigation list;
 * it does not create a separate card for every destination.
 */
export function ClientNavRow({ icon, label, subtitle, onPress }: Props) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={subtitle}
      hitSlop={4}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.soft : colors.card,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.activeBg }]}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.content}>
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={2}
            style={[
              styles.subtitle,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, gap: 2 },
  label: { fontSize: 14, lineHeight: 20 },
  subtitle: { fontSize: 12, lineHeight: 17 },
});
