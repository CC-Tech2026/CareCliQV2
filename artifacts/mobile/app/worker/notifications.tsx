import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import {
  useDismissNotification,
  useWorkerNotifications,
} from "@/hooks/worker/useWorkerNotifications";
import { useColors } from "@/hooks/useColors";
import type { UserNotification } from "@/lib/worker-api";

function groupByDate(notifications: UserNotification[]): Array<{ date: string; items: UserNotification[] }> {
  const groups: Record<string, UserNotification[]> = {};
  for (const n of notifications) {
    const key = new Date(n.created_at).toLocaleDateString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  }
  return Object.entries(groups).map(([date, items]) => ({ date, items }));
}

function NotificationRow({
  item,
  onDismiss,
  onPress,
}: {
  item: UserNotification;
  onDismiss: (id: string) => void;
  onPress: () => void;
}) {
  const colors = useColors();
  const unread = !item.read_at && !item.dismissed_at;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: unread ? colors.primary : colors.border,
          borderLeftWidth: unread ? 4 : 1,
        },
      ]}
    >
      <View style={styles.rowContent}>
        <Text style={[styles.rowTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {item.title}
        </Text>
        <Text style={[styles.rowBody, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {item.body}
        </Text>
        <Text style={[styles.rowTime, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {new Date(item.created_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>
      {!item.dismissed_at && (
        <Pressable onPress={() => onDismiss(item.id)} hitSlop={8}>
          <Text style={[styles.dismiss, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            Dismiss
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export default function WorkerNotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data = [], isLoading, refetch, isRefetching } = useWorkerNotifications();
  const dismiss = useDismissNotification();

  const grouped = useMemo(() => groupByDate(data), [data]);
  const flatData = useMemo(
    () =>
      grouped.flatMap((g) => [
        { type: "header" as const, id: g.date, date: g.date },
        ...g.items.map((item) => ({ type: "item" as const, id: item.id, item })),
      ]),
    [grouped],
  );

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const handlePress = (item: UserNotification) => {
    if (item.shift_id) {
      const query = item.event_type === "compliance_checkin" ? "?checkin=pending" : "";
      router.push(`/shift/${item.shift_id}${query}` as never);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { borderColor: colors.border }]}>
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Notifications
        </Text>
        <View style={styles.backBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          renderItem={({ item }) => {
            if (item.type === "header") {
              return (
                <Text style={[styles.dateHeader, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                  {item.date}
                </Text>
              );
            }
            return (
              <NotificationRow
                item={item.item}
                onDismiss={(id) => dismiss.mutate(id)}
                onPress={() => handlePress(item.item)}
              />
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="bell" size={32} color={colors.mutedForeground} />
              <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                No notifications
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, fontSize: 18, textAlign: "center" },
  list: { padding: 16, gap: 10 },
  dateHeader: { fontSize: 12, letterSpacing: 0.5, marginTop: 8, marginBottom: 6 },
  row: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    gap: 12,
  },
  rowContent: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 14 },
  rowBody: { fontSize: 13, lineHeight: 18 },
  rowTime: { fontSize: 11, marginTop: 4 },
  dismiss: { fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 },
  empty: { fontSize: 15 },
});
