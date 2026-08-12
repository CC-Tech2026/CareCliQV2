import { useRouter } from "expo-router";
import React from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { SettingsLinkRow } from "@/components/worker/settings/SettingsLinkRow";
import { SettingsPageHeader, SettingsPanelCard } from "@/components/worker/settings/settings-ui";
import { WorkerBottomNav, workerBottomNavHeight } from "@/components/worker/WorkerBottomNav";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { usePreferences } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";

type NavItem = {
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: "user" | "briefcase" | "sliders" | "shield";
  href: "/settings/account" | "/settings/provider" | "/settings/defaults" | "/settings/compliance";
};

const NAV_ITEMS: NavItem[] = [
  {
    labelKey: "settings.nav.account",
    descriptionKey: "settings.account.subtitle",
    icon: "user",
    href: "/settings/account",
  },
  {
    labelKey: "settings.nav.provider",
    descriptionKey: "settings.provider.subtitle",
    icon: "briefcase",
    href: "/settings/provider",
  },
  {
    labelKey: "settings.nav.defaults",
    descriptionKey: "settings.defaults.subtitle",
    icon: "sliders",
    href: "/settings/defaults",
  },
  {
    labelKey: "settings.nav.compliance",
    descriptionKey: "settings.compliance.subtitle",
    icon: "shield",
    href: "/settings/compliance",
  },
];

export default function SettingsIndexScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = usePreferences();
  const bottomInset = workerBottomNavHeight(insets.bottom, Platform.OS === "web");

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.settings")} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <SettingsPageHeader />
          <SettingsPanelCard>
            <View style={styles.list}>
              {NAV_ITEMS.map((item, index) => (
                <SettingsLinkRow
                  key={item.href}
                  icon={item.icon}
                  label={t(item.labelKey)}
                  value={t(item.descriptionKey)}
                  showDivider={index < NAV_ITEMS.length - 1}
                  onPress={() => router.push(item.href as never)}
                />
              ))}
            </View>
          </SettingsPanelCard>
        </View>
      </ScrollView>
      <View style={styles.bottomNav}>
        <WorkerBottomNav />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingTop: 4 },
  content: { paddingHorizontal: 16, gap: 12 },
  list: { marginHorizontal: -16, marginVertical: -16 },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
