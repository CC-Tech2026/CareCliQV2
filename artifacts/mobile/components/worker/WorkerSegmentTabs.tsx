import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";

export type SegmentTabConfig<T extends string> = {
  id: T;
  labelKey: TranslationKey;
};

type Props<T extends string> = {
  tabs: SegmentTabConfig<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
};

export function WorkerSegmentTabs<T extends string>({ tabs, activeTab, onChange }: Props<T>) {
  const colors = useColors();
  const t = useT();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={styles.tab}
          >
            <Text
              style={[
                styles.label,
                {
                  color: active ? colors.primary : colors.mutedForeground,
                  fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                },
              ]}
              numberOfLines={1}
            >
              {t(tab.labelKey)}
            </Text>
            {active ? <View style={[styles.indicator, { backgroundColor: colors.primary }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
    paddingHorizontal: 4,
  },
  label: { fontSize: 14, lineHeight: 18, textAlign: "center" },
  indicator: {
    width: "72%",
    height: 3,
    borderRadius: 999,
  },
});
