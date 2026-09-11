import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { complianceBadgeMeta, safeClientDate, sessionScoreLabel } from "@/lib/client-utils";
import type { ClientSessionRecord } from "@/lib/worker-api";
import { useColors } from "@/hooks/useColors";

/** Same session data as ClientSessionList, but the clinical note text stays
 * hidden until tapped — this sits on the profile's default landing tab,
 * which a worker often has open while still near the participant, so the
 * note content shouldn't be visible at a glance the way it reasonably is on
 * the dedicated Shift Notes screen a worker navigates to on purpose. */
export function RecentNotesPreview({ rows }: { rows: ClientSessionRecord[] }) {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((session, index) => (
        <NoteRow
          key={session.id}
          session={session}
          showDivider={index < rows.length - 1}
          colors={colors}
        />
      ))}
    </View>
  );
}

function NoteRow({
  session,
  showDivider,
  colors,
}: {
  session: ClientSessionRecord;
  showDivider: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const [revealed, setRevealed] = useState(false);
  const statusVal = session.compliance_status || session.status;
  const badge = complianceBadgeMeta(statusVal);
  const scoreLabel = sessionScoreLabel(session);
  const preview = session.legal_record_text || session.notes;

  return (
    <Pressable
      onPress={() => setRevealed((v) => !v)}
      style={[
        styles.row,
        showDivider && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.rowContent}>
        <Text style={[styles.type, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {(session.session_type || "Session").replace(/_/g, " ")}
        </Text>
        <Text style={[styles.date, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {safeClientDate(session.session_date)}
          {session.duration_minutes ? ` · ${session.duration_minutes} min` : ""}
        </Text>
        {preview ? (
          revealed ? (
            <Text style={[styles.preview, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {preview}
            </Text>
          ) : (
            <View style={styles.revealHint}>
              <Feather name="eye-off" size={12} color={colors.mutedForeground} />
              <Text style={[styles.revealHintText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                Tap to view note
              </Text>
            </View>
          )
        ) : null}
      </View>
      <View style={[styles.badge, { backgroundColor: badge.bg, borderColor: badge.color }]}>
        <Text style={[styles.badgeText, { color: badge.color, fontFamily: "Inter_600SemiBold" }]}>
          {scoreLabel}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowContent: { flex: 1, gap: 3 },
  type: { fontSize: 14, textTransform: "capitalize" },
  date: { fontSize: 12 },
  preview: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  revealHint: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  revealHintText: { fontSize: 12 },
  badge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, marginTop: 2 },
  badgeText: { fontSize: 11, textTransform: "capitalize" },
});
