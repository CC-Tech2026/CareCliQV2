import {
  getGetPractitionerSettingsQueryKey,
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SettingsLoadingRow,
  SettingsPanelCard,
  SettingsSaveButton,
  SettingsSection,
} from "@/components/worker/settings/settings-ui";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

export default function SettingsPractitionerScreen() {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: serverSettings, isLoading } = useGetPractitionerSettings();
  const { mutateAsync: saveToServer } = useSavePractitionerSettings();

  const [practName, setPractName] = useState("");
  const [practCredentials, setPractCredentials] = useState("");
  const [savingPract, setSavingPract] = useState(false);

  useEffect(() => {
    if (!serverSettings) return;
    setPractName(serverSettings.name ?? "");
    setPractCredentials(serverSettings.credentials ?? "");
  }, [serverSettings]);

  const handleSavePractitioner = async () => {
    setSavingPract(true);
    try {
      await saveToServer({
        data: {
          name: practName.trim() || null,
          credentials: practCredentials.trim() || null,
        },
      });
      showToast(t("settings.toast.practitionerSaved"), "success");
      void queryClient.invalidateQueries({ queryKey: getGetPractitionerSettingsQueryKey() });
    } catch {
      showToast(t("settings.toast.saveFailed"), "error");
    } finally {
      setSavingPract(false);
    }
  };

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.practitioner.label")}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection
          title={t("settings.practitioner.label")}
          description={t("settings.practitioner.subtitle")}
          icon="briefcase"
        >
          <SettingsPanelCard label={t("settings.practitioner.section")}>
            {isLoading ? (
              <SettingsLoadingRow label={t("settings.loading")} />
            ) : (
              <View style={styles.form}>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                    {t("settings.practitioner.fullName")}
                  </Text>
                  <TextInput
                    value={practName}
                    onChangeText={setPractName}
                    placeholder={t("settings.practitioner.namePlaceholder")}
                    placeholderTextColor={colors.mutedForeground}
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
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                    {t("settings.practitioner.credentials")}
                  </Text>
                  <TextInput
                    value={practCredentials}
                    onChangeText={setPractCredentials}
                    placeholder={t("settings.practitioner.credentialsPlaceholder")}
                    placeholderTextColor={colors.mutedForeground}
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
                <SettingsSaveButton
                  label={t("settings.practitioner.save")}
                  saving={savingPract}
                  onPress={() => void handleSavePractitioner()}
                />
              </View>
            )}
          </SettingsPanelCard>
        </SettingsSection>
      </ScrollView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  form: { gap: 14 },
  field: { gap: 6 },
  label: { fontSize: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
