import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import {
  getGetPractitionerSettingsQueryKey,
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsSettingRow } from "@/components/worker/settings/SettingsSettingRow";
import {
  SettingsInfoCallout,
  SettingsLoadingRow,
  SettingsPanelCard,
  SettingsSaveButton,
} from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

const DEFAULT_PHYSICAL_TYPES = [
  "physiotherapy",
  "physio",
  "occupational therapy",
  "OT",
  "physical therapy",
  "therapy",
  "exercise physiology",
  "hydrotherapy",
  "rehabilitation",
  "rehab",
  "massage",
  "manual therapy",
  "sports therapy",
];

type Props = {
  bottomInset?: number;
};

export function SettingsCompliancePanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: serverSettings, isLoading } = useGetPractitionerSettings();
  const { mutateAsync: saveToServer, isPending: saving } = useSavePractitionerSettings();

  const [requireActivity, setRequireActivity] = useState(false);
  const [requireNotes, setRequireNotes] = useState(false);
  const [requireDuration, setRequireDuration] = useState(false);
  const [physicalExamSessionTypes, setPhysicalExamSessionTypes] = useState<string[]>([]);
  const [newSessionType, setNewSessionType] = useState("");

  useEffect(() => {
    if (!serverSettings?.compliance) return;
    const comp = serverSettings.compliance;
    if (comp.requireActivity != null) setRequireActivity(comp.requireActivity);
    if (comp.requireNotes != null) setRequireNotes(comp.requireNotes);
    if (comp.requireDuration != null) setRequireDuration(comp.requireDuration);
    if (comp.physicalExamSessionTypes != null) {
      setPhysicalExamSessionTypes(comp.physicalExamSessionTypes);
    }
  }, [serverSettings?.compliance]);

  const handleSave = async () => {
    try {
      await saveToServer({
        data: {
          compliance: {
            requireActivity,
            requireNotes,
            requireDuration,
            physicalExamSessionTypes:
              physicalExamSessionTypes.length > 0 ? physicalExamSessionTypes : null,
          },
        },
      });
      showToast(t("settings.toast.complianceSaved"), "success");
      void queryClient.invalidateQueries({ queryKey: getGetPractitionerSettingsQueryKey() });
    } catch {
      showToast(t("settings.toast.saveFailed"), "error");
    }
  };

  const handleAddSessionType = () => {
    const trimmed = newSessionType.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (physicalExamSessionTypes.some((item) => item.toLowerCase() === lower)) {
      showToast(t("settings.toast.alreadyInListDesc").replace("{name}", trimmed), "error");
      return;
    }
    setPhysicalExamSessionTypes((prev) => [...prev, trimmed]);
    setNewSessionType("");
  };

  const handleRemoveSessionType = (index: number) => {
    setPhysicalExamSessionTypes((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {t("settings.compliance.subtitle")}
      </Text>
      <View>
        <SettingsPanelCard label={t("settings.compliance.required")}>
          {isLoading ? (
            <SettingsLoadingRow label={t("settings.loading")} />
          ) : (
            <View>
              <SettingsSettingRow
                title={t("settings.compliance.requireActivity")}
                description={t("settings.compliance.requireActivityDesc")}
                checked={requireActivity}
                onCheckedChange={setRequireActivity}
                showDivider
              />
              <SettingsSettingRow
                title={t("settings.compliance.requireNotes")}
                description={t("settings.compliance.requireNotesDesc")}
                checked={requireNotes}
                onCheckedChange={setRequireNotes}
                showDivider
              />
              <SettingsSettingRow
                title={t("settings.compliance.requireDuration")}
                description={t("settings.compliance.requireDurationDesc")}
                checked={requireDuration}
                onCheckedChange={setRequireDuration}
              />
            </View>
          )}
        </SettingsPanelCard>

        <SettingsPanelCard label={t("settings.compliance.physicalExam")}>
          {isLoading ? (
            <SettingsLoadingRow label={t("settings.loading")} />
          ) : (
            <View style={styles.physicalSection}>
              <Text style={[styles.desc, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {t("settings.compliance.physicalExamDesc")}
              </Text>

              {physicalExamSessionTypes.length > 0 ? (
                <View style={styles.chipRow}>
                  {physicalExamSessionTypes.map((type, index) => (
                    <View
                      key={`${type}-${index}`}
                      style={[styles.chip, { backgroundColor: colors.activeBg, borderColor: colors.border }]}
                    >
                      <Text style={[styles.chipText, { color: colors.primary, fontFamily: "Inter_500Medium" }]}>
                        {type}
                      </Text>
                      <Pressable onPress={() => handleRemoveSessionType(index)} hitSlop={8}>
                        <Feather name="x" size={12} color={colors.mutedForeground} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={[styles.emptyBox, { borderColor: colors.border, backgroundColor: colors.soft }]}>
                  <Feather name="info" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {t("settings.compliance.noCustomTypes")}
                  </Text>
                </View>
              )}

              <View style={styles.addRow}>
                <TextInput
                  value={newSessionType}
                  onChangeText={setNewSessionType}
                  placeholder={t("settings.compliance.addPlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  onSubmitEditing={handleAddSessionType}
                  style={[styles.addInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
                <Pressable
                  onPress={handleAddSessionType}
                  disabled={!newSessionType.trim()}
                  style={[
                    styles.addBtn,
                    {
                      borderColor: colors.border,
                      opacity: newSessionType.trim() ? 1 : 0.5,
                    },
                  ]}
                >
                  <Feather name="plus" size={14} color={colors.foreground} />
                  <Text style={[styles.addBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    {t("settings.compliance.add")}
                  </Text>
                </Pressable>
              </View>

              <View style={[styles.resetRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.resetHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {t("settings.compliance.resetHelper")}
                </Text>
                <Pressable
                  onPress={() => setPhysicalExamSessionTypes(DEFAULT_PHYSICAL_TYPES)}
                  style={styles.resetBtn}
                >
                  <Feather name="rotate-ccw" size={12} color={colors.foreground} />
                  <Text style={[styles.resetBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    {t("settings.compliance.resetDefaults")}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </SettingsPanelCard>

        {!isLoading ? (
          <>
            <SettingsSaveButton label={t("settings.compliance.save")} saving={saving} onPress={() => void handleSave()} />
            <SettingsInfoCallout title={t("settings.compliance.howTitle")}>
              <Text style={[styles.calloutBody, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {t("settings.compliance.howBody1")}
              </Text>
              <Text style={[styles.calloutBody, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {t("settings.compliance.howBody2")}
              </Text>
            </SettingsInfoCallout>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  subtitle: { fontSize: 12, lineHeight: 18, marginBottom: 14 },
  physicalSection: { gap: 12 },
  desc: { fontSize: 12, lineHeight: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { fontSize: 12 },
  emptyBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: 12,
  },
  emptyText: { flex: 1, fontSize: 12, lineHeight: 18 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  addBtnText: { fontSize: 12 },
  resetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  resetHint: { flex: 1, fontSize: 12, lineHeight: 17 },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  resetBtnText: { fontSize: 12 },
  calloutBody: { fontSize: 12, lineHeight: 18 },
});
