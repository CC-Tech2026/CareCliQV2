import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { ShiftListCard } from "@/components/worker/ShiftListCard";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useWorkerShiftsInfinite } from "@/hooks/worker/useWorkerShifts";
import { useColors } from "@/hooks/useColors";
import {
  cacheWorkerShifts,
  getCachedWorkerShifts,
} from "@/hooks/useOfflineCache";
import type { WorkerShift } from "@/lib/worker-api";
import {
  getPrimaryTodayShiftId,
  isShiftCompletedForList,
  sortTodayShiftsForList,
} from "@/lib/shift-utils";

type ShiftSeg = "today" | "upcoming" | "past";

function isTodayShift(shift: WorkerShift): boolean {
  const ref = shift.scheduled_start ?? shift.clocked_out_at ?? shift.clocked_in_at;
  if (!ref) return false;
  const d = new Date(ref);
  return d.toDateString() === new Date().toDateString();
}

function ShiftSkeleton() {
  const colors = useColors();
  return (
    <View style={[styles.skeleton, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.skeletonAvatar, { backgroundColor: colors.muted }]} />
      <View style={styles.skeletonLines}>
        <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "70%" }]} />
        <View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: "50%" }]} />
      </View>
    </View>
  );
}

export default function MyShiftsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const { isOnline } = useOffline();
  const [cachedShifts, setCachedShifts] = useState<WorkerShift[] | null>(null);
  const [segment, setSegment] = useState<ShiftSeg>("today");
  const loadingMoreRef = useRef(false);

  const todayQuery = useWorkerShiftsInfinite("today");
  const upcomingQuery = useWorkerShiftsInfinite("upcoming");
  const pastQuery = useWorkerShiftsInfinite("past");

  const activeQuery =
    segment === "today" ? todayQuery : segment === "upcoming" ? upcomingQuery : pastQuery;

  const todayShifts = useMemo(
    () => todayQuery.data?.pages.flatMap((page) => page.shifts) ?? [],
    [todayQuery.data?.pages],
  );
  const upcomingShifts = useMemo(
    () => upcomingQuery.data?.pages.flatMap((page) => page.shifts) ?? [],
    [upcomingQuery.data?.pages],
  );
  const pastShifts = useMemo(
    () => pastQuery.data?.pages.flatMap((page) => page.shifts) ?? [],
    [pastQuery.data?.pages],
  );

  const onlineShifts = useMemo(() => {
    if (segment === "today") {
      if (!todayQuery.data?.pages) return undefined;
      // Completed/documented shifts belong in Past only.
      return todayShifts.filter((s) => !isShiftCompletedForList(s));
    }
    if (segment === "upcoming") {
      if (!upcomingQuery.data?.pages) return undefined;
      return upcomingShifts;
    }
    if (!pastQuery.data?.pages) return undefined;
    const completedToday = todayShifts.filter((s) => isTodayShift(s) && isShiftCompletedForList(s));
    const byId = new Map<string, WorkerShift>();
    for (const s of [...completedToday, ...pastShifts]) byId.set(s.id, s);
    return Array.from(byId.values()).sort((a, b) => {
      const aRef = a.scheduled_start ?? a.clocked_out_at ?? a.clocked_in_at ?? "";
      const bRef = b.scheduled_start ?? b.clocked_out_at ?? b.clocked_in_at ?? "";
      return bRef.localeCompare(aRef);
    });
  }, [
    segment,
    todayQuery.data?.pages,
    upcomingQuery.data?.pages,
    pastQuery.data?.pages,
    todayShifts,
    upcomingShifts,
    pastShifts,
  ]);

  useEffect(() => {
    if (segment === "today" && onlineShifts && onlineShifts.length > 0) {
      cacheWorkerShifts(onlineShifts);
    } else if (segment === "today" && !isOnline) {
      getCachedWorkerShifts<WorkerShift>().then((cached) => {
        if (cached) setCachedShifts(cached);
      });
    }
  }, [onlineShifts, isOnline, segment]);

  const activeShifts =
    segment === "today"
      ? onlineShifts ?? (isOnline ? undefined : cachedShifts ?? undefined)
      : onlineShifts;

  const { sortedShifts, primaryShiftId } = useMemo(() => {
    const list = activeShifts ?? [];
    if (segment !== "today") {
      return { sortedShifts: list, primaryShiftId: null as string | null };
    }
    return {
      sortedShifts: sortTodayShiftsForList(list),
      primaryShiftId: getPrimaryTodayShiftId(list),
    };
  }, [activeShifts, segment]);

  const handleRefresh = useCallback(() => {
    void todayQuery.refetch();
    void upcomingQuery.refetch();
    void pastQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["worker", "shifts"] });
  }, [todayQuery, upcomingQuery, pastQuery, queryClient]);

  const handleLoadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    if (!activeQuery.hasNextPage || activeQuery.isFetchingNextPage) return;
    loadingMoreRef.current = true;
    void activeQuery.fetchNextPage().finally(() => {
      loadingMoreRef.current = false;
    });
  }, [activeQuery]);

  const listHeader = (
    <View style={styles.listHeader}>
      <Pressable
        onPress={() => router.push("/worker/availability" as never)}
        style={[styles.availBanner, { backgroundColor: colors.soft }]}
      >
        <Feather name="calendar" size={17} color={colors.primary} />
        <Text style={[styles.availBannerText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
          {t("shifts.setAvailability")}
        </Text>
        <Feather name="chevron-right" size={15} color={colors.primary} />
      </Pressable>

      <View style={[styles.segmentTrack, { backgroundColor: colors.soft }]}>
        {(
          [
            ["today", t("shifts.filter.today")],
            ["upcoming", t("shifts.filter.upcoming")],
            ["past", t("shifts.filter.past")],
          ] as const
        ).map(([key, label]) => {
          const active = segment === key;
          return (
            <Pressable
              key={key}
              onPress={() => setSegment(key)}
              style={[styles.segmentBtn, active && { backgroundColor: colors.primary }]}
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color: active ? "#FFFFFF" : colors.primary,
                    fontFamily: "Inter_600SemiBold",
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
  );

  const listFooter = (
    <View style={styles.footer}>
      {activeQuery.isFetchingNextPage ? (
        <ActivityIndicator color={colors.primary} style={styles.footerSpinner} />
      ) : null}
      <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {t("shifts.tapHint")}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.shifts")} />

      {activeQuery.isLoading && !cachedShifts ? (
        <View style={styles.loading}>
          {listHeader}
          <ShiftSkeleton />
          <ShiftSkeleton />
        </View>
      ) : activeQuery.error ? (
        <View style={styles.empty}>
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(activeQuery.error as Error).message}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sortedShifts}
          keyExtractor={(item) => item.id}
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            isOnline ? (
              <RefreshControl
                refreshing={activeQuery.isRefetching && !activeQuery.isFetchingNextPage}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
              />
            ) : undefined
          }
          renderItem={({ item }) => (
            <ShiftListCard
              shift={item}
              siblingShifts={sortedShifts}
              showActions={segment === "today" && item.id === primaryShiftId}
              onRefresh={handleRefresh}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
                <Feather name="calendar" size={28} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("shifts.emptyTitle")}
              </Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {t("shifts.emptySub")}
              </Text>
            </View>
          }
          ListFooterComponent={listFooter}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { padding: 16, gap: 12 },
  listHeader: { gap: 12, marginBottom: 4 },
  availBanner: {
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  availBannerText: { flex: 1, fontSize: 12.5 },
  segmentTrack: {
    flexDirection: "row",
    borderRadius: 999,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    borderRadius: 999,
  },
  segmentText: { fontSize: 12 },
  skeleton: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  skeletonAvatar: { width: 48, height: 48, borderRadius: 24 },
  skeletonLines: { flex: 1, gap: 8, paddingTop: 4 },
  skeletonLine: { height: 12, borderRadius: 6 },
  list: { padding: 16, gap: 8 },
  empty: { alignItems: "center", paddingTop: 48, gap: 12, paddingHorizontal: 40 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 17 },
  emptySub: { fontSize: 14, textAlign: "center" },
  errorText: { fontSize: 14, textAlign: "center", padding: 24 },
  footer: { paddingTop: 4, paddingBottom: 8 },
  footerSpinner: { marginVertical: 8 },
  hint: { fontSize: 11, marginTop: 4, marginBottom: 8 },
});
