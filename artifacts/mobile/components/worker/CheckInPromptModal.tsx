import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import React from "react";
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

import { useColors } from "@/hooks/useColors";
import type { CheckinStatus } from "@/lib/worker-api";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (status: CheckinStatus) => void;
  busy?: boolean;
  gapMinutes?: number;
};

const OPTIONS: Array<{
  status: CheckinStatus;
  label: string;
  destructive?: boolean;
}> = [
  { status: "GOING_WELL", label: "Going well" },
  { status: "NEEDS_ATTENTION", label: "Needs attention" },
  { status: "INCIDENT_REPORTED", label: "Report incident", destructive: true },
];

export function CheckInPromptModal({
  visible,
  onClose,
  onSubmit,
  busy,
  gapMinutes,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const handleSubmit = (status: CheckinStatus) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSubmit(status);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <View style={[styles.overlay, { paddingTop: insets.top + 16 }]}>
        <ScrollView
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.card }]}
          contentContainerStyle={{
            padding: 24,
            gap: 16,
            paddingBottom: insets.bottom + 20,
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              alignSelf: "center",
              backgroundColor: colors.border,
            }}
          />
          <View style={styles.header}>
            <Feather name="message-circle" size={20} color={colors.primary} />
            <Text
              style={[
                styles.title,
                { color: colors.foreground, fontFamily: FontFamily.interBold },
              ]}
            >
              Shift check-in due
            </Text>
          </View>
          <Text
            style={[
              styles.desc,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {gapMinutes != null && gapMinutes >= 90
              ? `No activity for ${gapMinutes} minutes. Tap a status to confirm you are OK.`
              : "Please confirm how the shift is going."}
          </Text>

          <View style={styles.options}>
            {OPTIONS.map((opt) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                key={opt.status}
                onPress={() => handleSubmit(opt.status)}
                disabled={busy}
                style={[
                  styles.optionBtn,
                  {
                    backgroundColor: opt.destructive
                      ? colors.destructive
                      : colors.background,
                    borderColor: opt.destructive
                      ? colors.destructive
                      : colors.border,
                    opacity: busy ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    {
                      color: opt.destructive ? "#FFFFFF" : colors.foreground,
                      fontFamily: FontFamily.interSemiBold,
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
              <Text
                style={[
                  styles.dismissText,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interMedium,
                  },
                ]}
              >
                Dismiss for now
              </Text>
            </Pressable>
          )}
        </ScrollView>
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
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    maxHeight: "100%",
    flexGrow: 0,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 22, flex: 1 },
  desc: { fontSize: 14, lineHeight: 20 },
  options: { gap: 10, marginTop: 4 },
  optionBtn: {
    minHeight: 52,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { fontSize: 15 },
  spinner: { marginTop: 8 },
  dismissBtn: { alignItems: "center", paddingVertical: 12 },
  dismissText: { fontSize: 14 },
});
