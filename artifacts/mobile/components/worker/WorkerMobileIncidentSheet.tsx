import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
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
  const t = useT();
  const isRp = Boolean(sourceNoteId);
  // Started from a note (e.g. a safety caution): the note's words start the
  // description, so nothing the worker already wrote has to be typed again.
  const notePrefill = sourceNoteContent?.trim() ?? "";
  const rpPrefill = sourceNoteContent?.trim()
    ? `Restrictive practice noted during shift session.\n\nSession note:\n${sourceNoteContent.trim()}`
    : "Restrictive practice noted during shift session. ";

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.headerText}>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              { color: colors.foreground, fontFamily: FontFamily.display },
            ]}
          >
            {t("incidents.worker.reportCta")}
          </Text>
          <Text
            style={[
              styles.subtitle,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {t("incidents.shift.stillRunning")}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          hitSlop={8}
          style={[styles.close, { backgroundColor: colors.soft }]}
        >
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      {isRp ? (
        <View
          style={[
            styles.rpBanner,
            {
              backgroundColor: colors.dangerBg,
              borderColor: colors.dangerBorder,
            },
          ]}
        >
          <Feather name="alert-triangle" size={18} color={colors.dangerIcon} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={[
                styles.rpTitle,
                {
                  color: colors.dangerText,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("incidents.shift.rpTitle")}
            </Text>
            <Text
              style={[
                styles.rpBody,
                {
                  color: colors.dangerText,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {t("incidents.shift.rpBody")}
            </Text>
          </View>
        </View>
      ) : null}

      <WorkerIncidentReportForm
        shiftId={shiftId}
        participantId={participantId}
        participantName={participantName}
        sessionId={sessionId}
        shiftAddress={shiftAddress}
        initialReportType={isRp ? "participant_behaviour" : "safety_hazard"}
        initialBehaviourSubtype={isRp ? "physical" : ""}
        initialSeverity={isRp ? "high" : "medium"}
        initialDescription={isRp ? rpPrefill : notePrefill}
        initialWorkerActions={
          isRp
            ? "Followed participant safety protocol and documented the incident."
            : ""
        }
        bottomInset={insets.bottom}
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 20, lineHeight: 26 },
  subtitle: { fontSize: 14, lineHeight: 19 },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  rpBanner: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  rpTitle: { fontSize: 15 },
  rpBody: { fontSize: 14, lineHeight: 20 },
});
