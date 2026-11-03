import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ComplianceScoreRing } from "@/components/worker/compliance/ComplianceScoreRing";
import { ShiftConversation } from "@/components/worker/review/ShiftConversation";
import { ReviewStatusChip } from "@/components/worker/review/ShiftReviewItem";
import { WorkerMobileTaskList } from "@/components/worker/WorkerMobileTaskList";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { useSessionNotes } from "@/hooks/worker/useSessionNotes";
import { useShiftReviewThread } from "@/hooks/worker/useShiftReviews";
import { useWorkerShift } from "@/hooks/worker/useWorkerShift";
import { showAlert } from "@/lib/alert";
import * as Haptics from "@/lib/haptics";
import { formatDurationLabel, formatShiftTimeRange, shiftDurationMinutes } from "@/lib/shift-utils";
import { sendShiftBackForReview, sendShiftReviewMessage, type SessionNoteRecord } from "@/lib/worker-api";
import { evaluateSessionTextCompliance } from "@workspace/worker-compliance";

/**
 * A finished shift, as the worker and the office see it: read-only once the
 * worker has clocked out. When the office asks for changes the worker can add
 * notes (never change what's already there) and send it back for review.
 * Opened from the compliance overview, history and message notifications,
 * instead of the live shift screen.
 */
export default function ShiftRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const t = useT();
  const queryClient = useQueryClient();
  const shiftQuery = useWorkerShift(id);
  const shift = shiftQuery.data;
  const notesQuery = useSessionNotes(shift?.session_id ?? undefined);
  const threadQuery = useShiftReviewThread(id);
  const thread = threadQuery.data;
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [added, setAdded] = useState<SessionNoteRecord[]>([]);
  const router = useRouter();

  // A shift still on (or not started) belongs on the live shift screen; this
  // record is for after clock-out. Notifications about a shift land here.
  useEffect(() => {
    if (shift && shift.status !== "completed") router.replace(`/shift/${id}` as never);
  }, [shift, id, router]);

  const notes = useMemo(() => {
    const saved = notesQuery.data ?? [];
    const ids = new Set(saved.map((n) => n.note_id));
    return [...saved, ...added.filter((n) => !ids.has(n.note_id))];
  }, [notesQuery.data, added]);
  const compliance = useMemo(() => evaluateSessionTextCompliance(""), []);

  const refresh = () => {
    void shiftQuery.refetch();
    void notesQuery.refetch();
    void threadQuery.refetch();
  };
  const invalidateLists = () => void queryClient.invalidateQueries({ queryKey: ["worker", "shift-reviews"] });

  const reply = async (text: string) => {
    setSending(true);
    try {
      await sendShiftReviewMessage(id, text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await threadQuery.refetch();
      invalidateLists();
    } catch (err) {
      showAlert(t("review.thread.sendFailed"), err instanceof Error ? err.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const sendBack = async () => {
    setSendingBack(true);
    try {
      await sendShiftBackForReview(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdded([]);
      await Promise.all([threadQuery.refetch(), notesQuery.refetch()]);
      invalidateLists();
      showAlert(t("review.sentBackTitle"), t("review.sentBackBody"));
    } catch (err) {
      showAlert(t("review.sendBackFailed"), err instanceof Error ? err.message : undefined);
    } finally {
      setSendingBack(false);
    }
  };

  if (shiftQuery.isLoading || threadQuery.isLoading) {
    return (
      <WorkerStackScreen headerTitle="" minimalHeader showBack cardsOnBackground>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </WorkerStackScreen>
    );
  }
  if (!shift || !thread) {
    return (
      <WorkerStackScreen headerTitle="" minimalHeader showBack cardsOnBackground>
        <View style={styles.center}>
          <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>{t("review.notFound")}</Text>
        </View>
      </WorkerStackScreen>
    );
  }

  const tz = shift.timezone;
  const startIso = shift.clocked_in_at ?? shift.scheduled_start ?? undefined;
  const endIso = shift.clocked_out_at ?? shift.scheduled_end ?? undefined;
  const times = formatShiftTimeRange(startIso, endIso, tz);
  const duration = formatDurationLabel(shiftDurationMinutes(startIso, endIso));
  const status = thread.review_status;
  // Notes can be added while the office has asked for changes, or while the
  // shift's documentation is still due after it ended incomplete.
  const canAddNotes = thread.can_add_notes || Boolean(shift.documentation_pending);
  const lastRequest = [...thread.messages].reverse().find((m) => m.kind === "change_request" && !m.resolved);
  const score = thread.compliance_score;

  const banner =
    status === "changes_requested"
      ? { icon: "edit-3" as const, fg: colors.warning, title: t("review.banner.changesTitle"), body: t("review.banner.changesBody") }
      : status === "verified"
        ? { icon: "check-circle" as const, fg: colors.success, title: t("review.banner.verifiedTitle"), body: t("review.banner.verifiedBody") }
        : { icon: "clock" as const, fg: colors.primary, title: t("review.banner.awaitingTitle"), body: t("review.banner.awaitingBody") };

  return (
    <WorkerStackScreen headerTitle="" minimalHeader showBack cardsOnBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={threadQuery.isRefetching} onRefresh={refresh} />}
        >
          <View style={styles.titleBlock}>
            <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
              {shift.participant_name || t("review.participantFallback")}
            </Text>
            <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {[times, duration].filter(Boolean).join(" · ")}
            </Text>
            <ReviewStatusChip status={status} />
          </View>

          <View style={[styles.banner, { borderColor: banner.fg + "55", backgroundColor: banner.fg + "12" }]}>
            <Feather name={banner.icon} size={18} color={banner.fg} style={styles.bannerIcon} />
            <View style={styles.bannerText}>
              <Text style={[styles.bannerTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{banner.title}</Text>
              <Text style={[styles.bannerBody, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>{banner.body}</Text>
              {lastRequest ? (
                <Text style={[styles.request, { color: colors.foreground, borderLeftColor: colors.warning, fontFamily: "Inter_500Medium" }]}>
                  “{lastRequest.body}”
                  {lastRequest.sender_name ? `  ${lastRequest.sender_name}` : ""}
                </Text>
              ) : null}
            </View>
          </View>

          {score != null ? (
            <View style={[styles.scoreRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ComplianceScoreRing score={Math.round(Number(score))} size={44} />
              <View style={styles.flexShrink}>
                <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {t("review.documentationScore")}
                </Text>
                <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {t("review.documentationScoreHint")}
                </Text>
              </View>
            </View>
          ) : null}

          <Text style={[styles.section, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {canAddNotes ? t("review.notesEditable") : t("review.notesReadOnly")}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <WorkerMobileTaskList
              tasks={shift.tasks ?? []}
              activeTaskId={activeTask}
              onSelectTask={setActiveTask}
              onToggleTask={() => {}}
              sessionId={shift.session_id ?? null}
              participantName={shift.participant_name ?? ""}
              participantId={shift.participant_id}
              sessionNotes={notes}
              compliance={compliance}
              onNoteSaved={(note) => setAdded((prev) => [...prev, note])}
              tz={tz}
              readOnly={!canAddNotes}
            />
          </View>

          <Text style={[styles.section, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("review.thread.title")}
          </Text>
          <ShiftConversation
            messages={thread.messages}
            feedback={thread.feedback}
            tz={tz}
            canReply={thread.can_message}
            sending={sending}
            onSend={reply}
          />
        </ScrollView>

        {status === "changes_requested" ? (
          <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <Text style={[styles.footerHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
              {added.length > 0
                ? t("review.footer.added", { count: String(added.length) })
                : t("review.footer.hint")}
            </Text>
            <Pressable
              onPress={() => void sendBack()}
              disabled={sendingBack}
              accessibilityRole="button"
              style={[styles.footerBtn, { backgroundColor: colors.composerPurple, opacity: sendingBack ? 0.6 : 1 }]}
            >
              {sendingBack ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Feather name="send" size={16} color="#FFFFFF" />
              )}
              <Text style={[styles.footerBtnText, { fontFamily: "Inter_700Bold" }]}>{t("review.sendBack")}</Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1, gap: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  titleBlock: { gap: 4 },
  title: { fontSize: 22, lineHeight: 28 },
  muted: { fontSize: 13, lineHeight: 18 },
  banner: { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: 16, padding: 14 },
  bannerIcon: { marginTop: 1 },
  bannerText: { flex: 1, minWidth: 0, gap: 4 },
  bannerTitle: { fontSize: 15 },
  bannerBody: { fontSize: 13, lineHeight: 19 },
  request: { fontSize: 13, lineHeight: 19, borderLeftWidth: 3, paddingLeft: 10, marginTop: 4 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 12 },
  sectionTitle: { fontSize: 14 },
  section: { fontSize: 12, letterSpacing: 0.3, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  footerHint: { fontSize: 12, lineHeight: 17 },
  footerBtn: {
    minHeight: 48,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footerBtnText: { color: "#FFFFFF", fontSize: 15 },
});
