import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { formatTimeWithZone, formatShiftDate } from "@/lib/shift-utils";
import type { ShiftFeedbackItem, ShiftThreadMessage } from "@/lib/worker-api";

const NO_WEB_OUTLINE = Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0 } as object) : null;

/** One finished shift's conversation with the office: change requests,
 * replies, messages sent during the shift and coaching feedback, in order. */
export function ShiftConversation({
  messages,
  feedback,
  tz,
  canReply,
  sending,
  onSend,
}: {
  messages: ShiftThreadMessage[];
  feedback: ShiftFeedbackItem[];
  tz?: string | null;
  canReply: boolean;
  sending: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const colors = useColors();
  const t = useT();
  const [draft, setDraft] = useState("");

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    await onSend(text);
    setDraft("");
  };

  const when = (iso?: string | null) =>
    iso ? [formatShiftDate(iso, tz), formatTimeWithZone(iso, tz)].filter(Boolean).join(", ") : "";

  return (
    <View style={styles.wrap}>
      {messages.length === 0 && feedback.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("review.thread.empty")}
        </Text>
      ) : null}

      {feedback.map((f) => (
        <View key={f.id} style={[styles.feedback, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={styles.feedbackHead}>
            <Feather name="award" size={14} color={colors.primary} />
            <Text style={[styles.meta, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
              {t("review.thread.feedback")} · {when(f.submitted_at)}
            </Text>
          </View>
          {[
            [t("review.thread.strengths"), f.strengths],
            [t("review.thread.toImprove"), f.areas_to_improve],
            [t("review.thread.actions"), f.action_items],
          ]
            .filter(([, v]) => !!v)
            .map(([label, value]) => (
              <View key={label as string}>
                <Text style={[styles.feedbackLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>{label}</Text>
                <Text style={[styles.body, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>{value}</Text>
              </View>
            ))}
        </View>
      ))}

      {messages.map((m) => {
        const mine = m.from_worker;
        const request = m.kind === "change_request";
        return (
          <View key={m.id} style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
            <View
              style={[
                styles.bubble,
                mine ? styles.bubbleMine : styles.bubbleTheirs,
                {
                  backgroundColor: request ? colors.warning + "14" : mine ? colors.activeBg : colors.card,
                  borderColor: request ? colors.warning + "66" : mine ? colors.primary + "26" : colors.border,
                },
              ]}
            >
              {request ? (
                <View style={styles.requestHead}>
                  <Feather
                    name={m.resolved ? "check-circle" : "edit-3"}
                    size={13}
                    color={m.resolved ? colors.success : colors.warning}
                  />
                  <Text
                    style={[styles.meta, { color: m.resolved ? colors.success : colors.warning, fontFamily: "Inter_600SemiBold" }]}
                  >
                    {m.resolved ? t("review.thread.requestDone") : t("review.thread.request")}
                  </Text>
                </View>
              ) : null}
              <Text style={[styles.body, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>{m.body}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                {[
                  mine ? t("review.thread.you") : m.sender_name || t("review.thread.office"),
                  m.kind === "during_shift" ? t("review.thread.duringShift") : null,
                  when(m.created_at),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          </View>
        );
      })}

      {canReply ? (
        <View style={styles.replyBar}>
          <View style={[styles.replyBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t("review.thread.replyPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={2000}
              {...(Platform.OS === "web" ? { numberOfLines: 1 } : null)}
              accessibilityLabel={t("review.thread.replyPlaceholder")}
              style={[styles.replyInput, NO_WEB_OUTLINE, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
            />
          </View>
          <Pressable
            onPress={() => void send()}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel={t("review.thread.send")}
            style={[styles.sendBtn, { backgroundColor: colors.composerPurple, opacity: !draft.trim() || sending ? 0.45 : 1 }]}
          >
            {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Feather name="arrow-up" size={20} color="#FFFFFF" />}
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("review.thread.closed")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  empty: { fontSize: 13, lineHeight: 19 },
  row: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "88%",
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  bubbleMine: { borderBottomRightRadius: 6 },
  bubbleTheirs: { borderTopLeftRadius: 6 },
  requestHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  body: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 11 },
  feedback: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  feedbackHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  feedbackLabel: { fontSize: 11, marginBottom: 2 },
  replyBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 4 },
  replyBox: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  replyInput: { fontSize: 15, lineHeight: 20, minHeight: 42, maxHeight: 120, paddingTop: 11, paddingBottom: 11, textAlignVertical: "top" },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
