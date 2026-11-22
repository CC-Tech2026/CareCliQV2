import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  score: number;
  /** The badge's width and height. */
  size?: number;
  empty?: boolean;
};

type Band = "good" | "warning" | "critical";

/** The same bands as the website: 85 and over compliant, 60 to 84 at risk. */
function bandOf(score: number): Band {
  return score >= 85 ? "good" : score >= 60 ? "warning" : "critical";
}

const BAND_WORD: Record<Band, string> = { good: "compliant", warning: "at risk", critical: "non-compliant" };

/**
 * A shift's documentation score as a small badge: the number, and under it
 * a short meter filled to the score, coloured by its band (the unfilled part
 * a lighter step of the same colour). It replaces a ring, which made the
 * score harder to read for no gain. The name is kept so callers don't change.
 */
export function ComplianceScoreRing({ score, size = 52, empty = false }: Props) {
  const colors = useColors();
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandOf(value);
  const fill = band === "good" ? colors.success : band === "warning" ? colors.warning : colors.destructive;
  const known = !empty && Number.isFinite(score);
  const barWidth = size - 14;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={known ? `Score ${value} out of 100, ${BAND_WORD[band]}` : "Not scored yet"}
      style={[styles.tile, { width: size, height: size, backgroundColor: colors.soft, borderRadius: Math.round(size / 4) }]}
    >
      <Text
        style={[styles.score, { color: colors.foreground, fontSize: size >= 50 ? 16 : 14 }]}
        allowFontScaling={false}
      >
        {known ? value : "—"}
      </Text>
      <View style={[styles.track, { width: barWidth, backgroundColor: known ? fill + "33" : colors.border }]}>
        {known && value > 0 ? <View style={[styles.fill, { width: (barWidth * value) / 100, backgroundColor: fill }]} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", gap: 4 },
  score: { fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
});
