import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { safeClientDate } from "@/lib/client-utils";
import type { WorkerCompliance, WorkerComplianceSession } from "@/lib/worker-api";

function statusColor(status: string | undefined, colors: ReturnType<typeof useColors>): string {
  if (status === "compliant") return "#22C55E";
  if (status === "non_compliant") return colors.destructive;
  return colors.warning;
}

function statusLabel(status: WorkerCompliance["status"] | string | undefined, t: ReturnType<typeof useT>): string {
  if (status === "compliant") return t("compliance.status.compliant");
  if (status === "non_compliant") return t("compliance.status.nonCompliant");
  return t("compliance.status.atRisk");
}

function sessionTitle(session: WorkerComplianceSession, t: ReturnType<typeof useT>): string {
  if (!session.session_type) return t("compliance.sessionFallback");
  const text = session.session_type.replace(/_/g, " ").trim();
  if (!text) return t("compliance.sessionFallback");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Props = {
  session: WorkerComplianceSession;
  checksLabel: string;
};

export function ComplianceSessionHistoryItem({ session, checksLabel }: Props) {
  const colors = useColors();
  const t = useT();
  const status = session.compliance_status as WorkerCompliance["status"] | undefined;
  const sColor = statusColor(status, colors);
  const score = Math.round(session.compliance_score ?? 0);

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={[styles.ring, { borderColor: sColor }]}>
        <Text style={[styles.ringText, { color: sColor, fontFamily: "Inter_700Bold" }]}>
          {score || "-"}
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
          {sessionTitle(session, t)}
        </Text>
        <Text style={[styles.date, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {safeClientDate(session.session_date)}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.statusPill, { backgroundColor: `${sColor}20` }]}>
            <Text style={[styles.statusText, { color: sColor, fontFamily: "Inter_600SemiBold" }]}>
              {statusLabel(status, t)}
            </Text>
          </View>
          <Text style={[styles.checks, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {checksLabel}
          </Text>
        </View>
      </View>
      <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  ring: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: { fontSize: 16 },
  body: { flex: 1, gap: 2 },
  name: { fontSize: 14, lineHeight: 18 },
  date: { fontSize: 11 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 3,
  },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11 },
  checks: { fontSize: 11 },
});
