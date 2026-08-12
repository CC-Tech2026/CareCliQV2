import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { WorkerIncidentReportForm } from "@/components/worker/WorkerIncidentReportForm";

type Props = {
  shiftId?: string;
  participantId?: string;
  participantName?: string;
  sessionId?: string | null;
  shiftAddress?: string;
  sourceNoteId?: string;
  sourceNoteContent?: string;
  onFiled: (noteId?: string) => void;
  onClose: () => void;
};

export function WorkerMobileIncidentSheet({
  shiftId,
  participantId,
  participantName,
  sessionId,
  shiftAddress,
  sourceNoteId,
  sourceNoteContent,
  onFiled,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isRp = Boolean(sourceNoteId);
  const rpPrefill = sourceNoteContent?.trim()
    ? `Restrictive practice noted during shift session.\n\nSession note:\n${sourceNoteContent.trim()}`
    : "Restrictive practice noted during shift session. ";

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <Pressable onPress={onClose} hitSlop={8} style={[styles.back, { borderColor: colors.border }]}>
          <Feather name="x" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            Incident report
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Session stays open — return when done
          </Text>
        </View>
      </View>

      {isRp && (
        <View style={[styles.rpBanner, { borderColor: colors.destructive + "55", backgroundColor: colors.destructive + "14" }]}>
          <Text style={[styles.rpTitle, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            Restrictive practice detected
          </Text>
          <Text style={[styles.rpBody, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
            File this report within 24 hours. Your shift session will remain active.
          </Text>
        </View>
      )}

      <WorkerIncidentReportForm
        shiftId={shiftId}
        participantId={participantId}
        participantName={participantName}
        sessionId={sessionId}
        shiftAddress={shiftAddress}
        initialReportType={isRp ? "participant_behaviour" : "safety_hazard"}
        initialBehaviourSubtype={isRp ? "physical" : ""}
        initialSeverity={isRp ? "high" : "medium"}
        initialDescription={isRp ? rpPrefill : ""}
        initialWorkerActions={
          isRp ? "Followed participant safety protocol and documented the incident." : ""
        }
        onSubmitted={() => onFiled(sourceNoteId)}
        onCancel={onClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 12 },
  rpBanner: {
    margin: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  rpTitle: { fontSize: 12 },
  rpBody: { fontSize: 12, lineHeight: 17 },
});
