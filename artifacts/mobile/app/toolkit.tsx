import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WorkerCardSection } from "@/components/worker/WorkerCardSection";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { usePreferences } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  getMyToolkit,
  requestToolkitRestock,
  useToolkitItem,
  type ToolkitItem,
} from "@/lib/resource-api";

function isLow(item: ToolkitItem): boolean {
  return item.low_stock ?? Number(item.quantity ?? 0) <= Number(item.minimum_quantity ?? 0);
}

export default function ToolkitScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = usePreferences();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["toolkit", "me"],
    queryFn: getMyToolkit,
  });

  const items = data?.items ?? [];
  const movements = data?.movements ?? [];

  const summary = useMemo(
    () => ({
      total: items.length,
      low: items.filter(isLow).length,
      assigned: items.filter((i) => !!i.assigned_user_id).length,
    }),
    [items],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["toolkit", "me"] });

  const useItem = useMutation({
    mutationFn: (item: ToolkitItem) => useToolkitItem(item.id, 1),
    onSuccess: () => {
      invalidate();
      Alert.alert(t("toolkit.usageLogged"));
    },
    onError: () => Alert.alert(t("toolkit.actionFailed")),
  });

  const restock = useMutation({
    mutationFn: (item: ToolkitItem) => requestToolkitRestock(item.id, item.minimum_quantity || 1),
    onSuccess: () => {
      invalidate();
      Alert.alert(t("toolkit.restockSent"));
    },
    onError: () => Alert.alert(t("toolkit.actionFailed")),
  });

  const summaryCards = [
    { key: "items", label: t("toolkit.items"), value: summary.total, tone: colors.foreground },
    { key: "low", label: t("toolkit.lowStockCount"), value: summary.low, tone: summary.low > 0 ? "#B45309" : colors.foreground },
    { key: "assigned", label: t("toolkit.assignedCount"), value: summary.assigned, tone: colors.foreground },
  ];

  return (
    <WorkerStackScreen
      headerTitle={t("nav.toolkit")}
      pageTitle={t("toolkit.title")}
      subtitle={t("toolkit.subtitle")}
      cardsOnBackground
    >
      {isLoading ? (
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
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.summaryGrid}>
            {summaryCards.map((card) => (
              <View key={card.key} style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                  {card.label}
                </Text>
                <Text style={[styles.summaryValue, { color: card.tone, fontFamily: "Inter_700Bold" }]}>{card.value}</Text>
              </View>
            ))}
          </View>

          <WorkerCardSection icon="tool" title={t("toolkit.assignedKit")}>
            {items.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {t("toolkit.empty")}
              </Text>
            ) : (
              <View>
                {items.map((item, index) => {
                  const low = isLow(item);
                  const category = item.category || "General";
                  const busy = useItem.isPending || restock.isPending;
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.itemRow,
                        index < items.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                      ]}
                    >
                      <View style={styles.itemHeader}>
                        <Text style={[styles.itemName, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                          {item.name}
                        </Text>
                        {low ? (
                          <View style={styles.lowBadge}>
                            <Feather name="alert-triangle" size={11} color="#B45309" />
                            <Text style={[styles.lowBadgeText, { fontFamily: "Inter_700Bold" }]}>{t("toolkit.lowStock")}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.itemMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        {t("toolkit.unitsAvailable", { category, count: `${item.quantity} ${item.unit}` })}
                        {item.minimum_quantity ? ` · ${t("toolkit.minimum", { count: item.minimum_quantity })}` : ""}
                      </Text>
                      <View style={styles.itemActions}>
                        <Pressable
                          onPress={() => useItem.mutate(item)}
                          disabled={busy || item.quantity <= 0}
                          style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.background, opacity: item.quantity <= 0 ? 0.5 : 1 }]}
                        >
                          <Text style={[styles.actionText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                            {t("toolkit.useItem")}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => restock.mutate(item)}
                          disabled={busy}
                          style={[styles.actionBtn, { borderColor: "transparent", backgroundColor: colors.activeBg }]}
                        >
                          <Text style={[styles.actionText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                            {t("toolkit.requestRestock")}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </WorkerCardSection>

          <WorkerCardSection icon="rotate-ccw" title={t("toolkit.movementHistory")}>
            {movements.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {t("toolkit.movementEmpty")}
              </Text>
            ) : (
              <View style={styles.movementList}>
                {movements.slice(0, 8).map((movement) => (
                  <View key={movement.id} style={styles.movementRow}>
                    <View style={[styles.movementPill, { backgroundColor: colors.activeBg }]}>
                      <Text style={[styles.movementType, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                        {movement.movement_type}
                      </Text>
                    </View>
                    <Text style={[styles.movementQty, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                      {movement.quantity}
                    </Text>
                    <Text style={[styles.movementNote, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                      {movement.notes || ""}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </WorkerCardSection>
        </ScrollView>
      )}
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  error: { fontSize: 14, textAlign: "center" },
  empty: { fontSize: 14 },
  scroll: { padding: 16, gap: 14 },
  summaryGrid: { flexDirection: "row", gap: 10 },
  summaryCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, gap: 4 },
  summaryLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  summaryValue: { fontSize: 22 },
  itemRow: { paddingVertical: 14, gap: 8 },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  itemName: { fontSize: 15 },
  lowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FDE68A",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  lowBadgeText: { fontSize: 10, color: "#B45309", textTransform: "uppercase", letterSpacing: 0.4 },
  itemMeta: { fontSize: 12, lineHeight: 18 },
  itemActions: { flexDirection: "row", gap: 8, marginTop: 2 },
  actionBtn: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  actionText: { fontSize: 12 },
  movementList: { gap: 10 },
  movementRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  movementPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  movementType: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  movementQty: { fontSize: 13 },
  movementNote: { flex: 1, fontSize: 12 },
});
