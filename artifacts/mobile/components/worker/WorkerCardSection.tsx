import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  children: React.ReactNode;
};

/**
 * Rounded card with an icon + bold heading, matching the frontend's
 * accessibility/settings section cards (plum accent, subtle border).
 */
export function WorkerCardSection({ icon, title, children }: Props) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Feather name={icon} size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14 },
});
