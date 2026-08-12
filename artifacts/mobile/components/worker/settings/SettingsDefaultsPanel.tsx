import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPractitionerSettingsQueryKey,
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsSettingRow } from "@/components/worker/settings/SettingsSettingRow";
import {
  SettingsLoadingRow,
  SettingsPanelCard,
  SettingsSaveButton,
  SettingsSection,
} from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

type Props = {
  bottomInset?: number;
};

export function SettingsDefaultsPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: serverSettings, isLoading } = useGetPractitionerSettings();
  const { mutateAsync: saveToServer, isPending: saving } = useSavePractitionerSettings();

  const [defaultDuration, setDefaultDuration] = useState("60");
  const [autoStartTimer, setAutoStartTimer] = useState(false);
  const [enableVoice, setEnableVoice] = useState(false);

  useEffect(() => {
    if (!serverSettings?.sessionDefaults) return;
    const sd = serverSettings.sessionDefaults;
    if (sd.defaultDuration != null) setDefaultDuration(String(sd.defaultDuration));
    if (sd.autoStartTimer != null) setAutoStartTimer(sd.autoStartTimer);
    if (sd.enableVoice != null) setEnableVoice(sd.enableVoice);
  }, [serverSettings?.sessionDefaults]);

  const handleSave = async () => {
    try {
      await saveToServer({
        data: {
          sessionDefaults: {
            defaultDuration: defaultDuration ? Number(defaultDuration) : null,
            autoStartTimer,
            enableVoice,
          },
        },
      });
      showToast(t("settings.toast.defaultsSaved"), "success");
      void queryClient.invalidateQueries({ queryKey: getGetPractitionerSettingsQueryKey() });
    } catch {
      showToast(t("settings.toast.saveFailed"), "error");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <SettingsSection
        title={t("settings.defaults.title")}
        description={t("settings.defaults.subtitle")}
        icon="sliders"
      >
        <SettingsPanelCard label={t("settings.defaults.duration")}>
          {isLoading ? (
            <SettingsLoadingRow label={t("settings.loading")} />
          ) : (
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                {t("settings.defaults.durationLabel")}{" "}
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                  ({t("settings.defaults.durationUnit")})
                </Text>
              </Text>
              <TextInput
                value={defaultDuration}
                onChangeText={setDefaultDuration}
                keyboardType="number-pad"
                placeholder="60"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.durationInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
              <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {t("settings.defaults.durationHint")}
              </Text>
            </View>
          )}
        </SettingsPanelCard>

        <SettingsPanelCard label={t("settings.defaults.automation")}>
          {isLoading ? (
            <SettingsLoadingRow label={t("settings.loading")} />
          ) : (
            <View>
              <SettingsSettingRow
                title={t("settings.defaults.autoStartTimer")}
                description={t("settings.defaults.autoStartTimerDesc")}
                checked={autoStartTimer}
                onCheckedChange={setAutoStartTimer}
                showDivider
              />
              <SettingsSettingRow
                title={t("settings.defaults.enableVoice")}
                description={t("settings.defaults.enableVoiceDesc")}
                checked={enableVoice}
                onCheckedChange={setEnableVoice}
              />
            </View>
          )}
        </SettingsPanelCard>

        {!isLoading ? (
          <SettingsSaveButton label={t("settings.defaults.save")} saving={saving} onPress={() => void handleSave()} />
        ) : null}
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  field: { gap: 6 },
  label: { fontSize: 12 },
  durationInput: {
    maxWidth: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  hint: { fontSize: 12, lineHeight: 18 },
});
