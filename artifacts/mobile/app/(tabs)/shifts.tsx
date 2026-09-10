import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Platform,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { workerBottomNavHeight } from "@/components/worker/WorkerBottomNav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ShiftListCard } from "@/components/worker/ShiftListCard";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { WeekCalendar, localDayKey } from "@/components/worker/WeekCalendar";
import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useWorkerShifts } from "@/hooks/worker/useWorkerShifts";
import { useColors } from "@/hooks/useColors";
import {
  cacheWorkerShifts,
  getCachedWorkerShifts,
} from "@/hooks/useOfflineCache";
import type { WorkerShift } from "@/lib/worker-api";
import {
  APP_TIMEZONE,
  getPrimaryTodayShiftId,
  sortTodayShiftsForList,
} from "@/lib/shift-utils";

function ShiftSkeleton() {
  const colors = useColors();
  return (
    <View
      style={[
        styles.skeleton,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View
        style={[styles.skeletonAvatar, { backgroundColor: colors.muted }]}
      />
      <View style={styles.skeletonLines}>
        <View
          style={[
            styles.skeletonLine,
            { backgroundColor: colors.muted, width: "70%" },
          ]}
        />
        <View
          style={[
            styles.skeletonLine,
            { backgroundColor: colors.muted, width: "50%" },
          ]}
        />
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
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const selectedKey = localDayKey(selectedDate);
  const todayKey = localDayKey(new Date());
  const segment =
    selectedKey === todayKey
      ? "today"
      : selectedKey < todayKey
        ? "past"
        : "upcoming";
  const activeQuery = useWorkerShifts("all");
  // Complete schedule: filtering a page would falsely show empty future dates.
  const allShifts = useMemo(
    () => activeQuery.data?.shifts ?? (!isOnline ? (cachedShifts ?? []) : []),
    [activeQuery.data, isOnline, cachedShifts],
  );
  useEffect(() => {
    if (isOnline && activeQuery.data)
      void cacheWorkerShifts(activeQuery.data.shifts);
    else if (!isOnline)
      void getCachedWorkerShifts<WorkerShift>().then((cached) =>
        setCachedShifts(cached ?? []),
      );
  }, [isOnline, activeQuery.data]);
  const dayKeyForShift = (shift: WorkerShift) => {
    const value =
      shift.scheduled_start ?? shift.clocked_in_at ?? shift.clocked_out_at;
    return value ? localDayKey(new Date(value)) : null;
  };
  const counts: Record<string, number> = {};
  for (const shift of allShifts) {
    const key = dayKeyForShift(shift);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  const sortedShifts = sortTodayShiftsForList(
    allShifts.filter((shift) => dayKeyForShift(shift) === selectedKey),
  );
  const primaryShiftId =
    segment === "today" ? getPrimaryTodayShiftId(sortedShifts) : null;

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["worker", "shifts"] });
  }, [queryClient]);

  const listHeader = (
    <View style={styles.listHeader}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/worker/availability" as never)}
        style={[styles.availBanner, { backgroundColor: colors.soft }]}
      >
        <Feather name="calendar" size={17} color={colors.primary} />
        <Text
          style={[
            styles.availBannerText,
            { color: colors.primary, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {t("shifts.setAvailability")}
        </Text>
        <Feather name="chevron-right" size={15} color={colors.primary} />
      </Pressable>

      <WeekCalendar
        selected={selectedDate}
        onSelect={setSelectedDate}
        counts={counts}
      />
      <Text
        accessibilityRole="header"
        style={{
          color: colors.foreground,
          fontFamily: FontFamily.interBold,
          fontSize: 21,
          lineHeight: 28,
          marginTop: 8,
        }}
      >
        {selectedKey === todayKey
          ? "Today"
          : selectedDate.toLocaleDateString("en-AU", {
              timeZone: APP_TIMEZONE,
              weekday: "long",
            })}
        {" - "}
        {selectedDate.toLocaleDateString("en-AU", {
          timeZone: APP_TIMEZONE,
          day: "numeric",
          month: "short",
        })}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FontFamily.interRegular,
          fontSize: 13,
        }}
      >
        {sortedShifts.length} shift{sortedShifts.length === 1 ? "" : "s"}
        {!isOnline ? " saved on this device" : " on this day"}
      </Text>
    </View>
  );

  const listFooter = (
    <View style={styles.footer}>
      <Text
        style={[
          styles.hint,
          {
            color: colors.mutedForeground,
            fontFamily: FontFamily.interRegular,
          },
        ]}
      >
        {t("shifts.tapHint")}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.shifts")} />

      {activeQuery.isLoading && !cachedShifts ? (
        <ScrollView
          contentContainerStyle={[
            styles.loading,
            {
              paddingBottom: workerBottomNavHeight(
                insets.bottom,
                Platform.OS === "web",
              ),
            },
          ]}
        >
          {listHeader}
          <ShiftSkeleton />
          <ShiftSkeleton />
        </ScrollView>
      ) : activeQuery.error && isOnline ? (
        <ScrollView
          contentContainerStyle={[
            styles.loading,
            {
              paddingBottom: workerBottomNavHeight(
                insets.bottom,
                Platform.OS === "web",
              ),
            },
          ]}
        >
          {listHeader}
          <Text
            style={[
              styles.errorText,
              {
                color: colors.destructive,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {(activeQuery.error as Error).message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={handleRefresh}
            style={{
              minHeight: 48,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.primary }}>Try again</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <FlatList
          data={sortedShifts}
          keyExtractor={(item) => item.id}
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={[
            styles.list,
            {
              paddingBottom: workerBottomNavHeight(
                insets.bottom,
                Platform.OS === "web",
              ),
            },
          ]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
          refreshControl={
            isOnline ? (
              <RefreshControl
                refreshing={activeQuery.isRefetching}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
              />
            ) : undefined
          }
          renderItem={({ item }) => (
            <ShiftListCard
              shift={item}
              siblingShifts={allShifts}
              showActions={segment === "today" && item.id === primaryShiftId}
              onRefresh={handleRefresh}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View
                style={[styles.emptyIcon, { backgroundColor: colors.muted }]}
              >
                <Feather
                  name="calendar"
                  size={28}
                  color={colors.mutedForeground}
                />
              </View>
              <Text
                style={[
                  styles.emptyTitle,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {isOnline
                  ? "No shifts on this day"
                  : "No saved shifts for this day"}
              </Text>
              <Text
                style={[
                  styles.emptySub,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interRegular,
                  },
                ]}
              >
                {isOnline
                  ? "Choose another date to see your shifts."
                  : "Connect to refresh your schedule."}
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
  loading: {
    padding: 12,
    gap: 12,
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
  },
  listHeader: { gap: 8 },
  availBanner: {
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  availBannerText: { flex: 1, fontSize: 14, lineHeight: 21 },
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
  list: {
    padding: 16,
    gap: 12,
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
  },
  empty: {
    alignItems: "center",
    paddingTop: 48,
    gap: 12,
    paddingHorizontal: 40,
  },
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
