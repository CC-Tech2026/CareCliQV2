import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsPanelCard, SettingsSection } from "@/components/worker/settings/settings-ui";
import { useT } from "@/context/PreferencesContext";
import { usePrivacyOverview } from "@/hooks/worker/useWorkerPrivacy";
import { useColors } from "@/hooks/useColors";

type Props = {
  bottomInset?: number;
};

export function DataPermissionsPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { data: overview, isLoading, isError } = usePrivacyOverview();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || !overview) {
    return (
      <View style={styles.loading}>
        <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("privacy.loadFailed")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <SettingsSection
        title={t("settings.row.dataPermissions")}
        description={t("privacy.dataPermissionsSubtitle")}
        icon="sliders"
      >
        <SettingsPanelCard>
          <View style={styles.categoryList}>
            {overview.data_categories.map((cat) => (
              <View
                key={cat.id}
                style={[styles.categoryCard, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Text style={[styles.categoryTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  {cat.title}
                </Text>
                <Text style={[styles.categoryDescription, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {cat.description}
                </Text>
                <Text style={[styles.categoryRetention, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                  {t("privacy.retention")} {cat.retention}
                </Text>
              </View>
            ))}
          </View>
        </SettingsPanelCard>
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 24 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  loadingText: { fontSize: 14 },
  categoryList: { gap: 10 },
  categoryCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  categoryTitle: { fontSize: 14, lineHeight: 18 },
  categoryDescription: { fontSize: 12, lineHeight: 17 },
  categoryRetention: { fontSize: 11, marginTop: 2 },
});
