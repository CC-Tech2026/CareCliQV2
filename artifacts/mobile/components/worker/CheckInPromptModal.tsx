import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import type { CheckinStatus } from "@/lib/worker-api";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (status: CheckinStatus) => void;
  busy?: boolean;
  gapMinutes?: number;
};

const OPTIONS: Array<{ status: CheckinStatus; label: string; destructive?: boolean }> = [
  { status: "GOING_WELL", label: "Going well" },
  { status: "NEEDS_ATTENTION", label: "Needs attention" },
  { status: "INCIDENT_REPORTED", label: "Report incident", destructive: true },
];

export function CheckInPromptModal({ visible, onClose, onSubmit, busy, gapMinutes }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const handleSubmit = (status: CheckinStatus) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSubmit(status);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}>
            <Feather name="message-circle" size={20} color={colors.primary} />
            <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Shift check-in due
            </Text>
          </View>
          <Text style={[styles.desc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {gapMinutes != null && gapMinutes >= 90
              ? `No activity for ${gapMinutes} minutes. Tap a status to confirm you are OK.`
              : "Please confirm how the shift is going."}
          </Text>

          <View style={styles.options}>
            {OPTIONS.map((opt) => (
              <Pressable
                key={opt.status}
                onPress={() => handleSubmit(opt.status)}
                disabled={busy}
                style={[
                  styles.optionBtn,
                  {
                    backgroundColor: opt.destructive ? colors.destructive : colors.background,
                    borderColor: opt.destructive ? colors.destructive : colors.border,
                    opacity: busy ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    {
                      color: opt.destructive ? "#FFFFFF" : colors.foreground,
                      fontFamily: "Inter_600SemiBold",
                    },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {busy ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : (
            <Pressable onPress={onClose} style={styles.dismissBtn}>
              <Text style={[styles.dismissText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                Dismiss for now
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 18 },
  desc: { fontSize: 14, lineHeight: 20 },
  options: { gap: 10, marginTop: 4 },
  optionBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { fontSize: 15 },
  spinner: { marginTop: 8 },
  dismissBtn: { alignItems: "center", paddingVertical: 12 },
  dismissText: { fontSize: 14 },
});
