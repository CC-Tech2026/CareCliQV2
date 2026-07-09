import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPractitionerSettingsQueryKey,
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SettingsAvatarPicker,
  SettingsAvatarStatus,
} from "@/components/worker/settings/SettingsAvatarPicker";
import { SettingsSignaturePad } from "@/components/worker/settings/SettingsSignaturePad";
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

export function SettingsAccountPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: serverSettings, isLoading } = useGetPractitionerSettings();
  const { mutateAsync: saveToServer, isPending: saving } = useSavePractitionerSettings();

  const [practName, setPractName] = useState("");
  const [practCredentials, setPractCredentials] = useState("");
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [savingPract, setSavingPract] = useState(false);

  useEffect(() => {
    if (!serverSettings) return;
    setPractName(serverSettings.name ?? "");
    setPractCredentials(serverSettings.credentials ?? "");
    setAvatarId(serverSettings.avatarId ?? null);
  }, [serverSettings]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getGetPractitionerSettingsQueryKey() });
  };

  const handleSaveSignature = async (dataUrl: string) => {
    try {
      await saveToServer({
        data: {
          signature: dataUrl,
          name: serverSettings?.name ?? null,
          credentials: serverSettings?.credentials ?? null,
        },
      });
      showToast(t("settings.toast.signatureSaved"), "success");
      invalidate();
    } catch {
      showToast(t("settings.toast.saveFailed"), "error");
    }
  };

  const handleClearSignature = async () => {
    try {
      await saveToServer({
        data: {
          signature: null,
          name: serverSettings?.name ?? null,
          credentials: serverSettings?.credentials ?? null,
        },
      });
      showToast(t("settings.toast.signatureRemoved"), "success");
      invalidate();
    } catch {
      showToast(t("settings.toast.saveFailed"), "error");
    }
  };

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
      invalidate();
    } catch {
      showToast(t("settings.toast.saveFailed"), "error");
    } finally {
      setSavingPract(false);
    }
  };

  const handleAvatarChange = async (newId: string) => {
    setAvatarId(newId);
    try {
      await saveToServer({ data: { avatarId: newId } });
      invalidate();
    } catch {
      showToast(t("settings.toast.avatarSaveFailed"), "error");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <SettingsSection
        title={t("settings.account.title")}
        description={t("settings.account.subtitle")}
        icon="user"
      >
        <SettingsPanelCard label={t("settings.signature.label")}>
          {isLoading ? (
            <SettingsLoadingRow label={t("settings.loading")} />
          ) : (
            <SettingsSignaturePad
              saving={saving}
              savedSignature={serverSettings?.signature}
              onSave={handleSaveSignature}
              onClearSaved={handleClearSignature}
            />
          )}
        </SettingsPanelCard>

        <SettingsPanelCard label={t("settings.practitioner.label")}>
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
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
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
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
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

        <SettingsPanelCard label={t("settings.avatar.label")}>
          {isLoading ? (
            <SettingsLoadingRow label={t("settings.loading")} />
          ) : (
            <View>
              <SettingsAvatarStatus
                avatarId={avatarId}
                selectedLabel={t("settings.avatar.selected")}
                noneLabel={t("settings.avatar.none")}
                hint={t("settings.avatar.hint")}
              />
              <SettingsAvatarPicker value={avatarId} onChange={(id) => void handleAvatarChange(id)} />
            </View>
          )}
        </SettingsPanelCard>
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
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
