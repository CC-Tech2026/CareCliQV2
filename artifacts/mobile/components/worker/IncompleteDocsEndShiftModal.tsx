import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type Props = {
  visible: boolean;
  incompleteTaskLabels: string[];
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  busy?: boolean;
};

const MIN_REASON_CHARS = 10;

export function IncompleteDocsEndShiftModal({
  visible,
  incompleteTaskLabels,
  onCancel,
  onConfirm,
  busy,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");

  const canConfirm = acknowledged && reason.trim().length >= MIN_REASON_CHARS;

  const handleClose = () => {
    if (busy) return;
    setAcknowledged(false);
    setReason("");
    onCancel();
  };

  const handleConfirm = () => {
    if (!canConfirm || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onConfirm(reason.trim());
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
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
            <Feather name="alert-triangle" size={20} color={colors.destructive} />
            <Text
              style={[
                styles.title,
                { color: colors.foreground, fontFamily: FontFamily.interBold },
              ]}
            >
              Documentation incomplete
            </Text>
          </View>

          <Text
            style={[
              styles.desc,
              { color: colors.mutedForeground, fontFamily: FontFamily.interRegular },
            ]}
          >
            You can still end this shift, but the following mandatory task
            {incompleteTaskLabels.length === 1 ? "" : "s"} won't have documentation
            or evidence attached:
          </Text>

          <View
            style={[
              styles.taskList,
              { borderColor: colors.border, backgroundColor: colors.background },
            ]}
          >
            {incompleteTaskLabels.map((label) => (
              <View key={label} style={styles.taskRow}>
                <Feather name="x-circle" size={14} color={colors.destructive} />
                <Text
                  style={[
                    styles.taskLabel,
                    { color: colors.foreground, fontFamily: FontFamily.interMedium },
                  ]}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>

          <Text
            style={[
              styles.desc,
              { color: colors.mutedForeground, fontFamily: FontFamily.interRegular },
            ]}
          >
            An incomplete record can affect the participant's care continuity and
            may not meet NDIS documentation requirements. Your coordinator will
            see this shift flagged for review.
          </Text>

          <Text
            style={[
              styles.desc,
              { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
            ]}
          >
            You'll still need to finish this documentation — you have 24 hours
            from when you clocked in to come back and complete it before it's
            flagged as overdue.
          </Text>

          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setAcknowledged((prev) => !prev);
            }}
            disabled={busy}
            style={[styles.checkRow, { borderColor: colors.border, backgroundColor: colors.background }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acknowledged, disabled: busy }}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: acknowledged ? colors.primary : colors.border,
                  backgroundColor: acknowledged ? colors.primary : "transparent",
                },
              ]}
            >
              {acknowledged && (
                <Feather name="check" size={14} color={colors.primaryForeground} />
              )}
            </View>
            <Text
              style={[
                styles.checkLabel,
                { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
              ]}
            >
              I understand the risks of ending this shift without completing
              documentation.
            </Text>
          </Pressable>

          <View style={{ gap: 6 }}>
            <Text
              style={[
                styles.label,
                { color: colors.mutedForeground, fontFamily: FontFamily.interBold },
              ]}
            >
              WHY ARE YOU ENDING EARLY / WITHOUT FINISHING DOCUMENTATION?
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Participant became unwell, had to leave for another shift, ran out of time…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              editable={!busy}
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.foreground, fontFamily: FontFamily.interRegular },
              ]}
            />
          </View>

          {busy ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : (
            <View style={styles.actions}>
              <Pressable
                onPress={handleClose}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text
                  style={[
                    styles.secondaryBtnText,
                    { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
                  ]}
                >
                  Go back and finish
                </Text>
              </Pressable>
              <Pressable
                onPress={handleConfirm}
                disabled={!canConfirm}
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: colors.destructive,
                    opacity: canConfirm ? 1 : 0.4,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.primaryBtnText,
                    { color: "#FFFFFF", fontFamily: FontFamily.interBold },
                  ]}
                >
                  End shift anyway
                </Text>
              </Pressable>
            </View>
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
  title: { fontSize: 20, flex: 1 },
  desc: { fontSize: 13, lineHeight: 19 },
  taskList: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  taskLabel: { fontSize: 13, flex: 1 },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkLabel: { flex: 1, fontSize: 14, lineHeight: 20 },
  label: { fontSize: 11, letterSpacing: 0.6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  secondaryBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 14 },
  primaryBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontSize: 14 },
});
