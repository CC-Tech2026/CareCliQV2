import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useWorkerComplianceDetail } from "@/hooks/worker/useWorkerComplianceDetail";
import { useColors } from "@/hooks/useColors";
import { scoreColor } from "@workspace/worker-compliance";

function statusColor(status: string | undefined, colors: ReturnType<typeof useColors>): string {
  if (status === "compliant") return "#22C55E";
  if (status === "non_compliant") return colors.destructive;
  return colors.warning;
}

function ruleIcon(status: string): React.ComponentProps<typeof Feather>["name"] {
  if (status === "pass") return "check-circle";
  if (status === "fail") return "x-circle";
  return "alert-triangle";
}

function ruleIconColor(status: string, colors: ReturnType<typeof useColors>): string {
  if (status === "pass") return "#22C55E";
  if (status === "fail") return colors.destructive;
  return colors.warning;
}

export function DashboardCompliancePanel() {
  const colors = useColors();
  const t = useT();
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const { data: detail, isLoading, error } = useWorkerComplianceDetail(trendDays);

  if (isLoading) {
    return (
      <View style={[styles.card, styles.center, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("dashboard.loadingCompliance")}
        </Text>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
          {t("dashboard.complianceLoadError")}
        </Text>
      </View>
    );
  }

  const clr = scoreColor(detail.score);
  const maxTrend = Math.max(...detail.trend.map((p) => p.avg_score ?? 0), 1);

  return (
    <View style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("dashboard.complianceScore")}
        </Text>

        <View style={styles.scoreRow}>
          <View style={[styles.scoreRing, { borderColor: clr }]}>
            <Text style={[styles.scoreValue, { color: clr, fontFamily: "Inter_700Bold" }]}>
              {Math.round(detail.score)}
            </Text>
            <Text style={[styles.scoreLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              /100
            </Text>
          </View>
          <View style={styles.scoreMeta}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(detail.status, colors) + "20" }]}>
              <Text
                style={[
                  styles.statusText,
                  { color: statusColor(detail.status, colors), fontFamily: "Inter_700Bold" },
                ]}
              >
                {detail.status.replace("_", " ").toUpperCase()}
              </Text>
            </View>
            <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
              <View style={[styles.barFill, { width: `${Math.min(detail.score, 100)}%`, backgroundColor: clr }]} />
            </View>
          </View>
        </View>

        <View style={styles.rules}>
          {detail.rules.slice(0, 4).map((rule) => (
            <View key={rule.rule} style={[styles.ruleRow, { borderBottomColor: colors.border }]}>
              <Feather name={ruleIcon(rule.status)} size={14} color={ruleIconColor(rule.status, colors)} />
              <View style={styles.ruleText}>
                <Text style={[styles.ruleLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {rule.label}
                </Text>
                {rule.message ? (
                  <Text style={[styles.ruleMsg, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {rule.message}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.trendHeader}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {t("dashboard.complianceTrend")}
          </Text>
          <View style={styles.trendToggle}>
            {([7, 30] as const).map((d) => (
              <Pressable
                key={d}
                onPress={() => setTrendDays(d)}
                style={[
                  styles.trendPill,
                  { backgroundColor: trendDays === d ? colors.primary : colors.soft },
                ]}
              >
                <Text
                  style={[
                    styles.trendPillText,
                    {
                      color: trendDays === d ? colors.primaryForeground : colors.mutedForeground,
                      fontFamily: trendDays === d ? "Inter_700Bold" : "Inter_500Medium",
                    },
                  ]}
                >
                  {d}d
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.chart}>
          {detail.trend.map((point) => {
            const height = point.avg_score != null ? Math.max(8, (point.avg_score / maxTrend) * 72) : 8;
            const barColor = point.avg_score != null ? scoreColor(point.avg_score) : colors.muted;
            const label = point.date.slice(5);
            return (
              <View key={point.date} style={styles.barCol}>
                <View style={[styles.bar, { height, backgroundColor: barColor }]} />
                <Text style={[styles.barLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 24, gap: 10 },
  loadingText: { fontSize: 13 },
  errorText: { fontSize: 14 },
  title: { fontSize: 15 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  scoreRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreValue: { fontSize: 22, lineHeight: 24 },
  scoreLabel: { fontSize: 10 },
  scoreMeta: { flex: 1, gap: 10 },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: { fontSize: 10, letterSpacing: 0.5 },
  barTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  rules: { gap: 0 },
  ruleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleText: { flex: 1, gap: 2 },
  ruleLabel: { fontSize: 13 },
  ruleMsg: { fontSize: 12, lineHeight: 17 },
  trendHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  trendToggle: { flexDirection: "row", gap: 6 },
  trendPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  trendPillText: { fontSize: 12 },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 4,
    minHeight: 96,
    paddingTop: 8,
  },
  barCol: { flex: 1, alignItems: "center", gap: 4 },
  bar: { width: "100%", maxWidth: 28, borderRadius: 4, minHeight: 8 },
  barLabel: { fontSize: 9 },
});
