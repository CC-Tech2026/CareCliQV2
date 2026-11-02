import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ComplianceScoreRing } from "@/components/worker/compliance/ComplianceScoreRing";
import { useColors } from "@/hooks/useColors";
import { shiftNoteSubtitle, shiftNoteTitle } from "@/lib/shift-note-title";
import type { WorkerComplianceSession } from "@/lib/worker-api";

type Props = {
  session: WorkerComplianceSession;
};

// The worker's own history across participants: who and when, not "Support work".
export function ComplianceSessionHistoryItem({ session }: Props) {
  const colors = useColors();
  const router = useRouter();
  const hasScore = session.compliance_score != null && Number.isFinite(Number(session.compliance_score));
  const score = hasScore ? Math.round(Number(session.compliance_score)) : 0;
  const title = shiftNoteTitle(session);
  const subtitle = shiftNoteSubtitle(session, { worker: false });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle].filter(Boolean).join(", ")}
      onPress={() => router.push(`/session/${session.id}`)}
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <ComplianceScoreRing score={score} size={48} empty={!hasScore} />
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
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
