import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { ShiftListCard } from "@/components/worker/ShiftListCard";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { WorkerPageSubheader } from "@/components/worker/WorkerPageSubheader";
import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useWorkerShifts } from "@/hooks/worker/useWorkerShifts";
import { useColors } from "@/hooks/useColors";
import {
  cacheWorkerShifts,
  getCachedWorkerShifts,
} from "@/hooks/useOfflineCache";
import type { WorkerShift } from "@/lib/worker-api";
import { getPrimaryTodayShiftId, sortTodayShiftsForList } from "@/lib/shift-utils";

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
  const queryClient = useQueryClient();
  const t = useT();
  const { isOnline } = useOffline();
  const [cachedShifts, setCachedShifts] = useState<WorkerShift[] | null>(null);

  const { data, isLoading, error, refetch, isRefetching } = useWorkerShifts("today");

  useEffect(() => {
    if (data?.shifts && data.shifts.length > 0) {
      cacheWorkerShifts(data.shifts);
    } else if (!isOnline) {
      getCachedWorkerShifts<WorkerShift>().then((cached) => {
        if (cached) setCachedShifts(cached);
      });
    }
  }, [data?.shifts, isOnline]);

  const activeShifts = data?.shifts ?? (isOnline ? undefined : cachedShifts ?? undefined);

  const { sortedShifts, primaryShiftId } = useMemo(() => {
    const list = activeShifts ?? [];
    return {
      sortedShifts: sortTodayShiftsForList(list),
      primaryShiftId: getPrimaryTodayShiftId(list),
    };
  }, [activeShifts]);

  const handleRefresh = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ["worker", "shifts"] });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.shifts")} />
      <WorkerPageSubheader
        title={t("shifts.title")}
        subtitle={isOnline ? t("shifts.filter.today") : "Offline — cached data unavailable"}
      />

      {isLoading && !cachedShifts ? (
        <View style={styles.loading}>
          <ShiftSkeleton />
          <ShiftSkeleton />
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sortedShifts}
          keyExtractor={(item) => item.id}
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            isOnline ? (
              <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={colors.primary} />
            ) : undefined
          }
          renderItem={({ item }) => (
            <ShiftListCard
              shift={item}
              showActions={item.id === primaryShiftId}
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
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { padding: 16, gap: 12 },
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
  list: { padding: 16, gap: 12 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12, paddingHorizontal: 40 },
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
});
