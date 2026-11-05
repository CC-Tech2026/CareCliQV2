import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  complianceBadgeMeta,
  sessionScoreLabel,
  uniqueClientRecords,
} from "@/lib/client-utils";
import { shiftNoteSubtitle, shiftNoteTitle } from "@/lib/shift-note-title";
import type { ClientSessionRecord } from "@/lib/worker-api";
import { useColors } from "@/hooks/useColors";

export function ClientSessionList({
  rows,
  emptyLabel = "No records yet",
}: {
  rows: ClientSessionRecord[];
  emptyLabel?: string;
}) {
  const colors = useColors();
  const records = uniqueClientRecords(rows);

  if (records.length === 0) {
    return (
      <Text
        style={[
          styles.empty,
          { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
        ]}
      >
        {emptyLabel}
      </Text>
    );
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {records.map((session, index) => {
        const statusVal = session.compliance_status || session.status;
        const badge = complianceBadgeMeta(statusVal);
        const scoreLabel = sessionScoreLabel(session);
        const preview = session.legal_record_text || session.notes;

        return (
          <View
            key={session.id}
            style={[
              styles.row,
              index < rows.length - 1 && {
                borderBottomColor: colors.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <View style={styles.rowContent}>
              {/* One participant's notes, written by this worker: the day and times tell them apart. */}
              <Text
                style={[
                  styles.type,
                  { color: colors.foreground, fontFamily: "Inter_700Bold" },
                ]}
              >
                {shiftNoteTitle(session, { participant: false })}
              </Text>
              <Text
                style={[
                  styles.date,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
              >
                {shiftNoteSubtitle(session, { worker: false })}
              </Text>
              {preview ? (
                <Text
                  style={[
                    styles.preview,
                    {
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                    },
                  ]}
                  numberOfLines={2}
                >
                  {preview}
                </Text>
              ) : null}
            </View>
            <View
              style={[
                styles.badge,
                { backgroundColor: badge.bg, borderColor: badge.color },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: badge.color, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {scoreLabel}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowContent: { flex: 1, gap: 3 },
  type: { fontSize: 14 },
  date: { fontSize: 12 },
  preview: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  badge: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 2,
  },
  badgeText: { fontSize: 11, textTransform: "capitalize" },
  empty: { fontSize: 14, paddingVertical: 8 },
});
