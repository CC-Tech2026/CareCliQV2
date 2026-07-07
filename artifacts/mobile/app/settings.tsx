import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WorkerCardSection } from "@/components/worker/WorkerCardSection";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { LANGUAGES, type TranslationKey } from "@/lib/i18n/translations";
import { shiftInitials } from "@/lib/shift-utils";

type Row = {
  labelKey: TranslationKey;
  icon: keyof typeof Feather.glyphMap;
  href: string;
  value?: string;
};

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { t, themeMode, language } = usePreferences();

  const languageLabel = LANGUAGES.find((l) => l.code === language)?.nativeLabel ?? "English";
  const themeLabel = t(
    themeMode === "light"
      ? "accessibility.theme.light"
      : themeMode === "dark"
        ? "accessibility.theme.dark"
        : "accessibility.theme.system",
  );

  const rows: Row[] = [
    { labelKey: "nav.notifications", icon: "bell", href: "/worker/notifications" },
    { labelKey: "nav.credentials", icon: "award", href: "/credentials" },
    { labelKey: "nav.toolkit", icon: "briefcase", href: "/toolkit" },
    { labelKey: "nav.availability", icon: "calendar", href: "/worker/availability" },
    { labelKey: "nav.compliance", icon: "shield", href: "/(tabs)/compliance" },
    { labelKey: "nav.accessibility", icon: "sliders", href: "/accessibility", value: `${themeLabel} · ${languageLabel}` },
  ];

  return (
    <WorkerStackScreen
      headerTitle={t("nav.settings")}
      pageTitle={t("settings.title")}
      subtitle={t("settings.subtitle")}
      cardsOnBackground
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={[styles.avatarText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
              {shiftInitials(user?.full_name)}
            </Text>
          </View>
          <View style={styles.profileText}>
            <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {user?.full_name ?? t("settings.worker")}
            </Text>
            {user?.email ? (
              <Text style={[styles.email, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>

        <WorkerCardSection icon="settings" title={t("settings.preferences")}>
          <View style={styles.rowGroup}>
            {rows.map((row, index) => (
              <Pressable
                key={row.href}
                onPress={() => router.push(row.href as never)}
                style={[
                  styles.row,
                  index < rows.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View style={[styles.rowIcon, { backgroundColor: colors.activeBg }]}>
                  <Feather name={row.icon} size={17} color={colors.primary} />
                </View>
                <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {t(row.labelKey)}
                </Text>
                {row.value ? (
                  <Text style={[styles.rowValue, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                    {row.value}
                  </Text>
                ) : null}
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </WorkerCardSection>

        <Pressable
          onPress={() => void logout().then(() => router.replace("/login" as never))}
          style={[styles.signOut, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Feather name="log-out" size={17} color={colors.destructive} />
          <Text style={[styles.signOutText, { color: colors.destructive, fontFamily: "Inter_700Bold" }]}>
            {t("common.signOut")}
          </Text>
        </Pressable>
      </ScrollView>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 14 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16 },
  profileText: { flex: 1, gap: 2 },
  name: { fontSize: 16 },
  email: { fontSize: 12 },
  rowGroup: { marginTop: -4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { flex: 1, fontSize: 14 },
  rowValue: { fontSize: 12, textAlign: "right", maxWidth: 150 },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
  },
  signOutText: { fontSize: 14 },
});
