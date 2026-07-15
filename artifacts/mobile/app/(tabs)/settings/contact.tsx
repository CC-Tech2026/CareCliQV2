import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SettingsPanelCard,
  SettingsSaveButton,
  SettingsSection,
} from "@/components/worker/settings/settings-ui";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { getWorkerProfile, updateWorkerProfile } from "@/lib/user-api";

export default function SettingsContactScreen() {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
  });

  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPhone(profile?.phone?.trim() || "");
  }, [profile?.phone]);

  const handleSave = async () => {
    const trimmed = phone.trim();
    if (!trimmed) {
      showToast(t("settings.contact.phoneRequired"), "error");
      return;
    }
    setSaving(true);
    try {
      await updateWorkerProfile({ phone: trimmed });
      await queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      showToast(t("settings.contact.saved"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.toast.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.contact.title")}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection
          title={t("settings.contact.title")}
          description={t("settings.contact.subtitle")}
          icon="phone"
        >
          <SettingsPanelCard label={t("settings.contact.section")}>
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                  {t("settings.contact.phone")}
                </Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={t("settings.contact.phonePlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                  editable={!isLoading}
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
                label={t("settings.contact.save")}
                saving={saving}
                onPress={() => void handleSave()}
              />
            </View>
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
