import { FontFamily } from "@/constants/typography";
import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  showDivider?: boolean;
};

export function SettingsSettingRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  showDivider,
}: Props) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.row,
        showDivider && {
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.copy}>
        <Text
          style={[
            styles.title,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.description,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interRegular,
            },
          ]}
        >
          {description}
        </Text>
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={description}
        style={{ minHeight: 44 }}
        value={checked}
        onValueChange={onCheckedChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
  },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 14, lineHeight: 20 },
  description: { fontSize: 12, lineHeight: 18 },
});
