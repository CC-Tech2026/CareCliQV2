import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsPanelCard, SettingsSection } from "@/components/worker/settings/settings-ui";
import { useT } from "@/context/PreferencesContext";
import { usePrivacyOverview, usePrivacyPolicyVersions } from "@/hooks/worker/useWorkerPrivacy";
import { useColors } from "@/hooks/useColors";

type Props = {
  bottomInset?: number;
};

export function PrivacyPolicyPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { data: overview, isLoading, isError } = usePrivacyOverview();
  const { data: versionsData } = usePrivacyPolicyVersions();
  const [policyOpen, setPolicyOpen] = useState(false);
  const versions = versionsData?.versions ?? [];

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
      <SettingsSection title={t("privacy.policy")} description={t("privacy.policyPageSubtitle")} icon="file-text">
        <SettingsPanelCard>
          <Text style={[styles.policyText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
            {overview.privacy_policy.summary_text}
          </Text>
          {overview.privacy_policy.published_at ? (
            <Text style={[styles.policyMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("privacy.lastUpdated", {
                date: new Date(overview.privacy_policy.published_at).toLocaleDateString(),
                version: overview.privacy_policy.version,
              })}
            </Text>
          ) : null}
          <Pressable onPress={() => setPolicyOpen((open) => !open)} style={styles.policyToggle}>
            <Text style={[styles.policyToggleText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
              {t("privacy.versionHistory")}
            </Text>
            <Feather
              name="chevron-down"
              size={16}
              color={colors.primary}
              style={policyOpen ? styles.chevronOpen : undefined}
            />
          </Pressable>
          {policyOpen ? (
            <View style={styles.versionList}>
              {versions.map((version) => (
                <Text
                  key={version.version}
                  style={[styles.versionItem, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
                >
                  {t("privacy.versionEntry", {
                    version: version.version,
                    date: version.published_at
                      ? new Date(version.published_at).toLocaleDateString()
                      : "—",
                    current: version.is_current ? ` ${t("privacy.current")}` : "",
                  })}
                </Text>
              ))}
            </View>
          ) : null}
        </SettingsPanelCard>
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 24 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  loadingText: { fontSize: 14 },
  policyText: { fontSize: 13, lineHeight: 20 },
  policyMeta: { fontSize: 11, marginTop: 8 },
  policyToggle: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 },
  policyToggleText: { fontSize: 13 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  versionList: { marginTop: 8, gap: 4 },
  versionItem: { fontSize: 12, lineHeight: 17 },
});
