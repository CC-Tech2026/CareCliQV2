import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ComplianceIncidentsSection } from "@/components/worker/compliance/ComplianceIncidentsSection";
import { ComplianceScoreRing } from "@/components/worker/compliance/ComplianceScoreRing";
import { ComplianceSessionHistoryItem } from "@/components/worker/compliance/ComplianceSessionHistoryItem";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useT } from "@/context/PreferencesContext";
import {
  useWorkerCompliance,
  useWorkerComplianceSessionsInfinite,
} from "@/hooks/worker/useWorkerCompliance";
import { useWorkerComplianceDetail } from "@/hooks/worker/useWorkerComplianceDetail";
import { useColors } from "@/hooks/useColors";
import type { WorkerCompliance, WorkerComplianceSession } from "@/lib/worker-api";

type Segment = "overview" | "incidents";

function statusTone(
  status: string | undefined,
  colors: ReturnType<typeof useColors>,
): { color: string; bg: string } {
  if (status === "compliant") return { color: colors.success, bg: colors.statusDocumentedBg };
  if (status === "non_compliant") return { color: colors.destructive, bg: colors.dangerBg };
  return { color: colors.warning, bg: colors.statusProgressBg };
}

function statusLabel(status: WorkerCompliance["status"] | string | undefined, t: ReturnType<typeof useT>): string {
  if (status === "compliant") return t("compliance.status.compliant");
  if (status === "non_compliant") return t("compliance.status.nonCompliant");
  return t("compliance.status.atRisk");
}

function trendBarColor(value: number, colors: ReturnType<typeof useColors>): string {
  if (value >= 85) return colors.success;
  if (value >= 60) return colors.warning;
  return colors.destructive;
}

function trendLabel(value: string, index: number, total: number, t: ReturnType<typeof useT>): string {
  if (index === total - 1) return t("compliance.today");
  // Parse as local noon so date-only ISO strings don't shift a day in western timezones.
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value.slice(8).replace(/^0/, "") || value.slice(5);
  return date.toLocaleDateString("en-AU", { day: "numeric" });
}

export default function ComplianceTabScreen() {
  const colors = useColors();
  const isDark = colors.scheme === "dark";
  const insets = useSafeAreaInsets();
  const t = useT();
  const loadingMoreRef = useRef(false);
  const params = useLocalSearchParams<{ segment?: string }>();
  const [segment, setSegment] = useState<Segment>(
    params.segment === "incidents" ? "incidents" : "overview",
  );

  useEffect(() => {
    if (params.segment === "incidents") setSegment("incidents");
  }, [params.segment]);

  const { data: overview, isLoading, error, refetch, isRefetching } = useWorkerCompliance();
  const { data: detail, isLoading: detailLoading, refetch: detailRefetch } = useWorkerComplianceDetail(7);
  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchSessions,
  } = useWorkerComplianceSessionsInfinite();

  const sessions = useMemo(
    () => sessionsData?.pages.flatMap((page) => page.sessions ?? []) ?? [],
    [sessionsData],
  );

  const loading = isLoading || detailLoading || (sessionsLoading && sessions.length === 0);
  const latest = overview?.latest_session ?? sessions[0];
  const trend = detail?.trend ?? [];
  const latestScore = latest?.compliance_score ?? overview?.average_score ?? 0;
  const latestStatus =
    (latest?.compliance_status as WorkerCompliance["status"] | undefined) ?? overview?.status;
  const reviewedSessions = overview?.reviewed_sessions ?? 0;
  const compliantRate =
    reviewedSessions > 0
      ? Math.round(((overview?.compliant_sessions ?? 0) / reviewedSessions) * 100)
      : 0;
  const tone = statusTone(latestStatus, colors);
  const bottomPad = insets.bottom + 110;

  const handleRefresh = useCallback(() => {
    void refetch();
    void refetchSessions();
    void detailRefetch();
  }, [refetch, refetchSessions, detailRefetch]);

  const handleLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    void fetchNextPage().finally(() => {
      loadingMoreRef.current = false;
    });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const renderSession = useCallback(
    ({ item }: { item: WorkerComplianceSession }) => (
      <ComplianceSessionHistoryItem session={item} />
    ),
    [],
  );

  const listHeader = (
    <View style={styles.headerContent}>
      <View style={[styles.latestCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ComplianceScoreRing score={latestScore} size={52} />
        <View style={styles.latestCopy}>
          <Text style={[styles.latestLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("compliance.latestResult")}
          </Text>
          <Text style={[styles.latestScore, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {Math.round(latestScore)} / 100
          </Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.statusChipText, { color: tone.color, fontFamily: "Inter_600SemiBold" }]}>
            {statusLabel(latestStatus, t)}
          </Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statValue, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
            {Math.round(overview?.average_score ?? 0)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("compliance.avgScore")}
          </Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statValue, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
            {compliantRate}%
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("compliance.compliantRate")}
          </Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statValue, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
            {reviewedSessions}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("compliance.sessions")}
          </Text>
        </View>
      </View>

      {trend.length > 0 ? (
        <View style={[styles.trendCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
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
                style={[styles.trendLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
              >
                {trendLabel(point.date, index, trend.length, t)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <Text style={[styles.historyTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {t("compliance.sessionHistory")}
      </Text>
    </View>
  );

  const listFooter = isFetchingNextPage ? (
    <View style={styles.listFooter}>
      <ActivityIndicator color={colors.primary} size="small" />
    </View>
  ) : (
    <View style={styles.listFooter} />
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
                      color: active ? colors.primaryForeground : colors.mutedForeground,
                      fontFamily: active ? "Inter_700Bold" : "Inter_600SemiBold",
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
        <ComplianceIncidentsSection contentBottomPad={bottomPad} />
      ) : loading ? (
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
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          contentContainerStyle={[
            styles.list,
            sessions.length === 0 && styles.listEmpty,
            { paddingBottom: bottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.35}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              {t("compliance.reviewedSessions", { count: 0 })}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { fontSize: 14, padding: 24, textAlign: "center" },
  segmentWrap: { paddingHorizontal: 16, paddingTop: 16 },
  segmentTrack: {
    flexDirection: "row",
    gap: 3,
  },
  segmentBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  segmentText: { fontSize: 12 },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  listEmpty: { flexGrow: 1 },
  headerContent: { gap: 10, marginBottom: 6 },
  latestCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  latestCopy: { flex: 1, gap: 2 },
  latestLabel: { fontSize: 11 },
  latestScore: { fontSize: 18 },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusChipText: { fontSize: 10 },
  statsGrid: { flexDirection: "row", gap: 8 },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 2,
  },
  statValue: { fontSize: 16 },
  statLabel: { fontSize: 10, textAlign: "center" },
  trendCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
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
  trendLabel: { flex: 1, textAlign: "center", fontSize: 8.5 },
  historyTitle: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
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
