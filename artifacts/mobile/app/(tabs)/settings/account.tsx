import { useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SettingsAccountPanel } from "@/components/worker/settings/SettingsAccountPanel";
import { SettingsCompliancePanel } from "@/components/worker/settings/SettingsCompliancePanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/context/PreferencesContext";

type AccountTab = "profile" | "compliance";

export default function SettingsAccountScreen() {
  const t = useT();
  const colors = useColors();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<AccountTab>(
    (["profile", "compliance"] as const).includes(initialTab as AccountTab)
      ? (initialTab as AccountTab)
      : "profile",
  );

  const tabs = useMemo(
    () =>
      [
        { id: "profile" as const, label: t("settings.row.profileDetails") },
        { id: "compliance" as const, label: t("settings.nav.compliance") },
      ],
    [t],
  );

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.row.accountDetails")}>
      <View style={styles.tabBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
          {tabs.map((item) => {
            const active = tab === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setTab(item.id)}
                style={[
                  styles.folderTab,
                  { backgroundColor: active ? colors.card : colors.soft },
                ]}
              >
                <Text
                  style={[
                    styles.folderTabText,
                    {
                      color: active ? colors.primary : colors.mutedForeground,
                      fontFamily: active ? "Inter_700Bold" : "Inter_600SemiBold",
                    },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={[styles.panel, { backgroundColor: colors.card }]}>
        {tab === "profile" && <SettingsAccountPanel />}
        {tab === "compliance" && <SettingsCompliancePanel />}
      </View>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  tabBarWrap: { paddingHorizontal: 16 },
  tabBar: { flexDirection: "row", gap: 3 },
  folderTab: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  folderTabText: { fontSize: 13 },
  panel: { flex: 1, paddingTop: 14, borderTopRightRadius: 14 },
});
