import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useShiftBreakStatus } from "@/hooks/worker/useShiftCheckin";
import { useColors } from "@/hooks/useColors";
import { endLongShiftBreak, startLongShiftBreak, type CheckinWindowStatus } from "@/lib/worker-api";

type Props = {
  shiftId: string;
  sessionId: string | null;
  checkinStatus?: CheckinWindowStatus;
  sessionElapsed?: string;
  onCheckin?: () => void;
  disabled?: boolean;
};

function formatHMS(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function LongShiftEngagementPanel({
  shiftId,
  sessionId,
  checkinStatus,
  sessionElapsed,
  onCheckin,
  disabled,
}: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { data: breakStatus } = useShiftBreakStatus(shiftId);

  const [breakElapsed, setBreakElapsed] = useState("00:00:00");

  const breakBannerBg = colors.scheme === "dark" ? "rgba(252,211,77,0.12)" : "#FFF3E0";

  const onBreak = Boolean(breakStatus?.active);
  const breakStartAt = breakStatus?.break_start_at;
  const canStartBreak = breakStatus?.can_start_break ?? true;
  const breakLimitReached = breakStatus?.block_reason === "break_limit_reached";
  const completedBreaks = breakStatus?.completed_breaks ?? 0;

  const checkinsCompleted = checkinStatus?.checkins_completed ?? 0;
  const checkinsRequired = checkinStatus?.checkins_required ?? 0;
  const checkinOverdue = Boolean(checkinStatus?.checkin_overdue);
  const canSubmitCheckin = Boolean(checkinStatus?.can_submit_checkin);
  const isLongShift = checkinStatus?.applicable ?? checkinsRequired > 0;

  useEffect(() => {
    if (!onBreak || !breakStartAt) {
      setBreakElapsed("00:00:00");
      return;
    }
    const tick = () => {
      const start = new Date(breakStartAt).getTime();
      if (!Number.isFinite(start)) return;
      setBreakElapsed(formatHMS((Date.now() - start) / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [onBreak, breakStartAt]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["worker", "shift", shiftId, "break-status"] });
    void queryClient.invalidateQueries({ queryKey: ["worker", "shift", shiftId, "checkin-status"] });
  };

  const breakMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("No active session");
      return onBreak ? endLongShiftBreak(sessionId) : startLongShiftBreak(sessionId);
    },
    onSuccess: invalidate,
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Break action failed";
      if (msg.toLowerCase().includes("already in progress")) {
        invalidate();
        return;
      }
      Alert.alert("Break action failed", msg);
    },
  });

  if (!isLongShift) return null;

  const actionBusy = disabled || breakMutation.isPending;
  const checkinDisabled = actionBusy || onBreak || (!canSubmitCheckin && !checkinOverdue);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {onBreak && (
        <View style={[styles.breakBanner, { backgroundColor: breakBannerBg, borderColor: colors.warning }]}>
          <Feather name="coffee" size={16} color={colors.warning} />
          <Text style={[styles.breakBannerText, { color: colors.warning, fontFamily: "Inter_600SemiBold" }]}>
            On break: billing paused
          </Text>
          <Text style={[styles.breakTimer, { color: colors.warning, fontFamily: "Inter_700Bold" }]}>
            {breakElapsed}
          </Text>
        </View>
      )}

      <View style={styles.header}>
        <Feather name="activity" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
          Long shift activity
        </Text>
      </View>

      <Text style={[styles.desc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        Shifts over 4 hours need periodic check-ins. You may log one break per shift when you step
        away from the participant.
      </Text>

      {checkinsRequired > 0 && (
        <Text style={[styles.counter, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          Check-ins this shift:{" "}
          <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}>
            {checkinsCompleted} of {checkinsRequired}
          </Text>
          {checkinOverdue && !onBreak ? "  ·  due now" : ""}
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onCheckin}
          disabled={checkinDisabled}
          style={[
            styles.btn,
            checkinOverdue && !onBreak
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { backgroundColor: "transparent", borderColor: colors.border },
            { opacity: checkinDisabled ? 0.5 : 1 },
          ]}
        >
          <Feather
            name="message-circle"
            size={14}
            color={checkinOverdue && !onBreak ? colors.primaryForeground : colors.foreground}
          />
          <Text
            style={[
              styles.btnText,
              {
                color: checkinOverdue && !onBreak ? colors.primaryForeground : colors.foreground,
                fontFamily: "Inter_700Bold",
              },
            ]}
          >
            {checkinOverdue && !onBreak ? "Check in (due)" : "Check in"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => breakMutation.mutate()}
          disabled={actionBusy || (!onBreak && (!canStartBreak || breakLimitReached))}
          style={[
            styles.btn,
            onBreak
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { backgroundColor: "transparent", borderColor: colors.border },
            { opacity: actionBusy || (!onBreak && (!canStartBreak || breakLimitReached)) ? 0.5 : 1 },
          ]}
        >
          {breakMutation.isPending ? (
            <ActivityIndicator size="small" color={onBreak ? colors.primaryForeground : colors.foreground} />
          ) : (
            <>
              <Feather
                name="coffee"
                size={14}
                color={onBreak ? colors.primaryForeground : colors.foreground}
              />
              <Text
                style={[
                  styles.btnText,
                  {
                    color: onBreak ? colors.primaryForeground : colors.foreground,
                    fontFamily: "Inter_700Bold",
                  },
                ]}
              >
                {onBreak ? "End break" : breakLimitReached ? "Break logged" : "Log break"}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {breakLimitReached && !onBreak && (
        <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          One break per shift is already recorded
          {completedBreaks > 0 ? ` (${completedBreaks} of 1 used)` : ""}.
        </Text>
      )}

      {onBreak && (
        <Text style={[styles.hint, { color: colors.warning, fontFamily: "Inter_500Medium" }]}>
          End your break before checking in.
          {sessionElapsed ? `  Session ${sessionElapsed}.` : ""}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  breakBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  breakBannerText: { flex: 1, fontSize: 13 },
  breakTimer: { fontSize: 13, fontVariant: ["tabular-nums"] },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14 },
  desc: { fontSize: 12, lineHeight: 17 },
  counter: { fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
  },
  btnText: { fontSize: 13 },
  hint: { fontSize: 11, lineHeight: 15 },
});
