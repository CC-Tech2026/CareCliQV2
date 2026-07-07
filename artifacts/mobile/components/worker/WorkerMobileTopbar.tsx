import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import type { ShiftVisualState } from "@/lib/worker-api";

type Phase = "scheduled" | "session" | "review";

type Props = {
  participantName: string;
  visualState: ShiftVisualState;
  phase?: Phase;
  elapsed?: string;
  showEnd?: boolean;
  onEnd?: () => void;
  endBusy?: boolean;
  onBack?: () => void;
  canCheckin?: boolean;
  onCheckin?: () => void;
};

export function WorkerMobileTopbar({
  participantName,
  visualState,
  phase = "session",
  elapsed,
  showEnd,
  onEnd,
  endBusy,
  onBack,
  canCheckin,
  onCheckin,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const isLive = visualState === "session_active" || visualState === "clocked_in";
  const subtitle =
    phase === "review"
      ? "Review & submit"
      : visualState === "session_active"
        ? "Session active · timer running"
        : visualState === "clocked_in"
          ? "Clocked in · timer running"
          : null;

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top + 6, backgroundColor: colors.card, borderBottomColor: colors.border },
      ]}
    >
      {onBack ? (
        <Pressable onPress={onBack} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Feather name="arrow-left" size={17} color={colors.foreground} />
        </Pressable>
      ) : null}

      <View style={styles.textWrap}>
        <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
          {participantName}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {isLive && elapsed && phase === "session" ? (
        <Text style={[styles.timer, { color: colors.warning, fontFamily: "Inter_700Bold" }]}>{elapsed}</Text>
      ) : null}

      {phase === "review" && elapsed ? (
        <View style={[styles.reviewTimer, { backgroundColor: colors.success + "30" }]}>
          <Text style={[styles.reviewTimerText, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {elapsed}
          </Text>
        </View>
      ) : null}

      {canCheckin && onCheckin ? (
        <Pressable onPress={onCheckin} style={[styles.iconBtn, { borderColor: "transparent", backgroundColor: colors.accent + "25" }]}>
          <Feather name="message-circle" size={16} color={colors.accent} />
        </Pressable>
      ) : null}

      {showEnd && onEnd ? (
        <Pressable
          onPress={onEnd}
          disabled={endBusy}
          style={[styles.endBtn, { backgroundColor: colors.accent, opacity: endBusy ? 0.6 : 1 }]}
        >
          {endBusy ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={[styles.endBtnText, { fontFamily: "Inter_700Bold" }]}>End</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: { flex: 1, gap: 2 },
  name: { fontSize: 15 },
  subtitle: { fontSize: 11 },
  timer: { fontSize: 15, letterSpacing: 0.5 },
  reviewTimer: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  reviewTimerText: { fontSize: 12 },
  endBtn: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  endBtnText: { color: "#FFFFFF", fontSize: 13 },
});
