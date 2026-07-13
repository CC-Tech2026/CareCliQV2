import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";

import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { useAuth } from "@/context/AuthContext";
import { usePreferences, useT, type ThemeMode } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import {
  disableBiometricUnlock,
  enableBiometricUnlock,
  getBiometricLabel,
  isBiometricHardwareAvailable,
  isBiometricUnlockEnabled,
} from "@/lib/biometric-auth";
import * as Haptics from "@/lib/haptics";
import { listMyCredentials } from "@/lib/resource-api";
import { resolveWorkerDisplayName } from "@/lib/display-name";
import { shiftInitials } from "@/lib/shift-utils";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import { showAlert } from "@/lib/alert";
import { getWorkerProfile } from "@/lib/user-api";

function formatRole(role?: string): string {
  if (!role) return "Support worker";
  const labels: Record<string, string> = {
    support_worker: "Support worker",
    support_coordinator: "Support coordinator",
  };
  if (labels[role]) return labels[role];
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.group}>
      <Text style={[styles.groupTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {title}
      </Text>
      <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
  showDivider = true,
  trailing,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress?: () => void;
  showDivider?: boolean;
  trailing?: React.ReactNode;
}) {
  const colors = useColors();
  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: colors.soft }]}>
        <Feather name={icon} size={15} color={colors.primary} />
      </View>
      <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
        {label}
      </Text>
      {trailing ?? <Feather name="chevron-right" size={15} color={colors.mutedForeground} />}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          showDivider && { borderBottomColor: colors.soft, borderBottomWidth: 1 },
          pressed && { backgroundColor: colors.soft },
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={[styles.row, showDivider && { borderBottomColor: colors.soft, borderBottomWidth: 1 }]}>
      {content}
    </View>
  );
}

function SettingsToggle({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const colors = useColors();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: "#D6D4E2", true: colors.primary }}
      thumbColor="#FFFFFF"
    />
  );
}

export default function SettingsTabScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { user, logout, updateUser } = useAuth();
  const { showToast } = useToast();
  const {
    highContrast,
    setHighContrast,
    reduceMotion,
    setReduceMotion,
    hapticFeedback,
    setHapticFeedback,
    language,
    themeMode,
    setThemeMode,
  } = usePreferences();

  const [biometric, setBiometric] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Biometrics");
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const landing = useWorkerLandingDashboard();
  const { data: profile } = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
  });

  const { data: credentials } = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
  });
  const expiringCount = useMemo(
    () => (credentials ?? []).filter((item) => item.status === "expiring").length,
    [credentials],
  );

  const refreshBiometric = useCallback(async () => {
    const [enabled, available, label] = await Promise.all([
      isBiometricUnlockEnabled(),
      isBiometricHardwareAvailable(),
      getBiometricLabel(),
    ]);
    setBiometric(enabled);
    setBiometricAvailable(available);
    setBiometricLabel(label);
  }, []);

  useEffect(() => {
    void refreshBiometric();
  }, [refreshBiometric]);

  useEffect(() => {
    if (profile?.profile_photo_url && profile.profile_photo_url !== user?.profile_photo_url) {
      void updateUser({ profile_photo_url: profile.profile_photo_url });
    }
  }, [profile?.profile_photo_url, user?.profile_photo_url, updateUser]);

  const displayName = resolveWorkerDisplayName({
    landingFullName: landing.data?.worker.full_name,
    landingFirstName: landing.data?.worker.first_name,
    authFullName: user?.full_name ?? profile?.full_name,
    fallback: user?.email?.split("@")[0] || "Worker",
  });
  const initials = shiftInitials(displayName);
  const photoUrl = user?.profile_photo_url || profile?.profile_photo_url || null;
  const roleLabel = formatRole(user?.role);
  const appVersion =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "1.0.0";
  const languageLabel =
    language === "en"
      ? "English"
      : language === "vi"
        ? "Tiếng Việt"
        : language === "zh"
          ? "简体中文"
          : "العربية";

  const handleBiometricToggle = async (next: boolean) => {
    if (next) {
      if (!biometricAvailable) {
        showAlert(t("settings.row.biometric"), t("settings.biometric.unavailable"));
        return;
      }
      const result = await enableBiometricUnlock();
      if (!result.ok) {
        if (result.reason === "unavailable") {
          showAlert(t("settings.row.biometric"), t("settings.biometric.unavailable"));
        }
        return;
      }
      setBiometric(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t("settings.biometric.enabledHint"), "success");
      return;
    }
    await disableBiometricUnlock();
    setBiometric(false);
  };

  const handleHapticToggle = (next: boolean) => {
    setHapticFeedback(next);
    if (next) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const handleReduceMotionToggle = (next: boolean) => {
    setReduceMotion(next);
    if (!next && hapticFeedback) {
      void Haptics.selectionAsync();
    }
  };

  const handleSignOut = () => {
    void logout().then(() => router.replace("/login" as never));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.profile")} showBack />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileHero}>
          <Pressable
            onPress={() => router.push("/worker/profile-photo" as never)}
            style={styles.profileHeroAvatarWrap}
            accessibilityLabel={t("profile.photo.editA11y")}
          >
            <View style={[styles.profileHeroAvatar, { backgroundColor: colors.soft }]}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.profileHeroImage} contentFit="cover" />
              ) : (
                <Text style={[styles.profileHeroInitials, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                  {initials}
                </Text>
              )}
            </View>
            <View style={[styles.profileHeroEdit, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              <Feather name="edit-2" size={12} color="#FFFFFF" />
            </View>
          </Pressable>
          <Text style={[styles.profileHeroName, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {displayName}
          </Text>
          <Text style={[styles.profileHeroMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {roleLabel}
          </Text>
        </View>

        <SettingsGroup title={t("settings.worker")}>
          <SettingsRow
            icon="award"
            label={t("nav.credentials")}
            onPress={() => router.push("/credentials" as never)}
            trailing={
              expiringCount > 0 ? (
                <View style={[styles.expiringChip, { backgroundColor: colors.statusProgressBg }]}>
                  <Text style={[styles.expiringChipText, { color: colors.warning, fontFamily: "Inter_600SemiBold" }]}>
                    {t("settings.credentialsExpiring", { count: expiringCount })}
                  </Text>
                </View>
              ) : (
                <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
              )
            }
          />
          <SettingsRow
            icon="briefcase"
            label={t("nav.toolkit")}
            onPress={() => router.push("/toolkit" as never)}
          />
          <SettingsRow
            icon="calendar"
            label={t("nav.availability")}
            onPress={() => router.push("/worker/availability" as never)}
            showDivider={false}
          />
        </SettingsGroup>

        <SettingsGroup title={t("settings.group.account")}>
          <SettingsRow
            icon="user"
            label={t("settings.row.profileDetails")}
            onPress={() => router.push("/(tabs)/settings/account" as never)}
          />
          <SettingsRow
            icon="bell"
            label={t("nav.notifications")}
            onPress={() => router.push("/worker/notifications" as never)}
            showDivider={false}
          />
        </SettingsGroup>

        <SettingsGroup title={t("settings.group.security")}>
          <SettingsRow
            icon="key"
            label={t("settings.row.changePassword")}
            onPress={() => router.push("/(tabs)/settings/change-password" as never)}
          />
          <SettingsRow
            icon="smartphone"
            label={biometricLabel}
            trailing={
              <SettingsToggle
                value={biometric}
                onValueChange={(v) => void handleBiometricToggle(v)}
              />
            }
          />
          <SettingsRow
            icon="monitor"
            label={t("security.activeSessions")}
            onPress={() => router.push("/worker/sessions" as never)}
          />
          <SettingsRow
            icon="shield"
            label={t("security.twoFactor")}
            onPress={() => router.push("/worker/security" as never)}
            showDivider={false}
          />
        </SettingsGroup>

        <SettingsGroup title={t("settings.group.privacy")}>
          <SettingsRow
            icon="file-text"
            label={t("privacy.policy")}
            onPress={() => router.push("/worker/privacy-policy" as never)}
          />
          <SettingsRow
            icon="sliders"
            label={t("settings.row.dataPermissions")}
            onPress={() => router.push("/worker/data-permissions" as never)}
          />
          <SettingsRow
            icon="check-square"
            label={t("settings.row.consent")}
            onPress={() => router.push("/worker/consent" as never)}
            showDivider={false}
          />
        </SettingsGroup>

        <SettingsGroup title={t("nav.accessibility")}>
          <SettingsRow
            icon="type"
            label={t("accessibility.fontSize")}
            onPress={() => router.push("/(tabs)/settings/text-size" as never)}
          />
          <SettingsRow
            icon="pause"
            label={t("settings.row.reduceMotion")}
            trailing={
              <SettingsToggle value={reduceMotion} onValueChange={handleReduceMotionToggle} />
            }
          />
          <SettingsRow
            icon="sun"
            label={t("accessibility.highContrast")}
            trailing={<SettingsToggle value={highContrast} onValueChange={setHighContrast} />}
          />
          <SettingsRow
            icon="activity"
            label={t("settings.row.haptic")}
            trailing={
              <SettingsToggle value={hapticFeedback} onValueChange={handleHapticToggle} />
            }
          />
          <SettingsRow
            icon="globe"
            label={`${t("accessibility.languageHeading")} · ${languageLabel}`}
            onPress={() => router.push("/(tabs)/settings/language" as never)}
            showDivider={false}
          />
        </SettingsGroup>

        <SettingsGroup title={t("settings.group.support")}>
          <SettingsRow
            icon="help-circle"
            label={t("settings.row.help")}
            onPress={() => router.push("/toolkit" as never)}
          />
          <SettingsRow
            icon="mail"
            label={t("settings.row.contact")}
            onPress={() => void Linking.openURL("mailto:support@carecliq.com.au")}
          />
          <SettingsRow
            icon="info"
            label={t("settings.row.about", { version: appVersion })}
            onPress={() => showAlert(t("settings.row.about", { version: appVersion }), "CareCliQ")}
            showDivider={false}
          />
        </SettingsGroup>

        <View style={styles.themeSection}>
          <Text style={[styles.groupTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("accessibility.theme")}
          </Text>
          <View style={[styles.themeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {(
              [
                { id: "light" as ThemeMode, icon: "sun" as const, labelKey: "accessibility.theme.light" as const },
                { id: "dark" as ThemeMode, icon: "moon" as const, labelKey: "accessibility.theme.dark" as const },
                { id: "system" as ThemeMode, icon: "monitor" as const, labelKey: "accessibility.theme.system" as const },
              ] as const
            ).map((option) => {
              const active = themeMode === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    setThemeMode(option.id);
                    void Haptics.selectionAsync();
                  }}
                  style={[
                    styles.themeOption,
                    active && {
                      backgroundColor: colors.soft,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Feather
                    name={option.icon}
                    size={20}
                    color={active ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.themeOptionLabel,
                      {
                        color: active ? colors.foreground : colors.mutedForeground,
                        fontFamily: active ? "Inter_600SemiBold" : "Inter_500Medium",
                      },
                    ]}
                  >
                    {t(option.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={handleSignOut}
          style={[styles.signOut, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.signOutText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {t("common.signOut")}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  profileHero: {
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  profileHeroAvatarWrap: {
    position: "relative",
    marginBottom: 4,
  },
  profileHeroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  profileHeroImage: {
    width: 72,
    height: 72,
  },
  profileHeroEdit: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  profileHeroInitials: {
    fontSize: 24,
  },
  profileHeroName: { fontSize: 19 },
  profileHeroMeta: { fontSize: 12 },
  group: { marginTop: 10 },
  groupTitle: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 5,
    marginHorizontal: 4,
  },
  groupCard: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  themeSection: { marginTop: 10 },
  themeCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    flexDirection: "row",
    gap: 4,
  },
  themeOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 10,
    minHeight: 72,
  },
  themeOptionLabel: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { flex: 1, fontSize: 13 },
  expiringChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  expiringChipText: { fontSize: 10 },
  signOut: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 14,
    marginBottom: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  signOutText: { fontSize: 13 },
});
