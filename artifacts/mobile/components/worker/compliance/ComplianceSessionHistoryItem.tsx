import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ComplianceScoreRing } from "@/components/worker/compliance/ComplianceScoreRing";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { safeClientDate } from "@/lib/client-utils";
import type { WorkerComplianceSession } from "@/lib/worker-api";

function sessionTitle(session: WorkerComplianceSession, t: ReturnType<typeof useT>): string {
  if (!session.session_type) return t("compliance.sessionFallback");
  const text = session.session_type.replace(/_/g, " ").trim();
  if (!text) return t("compliance.sessionFallback");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Props = {
  session: WorkerComplianceSession;
};

export function ComplianceSessionHistoryItem({ session }: Props) {
  const colors = useColors();
  const t = useT();
  const router = useRouter();
  const hasScore = session.compliance_score != null && Number.isFinite(Number(session.compliance_score));
  const score = hasScore ? Math.round(Number(session.compliance_score)) : 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sessionTitle(session, t)}, ${safeClientDate(session.session_date)}`}
      onPress={() => router.push(`/session/${session.id}`)}
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <ComplianceScoreRing score={score} size={48} empty={!hasScore} />
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
          {sessionTitle(session, t)}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
          {safeClientDate(session.session_date)}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  body: { flex: 1, gap: 2 },
  name: { fontSize: 13 },
  meta: { fontSize: 11 },
});
