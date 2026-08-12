import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsPanelCard, SettingsSection } from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { usePrivacyOverview, useSetAnalyticsOptOut } from "@/hooks/worker/useWorkerPrivacy";
import { useColors } from "@/hooks/useColors";

type Props = {
  bottomInset?: number;
};

export function ConsentPreferencesPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const { data: overview, isLoading, isError } = usePrivacyOverview();
  const analyticsMutation = useSetAnalyticsOptOut();

  const handleAnalyticsToggle = async (checked: boolean) => {
    try {
      await analyticsMutation.mutateAsync(checked);
      showToast(
        checked ? t("privacy.analyticsOptOutEnabled") : t("privacy.analyticsOptOutDisabled"),
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("privacy.preferenceUpdateFailed"),
        "error",
      );
    }
  };

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
        title={t("settings.row.consent")}
        description={t("privacy.consentSubtitle")}
        icon="check-square"
      >
        <SettingsPanelCard>
          <View style={styles.analyticsRow}>
            <View style={styles.copy}>
              <Text style={[styles.analyticsLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("privacy.analyticsOptOut")}
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {t("privacy.analyticsOptOutHint")}
              </Text>
            </View>
            <Switch
              value={overview.analytics_opt_out}
              onValueChange={(value) => void handleAnalyticsToggle(value)}
              disabled={analyticsMutation.isPending}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
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
  analyticsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  copy: { flex: 1, gap: 4 },
  analyticsLabel: { fontSize: 14 },
  hint: { fontSize: 12, lineHeight: 17 },
});
