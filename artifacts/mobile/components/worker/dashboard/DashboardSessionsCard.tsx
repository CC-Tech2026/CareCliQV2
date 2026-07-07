import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { complianceBadgeMeta, safeClientDate, sessionScoreLabel } from "@/lib/client-utils";
import type { DashboardSession } from "@/lib/dashboard-api";

type Props = {
  title: string;
  sessions: DashboardSession[];
};

export function DashboardSessionsCard({ title, sessions }: Props) {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{title}</Text>

      {sessions.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          No records need attention.
        </Text>
      ) : (
        <View style={styles.list}>
          {sessions.map((session, index) => {
            const badge = complianceBadgeMeta(session.compliance_status);
            const score = sessionScoreLabel(session);
            return (
              <View
                key={session.id}
                style={[
                  styles.row,
                  { borderColor: colors.border },
                  index < sessions.length - 1 && styles.rowGap,
                ]}
              >
                <View style={styles.rowTop}>
                  <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
                    {session.participant_name || "Participant"}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: badge.bg, borderColor: badge.color + "40" }]}>
                    <Text style={[styles.badgeText, { color: badge.color, fontFamily: "Inter_700Bold" }]}>
                      {score}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                  {safeClientDate(session.session_date)}
                  {" · "}
                  {(session.session_type || "session").replace(/_/g, " ")}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  title: { fontSize: 15 },
  empty: { fontSize: 13 },
  list: { gap: 0 },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  rowGap: { marginBottom: 8 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 13, flex: 1 },
  meta: { fontSize: 12 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 10 },
});
