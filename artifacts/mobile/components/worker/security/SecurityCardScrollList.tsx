import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

export const SECURITY_LIST_PAGE_SIZE = 10;

type Props = {
  items: readonly unknown[];
  keyExtractor: (item: any) => string;
  renderItem: (info: { item: any; index: number }) => React.ReactElement | null;
  emptyLabel: string;
};

export function SecurityCardScrollList({
  items,
  keyExtractor,
  renderItem,
  emptyLabel,
}: Props) {
  const colors = useColors();
  const t = useT();
  const [visibleCount, setVisibleCount] = useState(SECURITY_LIST_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(SECURITY_LIST_PAGE_SIZE);
  }, [items]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  const handleLoadMore = useCallback(() => {
    if (!hasMore) return;
    setVisibleCount((count) => Math.min(count + SECURITY_LIST_PAGE_SIZE, items.length));
  }, [hasMore, items.length]);

  if (items.length === 0) {
    return (
      <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {emptyLabel}
      </Text>
    );
  }

  return (
    <View>
      {visibleItems.map((item, index) => (
        <View key={keyExtractor(item)} style={index > 0 ? styles.itemGap : undefined}>
          {renderItem({ item, index })}
        </View>
      ))}
      {hasMore ? (
        <Pressable
          onPress={handleLoadMore}
          style={[styles.loadMore, { borderColor: colors.border }]}
        >
          <Text style={[styles.loadMoreText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            {t("common.loadMore")}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.footerSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  itemGap: { marginTop: 10 },
  empty: { fontSize: 13, lineHeight: 18 },
  loadMore: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  loadMoreText: { fontSize: 13 },
  footerSpacer: { height: 4 },
});
