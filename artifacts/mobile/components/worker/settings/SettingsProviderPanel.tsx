import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import {
  getGetPractitionerSettingsQueryKey,
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SettingsLoadingRow,
  SettingsPanelCard,
  SettingsSaveButton,
  SettingsSection,
} from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

function isValidABNFormat(abn: string): boolean {
  const digits = abn.replace(/\s/g, "");
  return digits === "" || /^\d{11}$/.test(digits);
}

type Props = {
  bottomInset?: number;
};

export function SettingsProviderPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: serverSettings, isLoading } = useGetPractitionerSettings();
  const { mutateAsync: saveToServer, isPending: saving } = useSavePractitionerSettings();

  const [businessName, setBusinessName] = useState("");
  const [abn, setAbn] = useState("");

  useEffect(() => {
    if (!serverSettings?.provider) return;
    setBusinessName(serverSettings.provider.businessName ?? "");
    setAbn(serverSettings.provider.abn ?? "");
  }, [serverSettings?.provider]);

  const abnDigits = abn.replace(/\s/g, "");
  const abnHas11Digits = /^\d{11}$/.test(abnDigits);
  const abnValid = isValidABNFormat(abn);
  const abnError = abnDigits.length > 0 && abnDigits.length >= 11 && !abnHas11Digits;
  const abnShowValid = abnHas11Digits;
  const digitsNeeded = useMemo(() => Math.max(0, 11 - abnDigits.length), [abnDigits.length]);

  const handleSave = async () => {
    if (!abnValid) {
      showToast(t("settings.toast.invalidAbnDesc"), "error");
      return;
    }
    try {
      await saveToServer({
        data: {
          provider: {
            businessName: businessName.trim() || null,
            abn: abn.replace(/\s/g, "") || null,
          },
        },
      });
      showToast(t("settings.toast.providerSaved"), "success");
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
        title={t("settings.provider.title")}
        description={t("settings.provider.subtitle")}
        icon="briefcase"
      >
        <SettingsPanelCard label={t("settings.provider.businessInfo")}>
          {isLoading ? (
            <SettingsLoadingRow label={t("settings.loading")} />
          ) : (
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                  {t("settings.provider.businessName")}
                </Text>
                <TextInput
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholder={t("settings.provider.businessNamePlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                  {t("settings.provider.abn")}{" "}
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    ({t("settings.provider.abnHint")})
                  </Text>
                </Text>
                <TextInput
                  value={abn}
                  onChangeText={setAbn}
                  placeholder={t("settings.provider.abnPlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  maxLength={14}
                  style={[
                    styles.input,
                    styles.abnInput,
                    {
                      color: colors.foreground,
                      borderColor: abnError ? colors.destructive : colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                />
                {abnError ? (
                  <Text style={[styles.helper, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
                    {t("settings.provider.abnInvalid")}
                  </Text>
                ) : null}
                {!abnError && abnShowValid ? (
                  <View style={styles.validRow}>
                    <Feather name="check" size={12} color="#16A34A" />
                    <Text style={[styles.helper, { color: "#16A34A", fontFamily: "Inter_500Medium" }]}>
                      {t("settings.provider.abnValid")}
                    </Text>
                  </View>
                ) : null}
                {!abnError && !abnShowValid && abnDigits.length > 0 ? (
                  <Text style={[styles.helper, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {t("settings.provider.abnDigitsNeeded").replace("{count}", String(digitsNeeded))}
                  </Text>
                ) : null}
              </View>

              <SettingsSaveButton
                label={t("settings.provider.save")}
                saving={saving}
                disabled={abnError}
                onPress={() => void handleSave()}
              />
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
  abnInput: { maxWidth: 220 },
  helper: { fontSize: 11, lineHeight: 16 },
  validRow: { flexDirection: "row", alignItems: "center", gap: 4 },
});
