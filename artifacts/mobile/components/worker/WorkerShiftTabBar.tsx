import { FontFamily } from "@/constants/typography";
import * as Haptics from "@/lib/haptics";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export type ShiftTab<T extends string> = {
  id: T;
  label: string;
  renderIcon: (color: string) => React.ReactNode;
  /** Short count shown beside the icon, e.g. "2/5" or "3". */
  badge?: string;
  /** Small dot on the icon: something on this tab needs attention. */
  attention?: boolean;
};

type Props<T extends string> = {
  tabs: ShiftTab<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
};

/** Icon-over-label tabs for moving around a live shift. Scrolls sideways when
 * the tabs don't fit, so a narrow phone never squeezes the labels. */
export function WorkerShiftTabBar<T extends string>({ tabs, activeTab, onChange }: Props<T>) {
  const colors = useColors();

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.wrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          const color = active ? colors.primary : colors.mutedForeground;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={[tab.label, tab.badge, tab.attention ? "needs attention" : null]
                .filter(Boolean)
                .join(", ")}
              onPress={() => {
                if (active) return;
                Haptics.selectionAsync();
                onChange(tab.id);
              }}
              style={styles.tab}
            >
              <View style={styles.iconRow}>
                <View>
                  {tab.renderIcon(color)}
                  {tab.attention ? (
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: colors.destructive, borderColor: colors.card },
                      ]}
                    />
                  ) : null}
                </View>
                {tab.badge ? (
                  <View style={[styles.badge, { backgroundColor: active ? colors.activeBg : colors.muted }]}>
                    <Text style={[styles.badgeText, { color, fontFamily: FontFamily.interSemiBold }]}>
                      {tab.badge}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  {
                    color,
                    fontFamily: active ? FontFamily.interBold : FontFamily.interMedium,
                  },
                ]}
              >
                {tab.label.toUpperCase()}
              </Text>
              <View
                style={[
                  styles.indicator,
                  { backgroundColor: active ? colors.primary : "transparent" },
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexGrow: 1,
    paddingHorizontal: 4,
  },
  tab: {
    flexGrow: 1,
    minWidth: 86,
    alignItems: "center",
    paddingTop: 10,
    paddingHorizontal: 8,
    gap: 5,
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 24,
  },
  dot: {
    position: "absolute",
    top: -2,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 15,
  },
  label: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.6,
  },
  indicator: {
    alignSelf: "stretch",
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginTop: 4,
  },
});
