import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";

type Props = {
  onClose: () => void;
};

export function WorkerDocumentSheet({ onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { isOnline } = useOffline();

  const openShiftsList = () => {
    onClose();
    router.replace("/(tabs)/shifts" as never);
  };

  const openVoiceNote = () => {
    if (!isOnline) {
      showAlert(t("composer.voice.offlineTitle"), t("composer.voice.offlineBody"));
      return;
    }
    openShiftsList();
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
          onPress={openVoiceNote}
          style={[
            styles.option,
            { backgroundColor: colors.soft, opacity: isOnline ? 1 : 0.55 },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !isOnline }}
        >
          <View style={[styles.optionIcon, { backgroundColor: colors.primary }]}>
            <Feather name={isOnline ? "mic" : "wifi-off"} size={19} color={colors.primaryForeground} />
          </View>
          <View style={styles.optionText}>
            <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("home.documentSheet.voiceNote")}
            </Text>
            <Text style={[styles.optionDesc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {isOnline ? t("home.documentSheet.voiceNoteDesc") : t("composer.voice.offlineHint")}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={openShiftsList}
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
});
