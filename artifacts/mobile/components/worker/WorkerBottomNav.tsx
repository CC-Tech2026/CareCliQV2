import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";

export type WorkerTabId = "index" | "shifts" | "compliance";

type TabConfig = {
  id: WorkerTabId;
  labelKey: TranslationKey;
  icon: keyof typeof Feather.glyphMap;
  href: string;
};

type TabBarRoute = { key: string; name: string };

export type WorkerMobileTabBarProps = {
  state: {
    index: number;
    routes: TabBarRoute[];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  descriptors?: any;
  navigation: {
    emit: (event: {
      type: string;
      target: string;
      canPreventDefault: boolean;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

export const WORKER_TABS: TabConfig[] = [
  { id: "index", labelKey: "nav.home", icon: "home", href: "/(tabs)" },
  { id: "shifts", labelKey: "nav.shifts", icon: "calendar", href: "/(tabs)/shifts" },
  { id: "compliance", labelKey: "nav.compliance", icon: "shield", href: "/(tabs)/compliance" },
];

export function workerBottomNavHeight(insetsBottom: number, isWeb: boolean): number {
  return (isWeb ? 96 : 72 + insetsBottom) + 20;
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
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 10),
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
            <Feather
              name={tab.icon}
              size={22}
              color={active ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[
                styles.label,
                {
                  color: active ? colors.primary : colors.mutedForeground,
                  fontFamily: "Inter_500Medium",
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

export function WorkerMobileTabBar({ state, navigation }: WorkerMobileTabBarProps) {
  const routeName = state.routes[state.index]?.name ?? "index";
  const activeTab = (
    routeName === "index" || routeName === "shifts" || routeName === "compliance"
      ? routeName
      : null
  ) as WorkerTabId | null;

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
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: 52,
  },
  label: { fontSize: 10, lineHeight: 12 },
});
