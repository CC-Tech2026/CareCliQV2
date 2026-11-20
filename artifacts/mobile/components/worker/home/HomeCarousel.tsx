import React, { useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";

export type CarouselPage = {
  key: string;
  label: string;
  /** Small count next to the tab label, e.g. how many to-dos. */
  badge?: number;
  /** Danger-coloured badge (something overdue or expired). */
  urgent?: boolean;
  render: (width: number) => React.ReactNode;
};

const GAP = 12;
const SIDE = 20;
/** How much of the next card shows, so it's obvious the row swipes. */
const PEEK = 18;

/**
 * Swipeable home cards with tabs above them. Swiping and tapping a tab do the
 * same thing, so workers who don't think to swipe still find every card.
 */
export function HomeCarousel({ pages }: { pages: CarouselPage[] }) {
  const colors = useColors();
  const { width: screen } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const cardWidth = Math.min(screen, 800) - SIDE * 2 - PEEK;
  const step = cardWidth + GAP;

  const goTo = (next: number) => {
    setIndex(next);
    scroll.current?.scrollTo({ x: next * step, animated: true });
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / step);
    setIndex(Math.max(0, Math.min(pages.length - 1, next)));
  };

  return (
    <View>
      {/* Scrolls sideways when the tabs don't fit (e.g. on a birthday). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
        accessibilityRole="tablist"
      >
        {pages.map((page, i) => {
          const active = i === index;
          return (
            <Pressable
              key={page.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => goTo(i)}
              style={[
                styles.tab,
                {
                  backgroundColor: active ? colors.foreground : colors.card,
                  borderColor: active ? colors.foreground : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color: active ? colors.background : colors.foreground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {page.label}
              </Text>
              {page.badge ? (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: page.urgent
                        ? colors.destructive
                        : active
                          ? colors.background
                          : colors.soft,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color: page.urgent
                          ? "#FFFFFF"
                          : active
                            ? colors.foreground
                            : colors.primary,
                        fontFamily: FontFamily.interBold,
                      },
                    ]}
                  >
                    {page.badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        scrollEventThrottle={16}
        // Every card stretches to the tallest, so the row reads as one set.
        contentContainerStyle={{ paddingHorizontal: SIDE, gap: GAP, alignItems: "stretch" }}
        style={styles.row}
      >
        {pages.map((page) => (
          <View key={page.key} style={{ width: cardWidth, alignSelf: "stretch" }}>
            {page.render(cardWidth)}
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots} importantForAccessibility="no-hide-descendants">
        {pages.map((page, i) => (
          <View
            key={page.key}
            style={[
              styles.dot,
              i === index
                ? { width: 20, backgroundColor: colors.primary }
                : { backgroundColor: colors.mutedForeground, opacity: 0.3 },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabsScroll: { marginHorizontal: -SIDE, marginBottom: 14, flexGrow: 0 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: SIDE },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  tabText: { fontSize: 14 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11 },
  row: { marginHorizontal: -SIDE },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
