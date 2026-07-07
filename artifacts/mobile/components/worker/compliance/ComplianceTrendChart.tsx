import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { scoreColor } from "@workspace/worker-compliance";

type TrendPoint = { date: string; avg_score: number | null; session_count: number };

type Props = {
  data: TrendPoint[];
  days: 7 | 30;
  onDaysChange: (days: 7 | 30) => void;
};

export function ComplianceTrendChart({ data, days, onDaysChange }: Props) {
  const colors = useColors();
  const t = useT();

  const hasData = data.some((p) => p.avg_score != null);
  const maxTrend = Math.max(...data.map((p) => p.avg_score ?? 0), 1);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {t("compliance.trend")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("compliance.trendSubtitle", { days })}
          </Text>
        </View>
        <View style={[styles.toggle, { borderColor: colors.border }]}>
          {([7, 30] as const).map((d) => (
            <Pressable
              key={d}
              onPress={() => onDaysChange(d)}
              style={[styles.pill, { backgroundColor: days === d ? colors.primary : "transparent" }]}
            >
              <Text
                style={[
                  styles.pillText,
                  {
                    color: days === d ? colors.primaryForeground : colors.mutedForeground,
                    fontFamily: days === d ? "Inter_700Bold" : "Inter_500Medium",
                  },
                ]}
              >
                {d}d
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {hasData ? (
        <View style={styles.chart}>
          {data.map((point) => {
            const height = point.avg_score != null ? Math.max(6, (point.avg_score / maxTrend) * 96) : 6;
            const barColor = point.avg_score != null ? scoreColor(point.avg_score) : colors.muted;
            return (
              <View key={point.date} style={styles.barCol}>
                <View style={[styles.bar, { height, backgroundColor: barColor }]} />
                <Text
                  style={[styles.barLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
                  numberOfLines={1}
                >
                  {point.date.slice(5)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("compliance.trendEmpty")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 14 },
  subtitle: { fontSize: 12 },
  toggle: { flexDirection: "row", borderWidth: 1, borderRadius: 999, padding: 2 },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontSize: 12 },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 3,
    minHeight: 120,
    paddingTop: 8,
  },
  barCol: { flex: 1, alignItems: "center", gap: 4 },
  bar: { width: "100%", maxWidth: 26, borderRadius: 4, minHeight: 6 },
  barLabel: { fontSize: 9 },
  empty: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 24,
  },
});
