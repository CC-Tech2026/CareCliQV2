import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from "react-native";

import { useColors } from "@/hooks/useColors";

export const SECURITY_LIST_PAGE_SIZE = 10;
const CARD_LIST_MAX_HEIGHT = 280;

type Props<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: ListRenderItem<T>;
  emptyLabel: string;
};

export function SecurityCardScrollList<T>({
  items,
  keyExtractor,
  renderItem,
  emptyLabel,
}: Props<T>) {
  const colors = useColors();
  const loadingMoreRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(SECURITY_LIST_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(SECURITY_LIST_PAGE_SIZE);
  }, [items]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setVisibleCount((count) => Math.min(count + SECURITY_LIST_PAGE_SIZE, items.length));
    requestAnimationFrame(() => {
      loadingMoreRef.current = false;
    });
  }, [hasMore, items.length]);

  if (items.length === 0) {
    return (
      <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {emptyLabel}
      </Text>
    );
  }

  return (
    <FlatList
      data={visibleItems}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      style={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      nestedScrollEnabled
      showsVerticalScrollIndicator
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.25}
      ListFooterComponent={
        hasMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        ) : (
          <View style={styles.footerSpacer} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: CARD_LIST_MAX_HEIGHT },
  separator: { height: 10 },
  empty: { fontSize: 13, lineHeight: 18 },
  footer: { paddingVertical: 12, alignItems: "center" },
  footerSpacer: { height: 4 },
});
