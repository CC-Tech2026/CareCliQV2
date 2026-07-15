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
import {
  getWorkerProfile,
  updateWorkerProfile,
  type WorkerEmergencyContact,
} from "@/lib/user-api";

function parseEmergency(raw: WorkerEmergencyContact | string | null | undefined): WorkerEmergencyContact {
  if (!raw) return { name: "", phone: "", relationship: "" };
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as WorkerEmergencyContact;
      if (parsed && typeof parsed === "object") {
        return {
          name: parsed.name ?? "",
          phone: parsed.phone ?? "",
          relationship: parsed.relationship ?? "",
        };
      }
    } catch {
      return { name: raw, phone: "", relationship: "" };
    }
  }
  return {
    name: raw.name ?? "",
    phone: raw.phone ?? "",
    relationship: raw.relationship ?? "",
  };
}

export default function SettingsEmergencyContactScreen() {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const parsed = parseEmergency(profile?.emergency_contact);
    setName(parsed.name?.trim() || "");
    setPhone(parsed.phone?.trim() || "");
    setRelationship(parsed.relationship?.trim() || "");
  }, [profile?.emergency_contact]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName || !trimmedPhone) {
      showToast(t("settings.emergency.required"), "error");
      return;
    }
    setSaving(true);
    try {
      await updateWorkerProfile({
        emergency_contact: {
          name: trimmedName,
          phone: trimmedPhone,
          relationship: relationship.trim() || null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      showToast(t("settings.emergency.saved"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.toast.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.emergency.title")}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection
          title={t("settings.emergency.title")}
          description={t("settings.emergency.subtitle")}
          icon="alert-circle"
        >
          <SettingsPanelCard label={t("settings.emergency.section")}>
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                  {t("settings.emergency.name")}
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={t("settings.emergency.namePlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
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
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                  {t("settings.emergency.phone")}
                </Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={t("settings.emergency.phonePlaceholder")}
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
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                  {t("settings.emergency.relationship")}
                </Text>
                <TextInput
                  value={relationship}
                  onChangeText={setRelationship}
                  placeholder={t("settings.emergency.relationshipPlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
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
                label={t("settings.emergency.save")}
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
