import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { SessionNoteRecord } from "@/lib/worker-api";
import type { NoteComplianceFlag } from "@workspace/worker-compliance";

type Props = {
  note: SessionNoteRecord;
  taskLabel?: string;
  goalTitle?: string;
  flag?: NoteComplianceFlag;
  onIncidentReport?: (noteId: string, content: string) => void;
  onPress?: () => void;
};

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function WorkerMobileNoteBubble({
  note,
  taskLabel,
  goalTitle,
  flag,
  onIncidentReport,
  onPress,
}: Props) {
  const colors = useColors();
  const time = note.created_at
    ? new Date(note.created_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    : "";
  const categoryLabel = [taskLabel, goalTitle].filter(Boolean).join(" · ");
  const type = note.note_type ?? "text";
  const wc = wordCount(note.content);
  const isFail = flag?.severity === "fail";
  const accent = isFail ? colors.destructive : colors.warning;

  const content = (
    <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: flag ? accent : colors.border }]}>
      {categoryLabel ? (
        <Text style={[styles.category, { color: colors.composerPurple, fontFamily: "Inter_600SemiBold" }]}>
          {categoryLabel}
        </Text>
      ) : null}
      <Text style={[styles.content, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
        {note.content}
      </Text>
      <Text style={[styles.time, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {[time, type, `${wc} words`, flag ? "flagged" : null].filter(Boolean).join(" · ")}
      </Text>

      {flag ? (
        <View style={[styles.flagBox, { borderColor: accent + "55", backgroundColor: accent + "14" }]}>
          <Text style={[styles.flagTitle, { color: accent, fontFamily: "Inter_600SemiBold" }]}>
            Rule {flag.ruleId} — {flag.ruleName}
          </Text>
          <Text style={[styles.flagMsg, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
            {flag.message}
          </Text>
          {flag.actionLabel && onIncidentReport ? (
            <Pressable
              onPress={() => onIncidentReport(note.note_id, note.content)}
              style={[styles.flagBtn, { backgroundColor: colors.destructive }]}
            >
              <Text style={[styles.flagBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                {flag.actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    marginHorizontal: 14,
    marginVertical: 4,
  },
  category: {
    fontSize: 11,
  },
  content: {
    fontSize: 14,
    lineHeight: 20,
  },
  time: {
    fontSize: 10,
  },
  flagBox: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  flagTitle: {
    fontSize: 11,
  },
  flagMsg: {
    fontSize: 12,
    lineHeight: 17,
  },
  flagBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  flagBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
  },
});
