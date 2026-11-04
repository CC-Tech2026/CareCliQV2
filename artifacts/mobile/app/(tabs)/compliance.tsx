import { FontFamily } from "@/constants/typography";
import { getAppTimezone } from "@/lib/shift-utils";
import { Feather } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IncidentsPanel } from "@/components/worker/incidents/IncidentsPanel";
import { ComplianceScoreRing } from "@/components/worker/compliance/ComplianceScoreRing";
import { ShiftReviewItem } from "@/components/worker/review/ShiftReviewItem";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useT } from "@/context/PreferencesContext";
import { useWorkerCompliance } from "@/hooks/worker/useWorkerCompliance";
import { useShiftReviews } from "@/hooks/worker/useShiftReviews";
import { useWorkerComplianceDetail } from "@/hooks/worker/useWorkerComplianceDetail";
import { useColors } from "@/hooks/useColors";
import type {
  ShiftReviewItem as ShiftReview,
  WorkerCompliance,
  WorkerComplianceRuleResult,
} from "@/lib/worker-api";

type Segment = "overview" | "incidents";

function statusTone(
  status: string | undefined,
  colors: ReturnType<typeof useColors>,
): { color: string; bg: string } {
  if (status === "compliant")
    return { color: colors.success, bg: colors.statusDocumentedBg };
  if (status === "non_compliant")
    return { color: colors.destructive, bg: colors.dangerBg };
  return { color: colors.warning, bg: colors.statusProgressBg };
}

function statusLabel(
  status: WorkerCompliance["status"] | string | undefined,
  t: ReturnType<typeof useT>,
): string {
  if (status === "compliant") return t("compliance.status.compliant");
  if (status === "non_compliant") return t("compliance.status.nonCompliant");
  return t("compliance.status.atRisk");
}

function trendBarColor(
  value: number,
  colors: ReturnType<typeof useColors>,
): string {
  if (value >= 85) return colors.success;
  if (value >= 60) return colors.warning;
  return colors.destructive;
}

function trendLabel(
  value: string,
  index: number,
  total: number,
  t: ReturnType<typeof useT>,
): string {
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: getAppTimezone() }).format(new Date());
  if (value === todayKey)
    return t("compliance.today");
  // Parse as local noon so date-only ISO strings don't shift a day in western timezones.
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime()))
    return value.slice(8).replace(/^0/, "") || value.slice(5);
  return date.toLocaleDateString("en-AU", { day: "numeric" });
}

function RuleStatusIcon({
  status,
  colors,
}: {
  status: string;
  colors: ReturnType<typeof useColors>;
}) {
  if (status === "pass")
    return <Feather name="check-circle" size={15} color={colors.success} />;
  if (status === "warning")
    return <Feather name="alert-triangle" size={15} color={colors.warning} />;
  if (status === "fail")
    return <Feather name="x-circle" size={15} color={colors.destructive} />;
  return <Feather name="circle" size={15} color={colors.mutedForeground} />;
}

function RuleRow({
  rule,
  colors,
  showExplanation,
}: {
  rule: WorkerComplianceRuleResult;
  colors: ReturnType<typeof useColors>;
  showExplanation: boolean;
}) {
  const explanation = rule.explanation || rule.message;
  return (
    <View style={styles.ruleRow}>
      <RuleStatusIcon status={rule.status} colors={colors} />
      <View style={styles.ruleCopy}>
        <Text
          style={[
            styles.ruleLabel,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {rule.label}
        </Text>
        {showExplanation && explanation ? (
          <Text
            style={[
              styles.ruleExplanation,
              { color: colors.mutedForeground, fontFamily: FontFamily.body },
            ]}
          >
            {explanation}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function RuleBreakdownSection({
  rules,
  failedRules,
  colors,
  t,
}: {
  rules: WorkerComplianceRuleResult[];
  failedRules: WorkerComplianceRuleResult[];
  colors: ReturnType<typeof useColors>;
  t: ReturnType<typeof useT>;
}) {
  const [expanded, setExpanded] = useState(false);
  const passed = rules.filter((r) => r.status === "pass").length;

  if (rules.length === 0) return null;

  return (
    <View
      style={[
        styles.rulesCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {failedRules.length > 0 ? (
        <View style={styles.attentionBlock}>
          <Text
            style={[
              styles.attentionTitle,
              { color: colors.destructive, fontFamily: FontFamily.interBold },
            ]}
          >
            {t("compliance.needsAttentionTitle")}
          </Text>
          {failedRules.map((rule) => (
            <RuleRow
              key={rule.rule}
              rule={rule}
              colors={colors}
              showExplanation
            />
          ))}
        </View>
      ) : (
        <View style={styles.attentionBlock}>
          <View style={styles.allGoodRow}>
            <Feather name="check-circle" size={16} color={colors.success} />
            <Text
              style={[
                styles.allGoodText,
                { color: colors.success, fontFamily: FontFamily.interSemiBold },
              ]}
            >
              {t("compliance.status.compliant")}
            </Text>
          </View>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((e) => !e)}
        style={[styles.rulesToggle, { borderTopColor: colors.border }]}
      >
        <Text
          style={[
            styles.sectionTitle,
            styles.rulesToggleTitle,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interSemiBold,
            },
          ]}
        >
          {t("compliance.rulesTitle")}
        </Text>
        <View style={styles.rulesToggleRight}>
          <Text
            style={[
              styles.rulesToggleCount,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interMedium,
              },
            ]}
          >
            {t("compliance.checksPassed", {
              passed: String(passed),
              total: String(rules.length),
            })}
          </Text>
          <Feather
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.mutedForeground}
          />
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.allRulesBlock}>
          {rules.map((rule) => (
            <RuleRow
              key={rule.rule}
              rule={rule}
              colors={colors}
              showExplanation={
                rule.status === "fail" || rule.status === "warning"
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function ComplianceTabScreen() {
  const colors = useColors();
  const isDark = colors.scheme === "dark";
  const insets = useSafeAreaInsets();
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ segment?: string }>();
  const [segment, setSegment] = useState<Segment>(
    params.segment === "incidents" ? "incidents" : "overview",
  );

  useEffect(() => {
    if (params.segment === "incidents") setSegment("incidents");
  }, [params.segment]);

  const {
    data: overview,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useWorkerCompliance();
  const {
    data: detail,
    isLoading: detailLoading,
    refetch: detailRefetch,
  } = useWorkerComplianceDetail(7);
  // Only shifts still with the office: changes requested, then waiting for
  // review. Verified shifts move to Past shifts.
  const {
    data: reviewsData,
    isLoading: reviewsLoading,
    refetch: refetchReviews,
  } = useShiftReviews();
  const reviews = reviewsData?.shifts ?? [];
  const counts = reviewsData?.counts;

  const loading = isLoading || detailLoading || (reviewsLoading && !reviewsData);
  const latest = overview?.latest_session ?? null;
  // The latest result opens that shift's record, never the live session.
  const latestShiftId = useMemo(() => {
    if (!latest?.id) return null;
    return reviewsData?.shifts.find((s) => s.session_id === latest.id)?.shift_id ?? null;
  }, [latest?.id, reviewsData]);
  const trend = detail?.trend ?? [];
  const rules = detail?.rules ?? [];
  const failedRules = detail?.failed_rules ?? [];
  const latestScore = latest?.compliance_score ?? overview?.average_score ?? 0;
  const latestStatus =
    (latest?.compliance_status as WorkerCompliance["status"] | undefined) ??
    overview?.status;
  const reviewedSessions = overview?.reviewed_sessions ?? 0;
  const compliantRate =
    reviewedSessions > 0
      ? Math.round(
          ((overview?.compliant_sessions ?? 0) / reviewedSessions) * 100,
        )
      : 0;
  const tone = statusTone(latestStatus, colors);
  const bottomPad = insets.bottom + 110;

  const handleRefresh = useCallback(() => {
    void refetch();
    void refetchReviews();
    void detailRefetch();
  }, [refetch, refetchReviews, detailRefetch]);

  const renderReview = useCallback(
    ({ item }: { item: ShiftReview }) => <ShiftReviewItem item={item} />,
    [],
  );

  const listHeader = (
    <View style={styles.headerContent}>
      <Pressable
        accessibilityRole="button"
        disabled={!latestShiftId}
        onPress={() => latestShiftId && router.push(`/shift/${latestShiftId}/record` as never)}
        style={[
          styles.latestCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <ComplianceScoreRing score={latestScore} size={52} />
        <View style={styles.latestCopy}>
          <Text
            style={[
              styles.latestLabel,
              { color: colors.mutedForeground, fontFamily: FontFamily.body },
            ]}
          >
            {t("compliance.latestResult")}
          </Text>
          <Text
            style={[
              styles.latestScore,
              { color: colors.foreground, fontFamily: FontFamily.interBold },
            ]}
          >
            {Math.round(latestScore)} / 100
          </Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: tone.bg }]}>
          <Text
            style={[
              styles.statusChipText,
              { color: tone.color, fontFamily: FontFamily.interSemiBold },
            ]}
          >
            {statusLabel(latestStatus, t)}
          </Text>
        </View>
        {latestShiftId ? (
          <Feather
            name="chevron-right"
            size={18}
            color={colors.mutedForeground}
          />
        ) : null}
      </Pressable>

      <View style={styles.statsGrid}>
        <View
          style={[
            styles.statCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.statValue,
              { color: colors.primary, fontFamily: FontFamily.interBold },
            ]}
          >
            {Math.round(overview?.average_score ?? 0)}
          </Text>
          <Text
            style={[
              styles.statLabel,
              { color: colors.mutedForeground, fontFamily: FontFamily.body },
            ]}
          >
            {t("compliance.avgScore")}
          </Text>
        </View>
        <View
          style={[
            styles.statCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.statValue,
              { color: colors.primary, fontFamily: FontFamily.interBold },
            ]}
          >
            {compliantRate}%
          </Text>
          <Text
            style={[
              styles.statLabel,
              { color: colors.mutedForeground, fontFamily: FontFamily.body },
            ]}
          >
            {t("compliance.compliantRate")}
          </Text>
        </View>
        <View
          style={[
            styles.statCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.statValue,
              { color: colors.primary, fontFamily: FontFamily.interBold },
            ]}
          >
            {reviewedSessions}
          </Text>
          <Text
            style={[
              styles.statLabel,
              { color: colors.mutedForeground, fontFamily: FontFamily.body },
            ]}
          >
            {t("compliance.sessions")}
          </Text>
        </View>
      </View>

      <RuleBreakdownSection
        rules={rules}
        failedRules={failedRules}
        colors={colors}
        t={t}
      />

      {trend.length > 0 ? (
        <View
          style={[
            styles.trendCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t("compliance.scoreTrend")}
          </Text>
          <View style={styles.trendWrap}>
            {trend.map((point, index) => {
              const hasScore = point.avg_score != null;
              const value = point.avg_score ?? 0;
              const height = hasScore ? Math.max(6, value * 0.56) : 6;
              return (
                <View key={`${point.date}-${index}`} style={styles.trendCol}>
                  <View
                    style={[
                      styles.trendBar,
                      {
                        height,
                        backgroundColor: hasScore
                          ? trendBarColor(value, colors)
                          : colors.border,
                        opacity: hasScore ? 0.85 : 0.45,
                      },
                    ]}
                  />
                </View>
              );
            })}
          </View>
          <View style={styles.trendLabels}>
            {trend.map((point, index) => (
              <Text
                key={`label-${point.date}-${index}`}
                style={[
                  styles.trendLabel,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.body,
                  },
                ]}
              >
                {trendLabel(point.date, index, trend.length, t)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <Text
        style={[
          styles.historyTitle,
          {
            color: colors.mutedForeground,
            fontFamily: FontFamily.interSemiBold,
          },
        ]}
      >
        {t("review.overview.title")}
        {counts && counts.changes_requested + counts.awaiting_review > 0
          ? `  ·  ${counts.changes_requested + counts.awaiting_review}`
          : ""}
      </Text>
      {counts && counts.changes_requested > 0 ? (
        <Text style={[styles.reviewHint, { color: colors.warning, fontFamily: FontFamily.interSemiBold }]}>
          {t("review.overview.needsYou", { count: String(counts.changes_requested) })}
        </Text>
      ) : null}
    </View>
  );

  const listFooter = (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/worker/past-shifts" as never)}
      style={[styles.pastLink, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Feather name="archive" size={16} color={colors.primary} />
      <Text style={[styles.pastLinkText, { color: colors.foreground, fontFamily: FontFamily.interSemiBold }]}>
        {t("review.overview.pastShifts")}
      </Text>
      {counts && counts.verified > 0 ? (
        <Text style={[styles.pastLinkCount, { color: colors.mutedForeground, fontFamily: FontFamily.body }]}>
          {t("review.overview.verifiedCount", { count: String(counts.verified) })}
        </Text>
      ) : null}
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.compliance")} />

      <View style={styles.segmentWrap}>
        <View style={[styles.segmentTrack, elevatedCardShadow(isDark)]}>
          {(
            [
              ["overview", t("compliance.segment.overview")],
              ["incidents", t("compliance.segment.incidents")],
            ] as const
          ).map(([key, label]) => {
            const active = segment === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setSegment(key)}
                style={[
                  styles.segmentBtn,
                  { backgroundColor: active ? colors.primary : colors.soft },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color: active
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                      fontFamily: active
                        ? FontFamily.interBold
                        : FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {segment === "incidents" ? (
        <IncidentsPanel contentBottomPad={bottomPad} />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text
            style={[
              styles.error,
              {
                color: colors.destructive,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {(error as Error).message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={handleRefresh}
            style={{
              minHeight: 48,
              padding: 14,
              backgroundColor: colors.soft,
              borderRadius: 16,
            }}
          >
            <Text
              style={{
                color: colors.primary,
                fontFamily: FontFamily.interSemiBold,
              }}
            >
              {t("common.retry")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(item) => item.shift_id}
          renderItem={renderReview}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          contentContainerStyle={[
            styles.list,
            reviews.length === 0 && styles.listEmpty,
            { paddingBottom: bottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          ListEmptyComponent={
            <Text
              style={[
                styles.empty,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              {t("review.overview.empty")}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  reviewHint: {
    fontSize: 12,
    marginTop: -4,
    marginBottom: 8,
  },
  pastLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  pastLinkText: {
    fontSize: 14,
    flex: 1,
  },
  pastLinkCount: {
    fontSize: 12,
  },
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { fontSize: 14, padding: 24, textAlign: "center" },
  segmentWrap: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  segmentTrack: {
    flexDirection: "row",
    gap: 3,
  },
  segmentBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  segmentText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    flexShrink: 1,
  },
  list: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  listEmpty: { flexGrow: 1 },
  headerContent: { gap: 16, marginBottom: 10 },
  latestCard: {
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  latestCopy: { flex: 1, minWidth: 100, gap: 6 },
  latestLabel: { fontSize: 14, lineHeight: 20 },
  latestScore: { fontSize: 24, lineHeight: 30 },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusChipText: { fontSize: 12, lineHeight: 18 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: {
    flex: 1,
    minWidth: 90,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 2,
  },
  statValue: { fontSize: 24, lineHeight: 30 },
  statLabel: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    width: "100%",
  },
  rulesCard: {
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  attentionBlock: { padding: 12, gap: 10 },
  attentionTitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  allGoodRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  allGoodText: { fontSize: 13 },
  ruleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  ruleCopy: { flex: 1, gap: 2 },
  ruleLabel: { fontSize: 15, lineHeight: 22 },
  ruleExplanation: { fontSize: 14, lineHeight: 21 },
  rulesToggle: {
    flexWrap: "wrap",
    gap: 8,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  rulesToggleTitle: { marginBottom: 0 },
  rulesToggleRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rulesToggleCount: { fontSize: 13, lineHeight: 19, flexShrink: 1 },
  allRulesBlock: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  trendCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 8,
  },
  trendWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    height: 56,
  },
  trendCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  trendBar: {
    width: "100%",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  trendLabels: { flexDirection: "row", gap: 6, marginTop: 4 },
  trendLabel: { flex: 1, textAlign: "center", fontSize: 11 },
  historyTitle: {
    fontSize: 16,
    lineHeight: 22,
    marginTop: 4,
    marginBottom: 2,
    marginHorizontal: 4,
  },
  listFooter: {
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  empty: { fontSize: 13, paddingTop: 8 },
});
