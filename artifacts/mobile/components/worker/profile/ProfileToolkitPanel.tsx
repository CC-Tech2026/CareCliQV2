import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { SettingsSection } from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
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

type Props = {
  bottomInset?: number;
  showSectionHeader?: boolean;
};

export function ProfileToolkitPanel({ bottomInset = 24, showSectionHeader = false }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isDark = colors.scheme === "dark";

  const { data, isLoading, error } = useQuery({
    queryKey: ["toolkit", "me"],
    queryFn: getMyToolkit,
  });

  const items = data?.items ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["toolkit", "me"] });

  const useItemMutation = useMutation({
    mutationFn: (item: ToolkitItem) => useToolkitItem(item.id, 1),
    onSuccess: () => {
      invalidate();
      showToast(t("toolkit.usageLogged"), "success");
    },
    onError: (e: Error) => showToast(e.message || t("toolkit.actionFailed"), "error"),
  });

  const restockMutation = useMutation({
    mutationFn: (item: ToolkitItem) => requestToolkitRestock(item.id, item.minimum_quantity || 1),
    onSuccess: () => {
      invalidate();
      showToast(t("toolkit.restockSent"), "success");
    },
    onError: (e: Error) => showToast(e.message || t("toolkit.actionFailed"), "error"),
  });

  const busy = useItemMutation.isPending || restockMutation.isPending;

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
          {(error as Error).message}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      {showSectionHeader ? (
        <SettingsSection
          title={t("toolkit.title")}
          description={t("toolkit.subtitle")}
          icon="briefcase"
        />
      ) : null}
      <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {t("profile.toolkit.inventoryHint")}
      </Text>

      {items.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {t("toolkit.empty")}
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.card,
            elevatedCardShadow(isDark),
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {items.map((item, index) => {
            const low = isLow(item);
            const category = item.category || t("toolkit.general");
            const meta = t("toolkit.unitsAvailable", {
              category,
              count: `${item.quantity} ${item.unit}`,
            });
            const canUse = item.quantity > 0;

            return (
              <View
                key={item.id}
                style={[
                  styles.row,
                  index < items.length - 1 && {
                    borderBottomColor: colors.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: low ? "#FEF3C7" : colors.soft }]}>
                  <Feather
                    name={low ? "alert-triangle" : "package"}
                    size={18}
                    color={low ? "#B45309" : colors.composerPurple}
                  />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {meta}
                    {item.minimum_quantity ? ` · ${t("toolkit.minimum", { count: item.minimum_quantity })}` : ""}
                  </Text>
                  {low ? (
                    <Text style={[styles.lowTag, { color: "#B45309", fontFamily: "Inter_700Bold" }]}>
                      {t("toolkit.lowStock")}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => useItemMutation.mutate(item)}
                    disabled={busy || !canUse}
                    style={[
                      styles.actionBtn,
                      { backgroundColor: colors.activeBg, opacity: !canUse ? 0.45 : 1 },
                    ]}
                  >
                    <Text style={[styles.actionText, { color: colors.composerPurple, fontFamily: "Inter_700Bold" }]}>
                      {t("toolkit.useItem")}
                    </Text>
                  </Pressable>
                  {low ? (
                    <Pressable
                      onPress={() => restockMutation.mutate(item)}
                      disabled={busy}
                      style={[styles.actionBtn, { backgroundColor: colors.soft }]}
                    >
                      <Text style={[styles.actionText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                        {t("toolkit.requestRestock")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  error: { fontSize: 14, textAlign: "center" },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  hint: { fontSize: 13, lineHeight: 18 },
  emptyCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  empty: { fontSize: 14, textAlign: "center" },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  copy: { flex: 1, gap: 3 },
  title: { fontSize: 15, lineHeight: 20 },
  meta: { fontSize: 12, lineHeight: 16 },
  lowTag: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  actions: { alignItems: "flex-end", gap: 6, maxWidth: 108 },
  actionBtn: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionText: { fontSize: 11, textAlign: "center" },
});
