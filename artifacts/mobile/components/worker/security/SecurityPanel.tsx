import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SecurityMfaPanel } from "@/components/worker/security/SecurityMfaPanel";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { useMfaStatus } from "@/hooks/worker/useWorkerSecurity";

type Props = {
  bottomInset?: number;
};

export function SecurityPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { isLoading, isError } = useMfaStatus();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("common.loading")}
        </Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.loading}>
        <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("security.loadFailed")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("security.twoFactorSubtitle")}
        </Text>
      </View>
      <SecurityMfaPanel />
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
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  loadingText: { fontSize: 14 },
});
