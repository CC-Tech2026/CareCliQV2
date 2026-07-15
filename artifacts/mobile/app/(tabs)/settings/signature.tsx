import {
  getGetPractitionerSettingsQueryKey,
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsSignaturePad } from "@/components/worker/settings/SettingsSignaturePad";
import {
  SettingsLoadingRow,
  SettingsPanelCard,
  SettingsSection,
} from "@/components/worker/settings/settings-ui";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";

export default function SettingsSignatureScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: serverSettings, isLoading } = useGetPractitionerSettings();
  const { mutateAsync: saveToServer, isPending: saving } = useSavePractitionerSettings();

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

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.signature.label")}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection
          title={t("settings.signature.label")}
          description={t("settings.signature.subtitle")}
          icon="edit-3"
        >
          <SettingsPanelCard label={t("settings.signature.section")}>
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
        </SettingsSection>
      </ScrollView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
});
