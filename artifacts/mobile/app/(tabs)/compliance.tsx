import { Feather } from "@expo/vector-icons";
import React, { useCallback, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ComplianceSessionHistoryItem } from "@/components/worker/compliance/ComplianceSessionHistoryItem";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useT } from "@/context/PreferencesContext";
import {
  useWorkerCompliance,
  useWorkerComplianceSessionsInfinite,
} from "@/hooks/worker/useWorkerCompliance";
import { useWorkerComplianceDetail } from "@/hooks/worker/useWorkerComplianceDetail";
import { useColors } from "@/hooks/useColors";
import type { WorkerCompliance, WorkerComplianceSession } from "@/lib/worker-api";
import { scoreColor } from "@workspace/worker-compliance";

function statusColor(status: string | undefined, colors: ReturnType<typeof useColors>): string {
  if (status === "compliant") return "#22C55E";
  if (status === "non_compliant") return colors.destructive;
  return colors.warning;
}

function statusLabel(status: WorkerCompliance["status"] | string | undefined, t: ReturnType<typeof useT>): string {
  if (status === "compliant") return t("compliance.status.compliant");
  if (status === "non_compliant") return t("compliance.status.nonCompliant");
  return t("compliance.status.atRisk");
}

function trendLabel(value: string, index: number, total: number, t: ReturnType<typeof useT>): string {
  if (index === total - 1) return t("compliance.today");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(5);
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export default function ComplianceTabScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const loadingMoreRef = useRef(false);

  const { data: overview, isLoading, error, refetch, isRefetching } = useWorkerCompliance();
  const { data: detail, isLoading: detailLoading } = useWorkerComplianceDetail(7);
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
  const trendMax = Math.max(...trend.map((point) => point.avg_score ?? 0), 1);
  const latestScore = latest?.compliance_score ?? overview?.average_score ?? 0;
  const latestStatus =
    (latest?.compliance_status as WorkerCompliance["status"] | undefined) ?? overview?.status;
  const latestChecks = detail?.rules?.length ?? 0;
  const latestPassed = detail?.rules?.filter((rule) => rule.status === "pass").length ?? 0;
  const reviewedSessions = overview?.reviewed_sessions ?? 0;
  const compliantRate =
    reviewedSessions > 0
      ? Math.round(((overview?.compliant_sessions ?? 0) / reviewedSessions) * 100)
      : 0;

  const checksLabel =
    latestChecks > 0
      ? t("compliance.checksPassed", { passed: latestPassed, total: latestChecks })
      : t("compliance.notRecorded");

  const handleRefresh = useCallback(() => {
    void refetch();
    void refetchSessions();
  }, [refetch, refetchSessions]);

  const handleLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    void fetchNextPage().finally(() => {
      loadingMoreRef.current = false;
    });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const renderSession = useCallback(
    ({ item }: { item: WorkerComplianceSession }) => (
      <ComplianceSessionHistoryItem session={item} checksLabel={checksLabel} />
    ),
    [checksLabel],
  );

  const listHeader = (
    <View style={styles.headerContent}>
      <View style={[styles.pageHeader, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[styles.pageTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("compliance.title")}
        </Text>
        <Text style={[styles.pageSubtitle, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("compliance.lastSessions", { count: 7 })}
        </Text>
      </View>

      <View style={[styles.latestCard, { backgroundColor: colors.clockInBg, borderColor: colors.clockInBorder }]}>
        <Text style={[styles.latestLabel, { color: colors.clockInText, fontFamily: "Inter_600SemiBold" }]}>
          {t("compliance.latestResult")}
        </Text>
        <View style={styles.latestRow}>
          <Text style={[styles.latestScore, { color: colors.clockInText, fontFamily: "Inter_700Bold" }]}>
            {Math.round(latestScore)}/100
          </Text>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: `${statusColor(latestStatus, colors)}20`, borderColor: statusColor(latestStatus, colors) },
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: statusColor(latestStatus, colors), fontFamily: "Inter_700Bold" },
              ]}
            >
              {statusLabel(latestStatus, t)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statValue, { color: colors.warning, fontFamily: "Inter_700Bold" }]}>
            {Math.round(overview?.average_score ?? 0)}/100
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {t("compliance.avgScore")}
          </Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statValue, { color: colors.warning, fontFamily: "Inter_700Bold" }]}>
            {compliantRate}%
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {t("compliance.compliantRate")}
          </Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statValue, { color: colors.composerPurple, fontFamily: "Inter_700Bold" }]}>
            {reviewedSessions}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {t("compliance.sessions")}
          </Text>
        </View>
      </View>

      {trend.length > 0 ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
            {t("compliance.scoreTrend")}
          </Text>
          <View style={styles.trendWrap}>
            {trend.map((point, index) => {
              const value = point.avg_score ?? 0;
              const height = Math.max(10, (value / trendMax) * 84);
              return (
                <View key={`${point.date}-${index}`} style={styles.trendCol}>
                  <View style={[styles.trendBar, { height, backgroundColor: scoreColor(value || 0) }]} />
                  <Text style={[styles.trendLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {trendLabel(point.date, index, trend.length, t)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
          {t("compliance.sessionHistory")}
        </Text>
      </View>
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
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          contentContainerStyle={[
            styles.list,
            sessions.length === 0 && styles.listEmpty,
            { paddingBottom: insets.bottom + 100 },
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
  list: { paddingHorizontal: 16, paddingTop: 16 },
  listEmpty: { flexGrow: 1 },
  headerContent: { gap: 12, marginBottom: 4 },
  pageHeader: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
  },
  pageTitle: { fontSize: 16, lineHeight: 20 },
  pageSubtitle: { fontSize: 12, marginTop: 2 },
  latestCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  latestLabel: { fontSize: 13 },
  latestRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  latestScore: { fontSize: 18, lineHeight: 22 },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: "center",
  },
  statusText: { fontSize: 12 },
  statsGrid: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  statValue: { fontSize: 14, lineHeight: 18 },
  statLabel: { fontSize: 11, textAlign: "center" },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  sectionTitle: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase" },
  trendWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 6,
    minHeight: 106,
  },
  trendCol: { flex: 1, alignItems: "center", gap: 6 },
  trendBar: { width: "100%", borderRadius: 4, maxWidth: 42 },
  trendLabel: { fontSize: 10 },
  listFooter: {
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  empty: { fontSize: 13, paddingTop: 8 },
});
