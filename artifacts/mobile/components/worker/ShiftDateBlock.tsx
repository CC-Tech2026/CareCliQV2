import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { formatDateInZone, formatTime } from "@/lib/shift-utils";

type Props = {
  /** Shift start; shown in the participant's branch zone. */
  iso?: string | null;
  timezone?: string | null;
  /** "solid" marks the shift that's on now; "muted" a cancelled one. */
  tone?: "soft" | "solid" | "muted";
  /** A small green dot: the worker is clocked in or in session. */
  live?: boolean;
};

/** The day, month and start time in one block at the left of a shift or
 * offer, so a worker can scan a list by when, not by reading a line of
 * text that gets cut off on a narrow phone. */
export function ShiftDateBlock({ iso, timezone, tone = "soft", live = false }: Props) {
  const colors = useColors();
  const solid = tone === "solid";
  const muted = tone === "muted";
  const fg = solid ? colors.primaryForeground : muted ? colors.mutedForeground : colors.primary;
  const day = iso ? formatDateInZone(iso, timezone, { day: "numeric" }) : "–";
  const month = iso ? formatDateInZone(iso, timezone, { month: "short" }) : "";
  const time = iso ? formatTime(iso, timezone).replace(/\s/g, "") : "TBC";

  return (
    <View
      accessible
      accessibilityLabel={iso ? `${formatDateInZone(iso, timezone, { weekday: "long", day: "numeric", month: "long" })}, ${formatTime(iso, timezone)}` : "Time to be confirmed"}
      style={[
        styles.block,
        { backgroundColor: solid ? colors.primary : colors.soft },
      ]}
    >
      <Text style={[styles.day, { color: fg }]}>{day}</Text>
      <Text style={[styles.month, { color: fg }]}>{month}</Text>
      <View style={[styles.rule, { backgroundColor: fg, opacity: 0.25 }]} />
      <Text style={[styles.time, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>
        {time}
      </Text>
      {live && <View style={[styles.liveDot, { backgroundColor: colors.success, borderColor: colors.card }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    width: 64,
    minHeight: 82,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  day: { fontFamily: FontFamily.interBold, fontSize: 22, lineHeight: 25 },
  month: { fontFamily: FontFamily.interSemiBold, fontSize: 12, lineHeight: 15 },
  rule: { width: 22, height: 1, marginVertical: 6 },
  time: { fontFamily: FontFamily.interBold, fontSize: 12, lineHeight: 15 },
  liveDot: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
  },
});
