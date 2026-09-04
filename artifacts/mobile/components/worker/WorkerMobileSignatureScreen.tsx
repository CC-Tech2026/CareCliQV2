import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ShiftSignatureForm } from "@/components/worker/ShiftSignatureForm";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/context/PreferencesContext";
import type { ShiftSignaturePayload } from "@/lib/worker-api";

type Props = {
  participantName: string;
  busy?: boolean;
  onSigned: (payload: ShiftSignaturePayload) => void | Promise<void>;
  onBack: () => void;
};

export function WorkerMobileSignatureScreen({
  participantName,
  busy,
  onSigned,
  onBack,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [blocked, setBlocked] = useState(false);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={onBack}
          disabled={blocked || busy}
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            {t("shift.signature.title")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
            {participantName}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <ShiftSignatureForm busy={busy} onSigned={onSigned} />
      </ScrollView>

      <Modal visible={blocked || Boolean(busy)} transparent animationType="fade">
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={[styles.overlayTitle, { color: "#FFFFFF", fontFamily: "Inter_700Bold" }]}>
            {t("shift.signature.completing")}
          </Text>
          <Text style={[styles.overlayDesc, { color: "#CCCCCC", fontFamily: "Inter_400Regular" }]}>
            {t("shift.signature.completingDesc")}
          </Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 16 },
  subtitle: { fontSize: 12 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 18, 28, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  overlayTitle: { fontSize: 16, marginTop: 8 },
  overlayDesc: { fontSize: 13, textAlign: "center", lineHeight: 18 },
});
