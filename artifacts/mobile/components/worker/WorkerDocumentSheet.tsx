import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useT } from "@/context/PreferencesContext";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import { useWorkerShifts } from "@/hooks/worker/useWorkerShifts";
import { useColors } from "@/hooks/useColors";
import { getPrimaryTodayShiftId } from "@/lib/shift-utils";

type Props = {
  onClose: () => void;
};

export function WorkerDocumentSheet({ onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const landing = useWorkerLandingDashboard();
  const todayShifts = useWorkerShifts("today");

  const targetShiftId = useMemo(() => {
    const fromApi = todayShifts.data?.shifts;
    if (fromApi?.length) return getPrimaryTodayShiftId(fromApi);
    const summary = landing.data?.today_shifts ?? [];
    const active = summary.find(
      (s) => s.visual_state === "session_active" || s.visual_state === "clocked_in",
    );
    return active?.id ?? summary.find((s) => s.visual_state === "scheduled")?.id ?? summary[0]?.id ?? null;
  }, [todayShifts.data?.shifts, landing.data?.today_shifts]);

  const openShift = () => {
    onClose();
    if (targetShiftId) {
      router.push(`/shift/${targetShiftId}` as never);
      return;
    }
    router.replace("/(tabs)/shifts" as never);
  };

  const openIncident = () => {
    onClose();
    router.push("/incidents/new" as never);
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("common.cancel")} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: Math.max(insets.bottom, 24),
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.input }]} />
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("home.documentSheet.title")}
        </Text>

        <Pressable
          onPress={openShift}
          style={[styles.option, { backgroundColor: colors.soft }]}
          accessibilityRole="button"
        >
          <View style={[styles.optionIcon, { backgroundColor: colors.primary }]}>
            <Feather name="mic" size={19} color={colors.primaryForeground} />
          </View>
          <View style={styles.optionText}>
            <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("home.documentSheet.voiceNote")}
            </Text>
            <Text style={[styles.optionDesc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("home.documentSheet.voiceNoteDesc")}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={openShift}
          style={[styles.option, { borderColor: colors.border, borderWidth: 1 }]}
          accessibilityRole="button"
        >
          <View style={[styles.optionIcon, { backgroundColor: colors.soft }]}>
            <Feather name="edit-2" size={19} color={colors.primary} />
          </View>
          <View style={styles.optionText}>
            <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("home.documentSheet.writtenNote")}
            </Text>
            <Text style={[styles.optionDesc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("home.documentSheet.writtenNoteDesc")}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={openIncident}
          style={[styles.option, { borderColor: colors.border, borderWidth: 1 }]}
          accessibilityRole="button"
        >
          <View style={[styles.optionIcon, { backgroundColor: colors.dangerBg }]}>
            <Feather name="alert-triangle" size={19} color={colors.destructive} />
          </View>
          <View style={styles.optionText}>
            <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("home.documentSheet.incident")}
            </Text>
            <Text style={[styles.optionDesc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("home.documentSheet.incidentDesc")}
            </Text>
          </View>
        </Pressable>

        {!targetShiftId ? (
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("home.documentSheet.noShiftDesc")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(24,22,40,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 99,
    alignSelf: "center",
    marginBottom: 14,
  },
  title: { fontSize: 17, marginBottom: 12 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 13 },
  optionDesc: { fontSize: 11 },
  hint: { fontSize: 11, marginTop: 4, marginBottom: 4, lineHeight: 16 },
});
