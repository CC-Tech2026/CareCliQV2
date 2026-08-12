import { Feather } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";

export type WorkerTabId = "shifts" | "profile" | "compliance";

type TabConfig = {
  id: WorkerTabId;
  labelKey: TranslationKey;
  icon: keyof typeof Feather.glyphMap;
  href: string;
};

export const WORKER_TABS: TabConfig[] = [
  { id: "shifts", labelKey: "nav.shifts", icon: "clock", href: "/(tabs)/shifts" },
  { id: "profile", labelKey: "nav.profile", icon: "user", href: "/(tabs)/profile" },
  { id: "compliance", labelKey: "nav.compliance", icon: "shield", href: "/(tabs)/compliance" },
];

export function workerBottomNavHeight(insetsBottom: number, isWeb: boolean): number {
  return (isWeb ? 84 : 60 + insetsBottom) + 8;
}

type BarProps = {
  activeTab?: WorkerTabId | null;
  onTabPress: (href: string) => void;
};

export function WorkerBottomNavBar({ activeTab, onTabPress }: BarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {WORKER_TABS.map((tab) => {
        const active = activeTab === tab.id;
        const label = t(tab.labelKey);
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="button"
            accessibilityState={active ? { selected: true } : {}}
            accessibilityLabel={label}
            onPress={() => onTabPress(tab.href)}
            style={styles.tab}
          >
            {active ? (
              <View style={[styles.activeIndicator, { backgroundColor: colors.primary }]} />
            ) : null}
            <View
              style={[
                styles.iconPill,
                active ? { backgroundColor: colors.activeBg, width: 52 } : { width: 36 },
              ]}
            >
              <Feather
                name={tab.icon}
                size={20}
                color={active ? colors.primary : colors.mutedForeground}
              />
            </View>
            <Text
              style={[
                styles.label,
                {
                  color: active ? colors.primary : colors.mutedForeground,
                  fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function WorkerBottomNav() {
  const router = useRouter();
  return (
    <WorkerBottomNavBar
      activeTab={null}
      onTabPress={(href) => router.replace(href as never)}
    />
  );
}

export function WorkerMobileTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const activeTab = (state.routes[state.index]?.name ?? "shifts") as WorkerTabId;

  return (
    <WorkerBottomNavBar
      activeTab={activeTab}
      onTabPress={(href) => {
        const route = WORKER_TABS.find((t) => t.href === href);
        if (!route) return;
        const index = state.routes.findIndex((r) => r.name === route.id);
        if (index < 0) return;
        const event = navigation.emit({
          type: "tabPress",
          target: state.routes[index].key,
          canPreventDefault: true,
        });
        if (state.index !== index && !event.defaultPrevented) {
          navigation.navigate(route.id);
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 60,
    position: "relative",
  },
  activeIndicator: {
    position: "absolute",
    top: 0,
    width: 32,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  iconPill: {
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 10.5, lineHeight: 12 },
});
