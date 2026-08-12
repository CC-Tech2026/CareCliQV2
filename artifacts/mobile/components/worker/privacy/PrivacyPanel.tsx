import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SettingsPanelCard,
  SettingsSection,
} from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import {
  usePrivacyOverview,
  usePrivacyPolicyVersions,
  useRequestAccountDeletion,
  useRequestDataExport,
  useSetAnalyticsOptOut,
} from "@/hooks/worker/useWorkerPrivacy";
import { useColors } from "@/hooks/useColors";

const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

type Props = {
  bottomInset?: number;
};

export function PrivacyPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();

  const { data: overview, isLoading, isError } = usePrivacyOverview();
  const { data: versionsData } = usePrivacyPolicyVersions();
  const exportMutation = useRequestDataExport();
  const deletionMutation = useRequestAccountDeletion();
  const analyticsMutation = useSetAnalyticsOptOut();

  const [policyOpen, setPolicyOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const deletePhrase = t("privacy.deleteAccount");
  const versions = versionsData?.versions ?? [];

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync();
      showToast(result.message || t("privacy.exportRequested"), "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("privacy.exportFailed"),
        "error",
      );
    }
  };

  const handleDeletion = async () => {
    try {
      const result = await deletionMutation.mutateAsync(deleteText);
      showToast(result.message || t("privacy.requestSubmitted"), "success");
      setDeleteText("");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("privacy.submitFailed"),
        "error",
      );
    }
  };

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
        <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("common.loading")}
        </Text>
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
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
          {t("privacy.eyebrow")}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("privacy.subtitle")}
        </Text>
      </View>

      <SettingsSection
        title={t("privacy.dataHeld")}
        description=""
        icon="shield"
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

      <SettingsSection title={t("privacy.downloadData")} description={t("privacy.downloadHint")} icon="download">
        <SettingsPanelCard>
          <Pressable
            onPress={() => void handleExport()}
            disabled={exportMutation.isPending}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: colors.primary,
                opacity: exportMutation.isPending ? 0.55 : 1,
              },
            ]}
          >
            {exportMutation.isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Feather name="download" size={14} color="#FFFFFF" />
                <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                  {t("privacy.downloadMyData")}
                </Text>
              </>
            )}
          </Pressable>
        </SettingsPanelCard>
      </SettingsSection>

      <SettingsSection title={t("privacy.policy")} description="" icon="file-text">
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

      <SettingsSection title={t("privacy.analyticsOptOut")} description={t("privacy.analyticsOptOutHint")} icon="bar-chart-2">
        <SettingsPanelCard>
          <View style={styles.analyticsRow}>
            <Text style={[styles.analyticsLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("privacy.analyticsOptOut")}
            </Text>
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

      <View
        style={[
          styles.deletionCard,
          {
            borderColor: "rgba(239, 68, 68, 0.35)",
            backgroundColor: colors.card,
          },
        ]}
      >
        <View style={styles.deletionHeader}>
          <Feather name="trash-2" size={18} color="#B91C1C" />
          <Text style={[styles.deletionTitle, { color: "#B91C1C", fontFamily: "Inter_700Bold" }]}>
            {t("privacy.requestDeletion")}
          </Text>
        </View>
        <Text style={[styles.deletionHint, { color: "#B91C1C", fontFamily: "Inter_400Regular" }]}>
          {t("privacy.deleteHint", { phrase: deletePhrase })}
        </Text>
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
            {t("privacy.confirmation")}
          </Text>
          <TextInput
            value={deleteText}
            onChangeText={setDeleteText}
            placeholder={deletePhrase}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
        </View>
        <Pressable
          onPress={() => void handleDeletion()}
          disabled={deletionMutation.isPending || deleteText.trim() !== DELETE_CONFIRMATION}
          style={[
            styles.dangerBtn,
            {
              borderColor: "rgba(239, 68, 68, 0.35)",
              opacity: deletionMutation.isPending || deleteText.trim() !== DELETE_CONFIRMATION ? 0.55 : 1,
            },
          ]}
        >
          {deletionMutation.isPending ? (
            <ActivityIndicator color="#B91C1C" size="small" />
          ) : (
            <Text style={[styles.dangerBtnText, { fontFamily: "Inter_600SemiBold" }]}>
              {t("privacy.requestDeletion")}
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    gap: 24,
  },
  header: { gap: 6, marginBottom: 4 },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  subtitle: { fontSize: 13, lineHeight: 18 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
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
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "flex-start",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minWidth: 180,
  },
  primaryBtnText: { fontSize: 13, color: "#FFFFFF" },
  policyText: { fontSize: 13, lineHeight: 20 },
  policyMeta: { fontSize: 11, marginTop: 8 },
  policyToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 12,
  },
  policyToggleText: { fontSize: 13 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  versionList: { marginTop: 8, gap: 4 },
  versionItem: { fontSize: 12, lineHeight: 17 },
  analyticsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  analyticsLabel: { flex: 1, fontSize: 14 },
  deletionCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  deletionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  deletionTitle: { fontSize: 17 },
  deletionHint: { fontSize: 12, lineHeight: 17 },
  field: { gap: 6 },
  label: { fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  dangerBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minWidth: 200,
    alignItems: "center",
  },
  dangerBtnText: { fontSize: 13, color: "#B91C1C" },
});
