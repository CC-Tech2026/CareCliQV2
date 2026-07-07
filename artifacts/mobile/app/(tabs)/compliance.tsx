import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ComplianceTrendChart } from "@/components/worker/compliance/ComplianceTrendChart";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { WorkerPageSubheader } from "@/components/worker/WorkerPageSubheader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useT } from "@/context/PreferencesContext";
import { useWorkerCompliance } from "@/hooks/worker/useWorkerCompliance";
import { useWorkerComplianceDetail } from "@/hooks/worker/useWorkerComplianceDetail";
import { useColors } from "@/hooks/useColors";
import { complianceBadgeMeta, safeClientDate } from "@/lib/client-utils";
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

export default function ComplianceTabScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [trendDays, setTrendDays] = useState<7 | 30>(7);

  const { data: overview, isLoading, error, refetch, isRefetching } = useWorkerCompliance();
  const { data: detail, isLoading: detailLoading } = useWorkerComplianceDetail(trendDays);

  const loading = isLoading || detailLoading;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.compliance")} />
      <WorkerPageSubheader title={t("compliance.title")} subtitle={t("compliance.subtitle")} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        >
          <View style={[styles.summaryStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SummaryItem
              icon="shield"
              value={`${overview?.average_score ?? 0}%`}
              label={t("compliance.avgScore")}
              colors={colors}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <SummaryItem
              icon="check-circle"
              value={String(overview?.reviewed_sessions ?? 0)}
              label={t("compliance.reviewed")}
              colors={colors}
              valueColor="#22C55E"
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <SummaryItem
              icon="alert-triangle"
              value={String(overview?.at_risk ?? 0)}
              label={t("compliance.needsAttention")}
              colors={colors}
              valueColor={colors.accent}
            />
          </View>

          {detail && (
            <>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  {t("compliance.realTime")}
                </Text>

                <View style={styles.scoreRow}>
                  <View style={[styles.scoreRing, { borderColor: scoreColor(detail.score) }]}>
                    <Text style={[styles.scoreValue, { color: scoreColor(detail.score), fontFamily: "Inter_700Bold" }]}>
                      {Math.round(detail.score)}
                    </Text>
                    <Text style={[styles.scoreUnit, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                      /100
                    </Text>
                  </View>
                  <View style={styles.scoreMeta}>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor(detail.status, colors) + "20" }]}>
                      <Text
                        style={[styles.statusText, { color: statusColor(detail.status, colors), fontFamily: "Inter_700Bold" }]}
                      >
                        {detail.status.replace("_", " ").toUpperCase()}
                      </Text>
                    </View>
                    <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${Math.min(detail.score, 100)}%`, backgroundColor: scoreColor(detail.score) },
                        ]}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.rules}>
                  {detail.rules.map((rule) => (
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

              {detail.failed_rules.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.alertBg, borderColor: colors.destructive }]}>
                  <Text style={[styles.cardTitle, { color: colors.destructive, fontFamily: "Inter_700Bold" }]}>
                    {t("compliance.needsAttentionTitle")}
                  </Text>
                  {detail.failed_rules.map((rule, i) => (
                    <Text key={i} style={[styles.failItem, { color: colors.destructive, fontFamily: "Inter_500Medium" }]}>
                      • {rule.label ?? rule.message}
                    </Text>
                  ))}
                </View>
              )}

              <ComplianceTrendChart data={detail.trend} days={trendDays} onDaysChange={setTrendDays} />
            </>
          )}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.recordsHeader}>
              <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {t("compliance.records")}
              </Text>
              {overview?.status ? (
                <View
                  style={[
                    styles.recordsBadge,
                    { backgroundColor: statusColor(overview.status, colors) + "20" },
                  ]}
                >
                  <Text
                    style={[styles.recordsBadgeText, { color: statusColor(overview.status, colors), fontFamily: "Inter_700Bold" }]}
                  >
                    {overview.status.replace("_", " ").toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>

            {overview?.sessions && overview.sessions.length > 0 ? (
              <View>
                {overview.sessions.map((session, index) => {
                  const badge = complianceBadgeMeta(session.compliance_status);
                  return (
                    <View
                      key={session.id}
                      style={[
                        styles.recordRow,
                        index < overview.sessions!.length - 1 && {
                          borderBottomColor: colors.border,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <View style={styles.recordBody}>
                        <Text
                          style={[styles.recordType, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                          numberOfLines={1}
                        >
                          {(session.session_type || "session").replace(/_/g, " ")}
                        </Text>
                        <Text style={[styles.recordDate, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                          {safeClientDate(session.session_date)}
                        </Text>
                      </View>
                      <View style={[styles.recordScore, { backgroundColor: badge.bg, borderColor: badge.color + "40" }]}>
                        <Text style={[styles.recordScoreText, { color: badge.color, fontFamily: "Inter_700Bold" }]}>
                          {session.compliance_score ?? t("compliance.draft")}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {t("compliance.reviewedSessions", { count: 0 })}
              </Text>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function SummaryItem({
  icon,
  value,
  label,
  colors,
  valueColor,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  value: string;
  label: string;
  colors: ReturnType<typeof useColors>;
  valueColor?: string;
}) {
  return (
    <View style={styles.summaryItem}>
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      <Text style={[styles.summaryValue, { color: valueColor ?? colors.foreground, fontFamily: "Inter_700Bold" }]}>
        {value}
      </Text>
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { fontSize: 14, padding: 24, textAlign: "center" },
  scroll: { padding: 16, gap: 16 },
  summaryStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  summaryItem: { alignItems: "center", gap: 4, flex: 1 },
  summaryValue: { fontSize: 18 },
  summaryLabel: { fontSize: 11 },
  divider: { width: 1, height: 32 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  cardTitle: { fontSize: 15 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  scoreRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreValue: { fontSize: 24, lineHeight: 26 },
  scoreUnit: { fontSize: 10 },
  scoreMeta: { flex: 1, gap: 10 },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: { fontSize: 11, letterSpacing: 0.5 },
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
  failItem: { fontSize: 13, lineHeight: 20 },
  recordsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  recordsBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  recordsBadgeText: { fontSize: 10, letterSpacing: 0.5 },
  recordRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  recordBody: { flex: 1, gap: 2 },
  recordType: { fontSize: 14, textTransform: "capitalize" },
  recordDate: { fontSize: 12 },
  recordScore: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  recordScoreText: { fontSize: 12 },
  empty: { fontSize: 13 },
});
