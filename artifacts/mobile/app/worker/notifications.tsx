import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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

import { OfflineBanner } from "@/components/OfflineBanner";
import { NotificationListItem } from "@/components/worker/notifications/NotificationListItem";
import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { useT } from "@/context/PreferencesContext";
import {
  markShiftComplianceCheckinNotificationsRead,
  useDismissNotification,
  useWorkerNotificationsInfinite,
} from "@/hooks/worker/useWorkerNotifications";
import { useColors } from "@/hooks/useColors";
import type { UserNotification } from "@/lib/worker-api";

type ListRow =
  | { type: "header"; id: string; date: string }
  | { type: "item"; id: string; item: UserNotification };

function groupByDate(notifications: UserNotification[]): Array<{ date: string; items: UserNotification[] }> {
  const groups: Record<string, UserNotification[]> = {};
  for (const notification of notifications) {
    const key = new Date(notification.created_at).toLocaleDateString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    if (!groups[key]) groups[key] = [];
    groups[key].push(notification);
  }
  return Object.entries(groups).map(([date, items]) => ({ date, items }));
}

export default function WorkerNotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const dismiss = useDismissNotification();
  const loadingMoreRef = useRef(false);
  const isDark = colors.scheme === "dark";

  const {
    data,
    isLoading,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useWorkerNotificationsInfinite();

  const notifications = useMemo(
    () => data?.pages.flatMap((page) => page.notifications) ?? [],
    [data?.pages],
  );

  const flatData = useMemo<ListRow[]>(
    () =>
      groupByDate(notifications).flatMap((group) => [
        { type: "header" as const, id: `header-${group.date}`, date: group.date },
        ...group.items.map((item) => ({ type: "item" as const, id: item.id, item })),
      ]),
    [notifications],
  );

  const handlePress = useCallback(
    (item: UserNotification) => {
      if (item.shift_id) {
        if (item.event_type === "compliance_checkin") {
          markShiftComplianceCheckinNotificationsRead(queryClient, item.shift_id);
        }
        const query = item.event_type === "compliance_checkin" ? "?checkin=pending" : "";
        router.push(`/shift/${item.shift_id}${query}` as never);
      }
    },
    [queryClient, router],
  );

  const handleLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    void fetchNextPage().finally(() => {
      loadingMoreRef.current = false;
    });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const renderFooter = () => {
    if (!isFetchingNextPage) return <View style={styles.listFooter} />;
    return (
      <View style={styles.listFooter}>
        <ActivityIndicator color={colors.primary} size="small" />
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.notifications")} showBack />

      <View style={[styles.subheader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("notifications.subtitle")}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            flatData.length === 0 && styles.listEmpty,
            { paddingBottom: insets.bottom + 24 },
          ]}
          refreshControl={
            <RefreshControl refreshing={isRefetching && !isFetchingNextPage} onRefresh={refetch} tintColor={colors.primary} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.35}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          ListFooterComponent={renderFooter}
          renderItem={({ item }) => {
            if (item.type === "header") {
              return (
                <Text style={[styles.dateHeader, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                  {item.date}
                </Text>
              );
            }
            return (
              <NotificationListItem
                item={item.item}
                onDismiss={(id) => dismiss.mutate(id)}
                onPress={() => handlePress(item.item)}
              />
            );
          }}
          ListEmptyComponent={
            <View
              style={[
                styles.emptyCard,
                elevatedCardShadow(isDark),
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={[styles.emptyIcon, { backgroundColor: colors.soft }]}>
                <Feather name="bell" size={24} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {t("notifications.empty")}
              </Text>
              <Text style={[styles.emptyHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {t("notifications.emptyHint")}
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
  subheader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
  },
  subtitle: { fontSize: 12, lineHeight: 17 },
  list: { paddingHorizontal: 16, paddingTop: 16 },
  listEmpty: { flexGrow: 1, justifyContent: "center" },
  dateHeader: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 4,
  },
  listFooter: {
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 36,
    gap: 10,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, textAlign: "center" },
  emptyHint: { fontSize: 13, lineHeight: 19, textAlign: "center" },
});
