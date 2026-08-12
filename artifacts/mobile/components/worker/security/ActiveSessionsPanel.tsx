import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SecuritySessionsPanel } from "@/components/worker/security/SecuritySessionsPanel";
import { SecurityTrustedDevicesPanel } from "@/components/worker/security/SecurityTrustedDevicesPanel";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

type Props = {
  bottomInset?: number;
};

export function ActiveSessionsPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("security.sessionsPageSubtitle")}
        </Text>
      </View>
      <SecurityTrustedDevicesPanel />
      <SecuritySessionsPanel />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    gap: 24,
  },
  header: { gap: 4, marginBottom: 4 },
  subtitle: { fontSize: 13, lineHeight: 18 },
});
