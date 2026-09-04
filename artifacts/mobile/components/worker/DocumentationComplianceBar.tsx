import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { DocumentationComplianceCheck } from "@/lib/worker-api";
import { scoreColor } from "@workspace/worker-compliance";

type Props = {
  check: DocumentationComplianceCheck | null;
};

/**
 * The real 12-rule NDIS documentation-quality score (compliance_engine on
 * the backend), fetched periodically - deliberately separate from
 * ComplianceScoreBar's task-progress score just above it. The two answer
 * different questions: did you document each task (ComplianceScoreBar) vs.
 * is the documentation itself NDIS-compliant (this one) - conflating them
 * into one number would hide which one actually needs attention.
 */
export function DocumentationComplianceBar({ check }: Props) {
  const colors = useColors();

  if (!check) {
    return null;
  }

  if (!check.available) {
    return (
      <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
          DOCUMENTATION QUALITY
        </Text>
        <Text style={[styles.pendingText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {check.reason}
        </Text>
      </View>
    );
  }

  const clr = scoreColor(check.score);

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            DOCUMENTATION QUALITY
          </Text>
          <Text style={[styles.score, { color: clr, fontFamily: "Inter_700Bold" }]}>
            {Math.round(check.score)}%
          </Text>
        </View>
        <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
          <View style={[styles.barFill, { width: `${Math.min(check.score, 100)}%`, backgroundColor: clr }]} />
        </View>
      </View>
      {check.failed_rules.length > 0 && (
        <Text style={[styles.subtext, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
          {check.failed_rules[0].message}
          {check.failed_rules.length > 1 ? ` (+${check.failed_rules.length - 1} more)` : ""}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  left: { gap: 2 },
  label: { fontSize: 10, letterSpacing: 0.8 },
  score: { fontSize: 18 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  pendingText: { fontSize: 12, lineHeight: 17 },
  subtext: { fontSize: 11, lineHeight: 15 },
});
