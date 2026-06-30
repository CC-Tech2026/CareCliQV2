import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  evaluateSessionTextCompliance,
  scoreColor,
  type ComplianceEvaluation,
} from "@workspace/worker-compliance";
import { useColors } from "@/hooks/useColors";

type Props = {
  notes: string;
  participantFirstName?: string;
  activitiesCount?: number;
};

function RuleRow({
  name,
  message,
  status,
}: {
  name: string;
  message: string;
  status: string;
}) {
  const colors = useColors();
  const icon =
    status === "pass" ? "check-circle" : status === "fail" ? "x-circle" : "alert-triangle";
  const iconColor =
    status === "pass" ? "#22C55E" : status === "fail" ? colors.destructive : colors.warning;

  return (
    <View style={styles.ruleRow}>
      <Feather name={icon as "check-circle"} size={14} color={iconColor} />
      <View style={styles.ruleText}>
        <Text style={[styles.ruleName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
          {name}
        </Text>
        <Text style={[styles.ruleMessage, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {message}
        </Text>
      </View>
    </View>
  );
}

export function ShiftCompliancePanel({ notes, participantFirstName, activitiesCount = 0 }: Props) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);

  const compliance: ComplianceEvaluation = useMemo(
    () => evaluateSessionTextCompliance(notes, participantFirstName, activitiesCount),
    [notes, participantFirstName, activitiesCount],
  );

  const scoreClr = scoreColor(compliance.score);
  const attention = compliance.rules.filter((r) => r.status !== "pass").length;
  const topNotification = compliance.notifications[0];

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {topNotification && (
        <View
          style={[
            styles.alert,
            {
              backgroundColor: topNotification.tier === "red" ? "#FCEBEB" : topNotification.tier === "amber" ? "#FFF3E0" : "#EEEDFE",
              borderColor: colors.border,
            },
          ]}
        >
          <Feather
            name={topNotification.tier === "red" ? "alert-octagon" : "alert-triangle"}
            size={16}
            color={topNotification.tier === "red" ? "#A32D2D" : "#854F0B"}
          />
          <View style={styles.alertText}>
            <Text style={[styles.alertTitle, { fontFamily: "Inter_600SemiBold" }]}>{topNotification.title}</Text>
            <Text style={[styles.alertBody, { fontFamily: "Inter_400Regular" }]}>{topNotification.body}</Text>
          </View>
        </View>
      )}

      <View style={styles.scoreRow}>
        <View>
          <Text style={[styles.scoreLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            COMPLIANCE SCORE
          </Text>
          <Text style={[styles.scoreValue, { color: scoreClr, fontFamily: "Inter_700Bold" }]}>
            {compliance.score}/100
          </Text>
        </View>
        <Pressable onPress={() => setExpanded((v) => !v)} style={styles.expandBtn}>
          <Text style={[styles.expandText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            {attention} need attention
          </Text>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.primary} />
        </Pressable>
      </View>

      <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
        <View style={[styles.barFill, { width: `${compliance.score}%`, backgroundColor: scoreClr }]} />
      </View>

      {expanded && (
        <View style={[styles.rulesList, { borderTopColor: colors.border }]}>
          {compliance.rules.map((rule) => (
            <RuleRow key={rule.id} name={rule.name} message={rule.message} status={rule.status} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  alert: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 0.5,
  },
  alertText: { flex: 1, gap: 2 },
  alertTitle: { fontSize: 13, color: "#791F1F" },
  alertBody: { fontSize: 12, color: "#A32D2D", lineHeight: 17 },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scoreLabel: { fontSize: 10, letterSpacing: 0.6 },
  scoreValue: { fontSize: 22, marginTop: 2 },
  expandBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  expandText: { fontSize: 11 },
  barTrack: { height: 6, borderRadius: 999, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999 },
  rulesList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    gap: 6,
  },
  ruleRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  ruleText: { flex: 1, gap: 1 },
  ruleName: { fontSize: 12 },
  ruleMessage: { fontSize: 11, lineHeight: 15 },
});
