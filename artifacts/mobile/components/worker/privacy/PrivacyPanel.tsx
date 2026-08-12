import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
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
  useRequestAccountDeletion,
  useRequestDataExport,
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
  const exportMutation = useRequestDataExport();
  const deletionMutation = useRequestAccountDeletion();
  const [deleteText, setDeleteText] = useState("");
  const deletePhrase = t("privacy.deleteAccount");

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
  scroll: { paddingHorizontal: 16, gap: 24 },
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
