import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ComplianceScoreBar } from "@/components/worker/ComplianceScoreBar";
import { useColors } from "@/hooks/useColors";
import type { ComplianceEvaluation } from "@workspace/worker-compliance";

type Props = {
  compliance: ComplianceEvaluation;
  onClose: () => void;
};

export function WorkerMobileComplianceReport({ compliance, onClose }: Props) {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Compliance Report
        </Text>
        <Pressable onPress={onClose} style={[styles.closeBtn, { borderColor: colors.border }]}>
          <Feather name="x" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <ComplianceScoreBar score={compliance.score} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {compliance.rules.map((rule) => {
          const icon =
            rule.status === "pass" ? "check-circle" : rule.status === "fail" ? "x-circle" : "alert-triangle";
          const iconColor =
            rule.status === "pass" ? "#22C55E" : rule.status === "fail" ? colors.destructive : colors.warning;

          return (
            <View key={String(rule.id)} style={[styles.ruleRow, { borderBottomColor: colors.border }]}>
              <Feather name={icon as "check-circle"} size={16} color={iconColor} />
              <View style={styles.ruleText}>
                <Text style={[styles.ruleName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {rule.name}
                </Text>
                <Text style={[styles.ruleMessage, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {rule.message}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function WorkerMobileSubmitSuccess({
  participantName,
  duration,
  onDone,
}: {
  participantName: string;
  duration: string;
  onDone: () => void;
}) {
  const colors = useColors();

  return (
    <View style={[styles.successWrap, { backgroundColor: colors.background }]}>
      <View style={[styles.successIcon, { backgroundColor: "#22C55E20" }]}>
        <Feather name="check-circle" size={48} color="#22C55E" />
      </View>
      <Text style={[styles.successTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
        Shift Submitted
      </Text>
      <Text style={[styles.successSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {participantName} · {duration}
      </Text>
      <Pressable onPress={onDone} style={[styles.doneBtn, { backgroundColor: colors.primary }]}>
        <Text style={[styles.doneBtnText, { fontFamily: "Inter_700Bold" }]}>Back to Shifts</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: 16, gap: 0 },
  ruleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleText: { flex: 1, gap: 3 },
  ruleName: { fontSize: 14 },
  ruleMessage: { fontSize: 13, lineHeight: 18 },
  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successTitle: { fontSize: 24 },
  successSub: { fontSize: 15, textAlign: "center" },
  doneBtn: {
    marginTop: 24,
    height: 52,
    borderRadius: 14,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnText: { color: "#FFFFFF", fontSize: 16 },
});
