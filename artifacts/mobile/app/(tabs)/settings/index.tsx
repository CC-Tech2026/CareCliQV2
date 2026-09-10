import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";

import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { useAuth } from "@/context/AuthContext";
import {
  usePreferences,
  useT,
  type ThemeMode,
} from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "@/lib/haptics";
import { resolveWorkerDisplayName } from "@/lib/display-name";
import { shiftInitials } from "@/lib/shift-utils";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import { showAlert } from "@/lib/alert";
import { getWorkerProfile } from "@/lib/user-api";
import { LANGUAGES } from "@/lib/i18n/translations";

import { FontFamily } from "@/constants/typography";

type FeatherIconName = keyof typeof Feather.glyphMap;

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

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.group}>
      <Text
        style={[
          styles.groupTitle,
          {
            color: colors.mutedForeground,
            fontFamily: FontFamily.interSemiBold,
          },
        ]}
      >
        {title}
      </Text>
      <View
        style={[
          styles.groupCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
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
  description,
}: {
  icon: FeatherIconName;
  label: string;
  onPress?: () => void;
  showDivider?: boolean;
  trailing?: React.ReactNode;
  description?: string;
}) {
  const colors = useColors();
  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: colors.soft }]}>
        <Feather name={icon} size={15} color={colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          style={[
            styles.rowLabel,
            { color: colors.foreground, fontFamily: FontFamily.interRegular },
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              styles.rowDescription,
              { color: colors.mutedForeground, fontFamily: FontFamily.body },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {trailing ?? (
        <Feather
          name="chevron-right"
          size={15}
          color={colors.mutedForeground}
        />
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          showDivider && {
            borderBottomColor: colors.soft,
            borderBottomWidth: 1,
          },
          pressed && { backgroundColor: colors.soft },
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.row,
        showDivider && { borderBottomColor: colors.soft, borderBottomWidth: 1 },
      ]}
    >
      {content}
    </View>
  );
}

function SettingsToggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const colors = useColors();
  return (
    <Switch
      accessibilityLabel={label}
      style={{ minHeight: 44 }}
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor="#FFFFFF"
    />
  );
}

type SettingsItem = {
  key: string;
  icon: FeatherIconName;
  label: string;
  keywords: string;
  render: (showDivider: boolean) => React.ReactNode;
};

type SettingsGroupConfig = {
  key: string;
  title: string;
  items: SettingsItem[];
};

const TEXT_SIZE_OPTIONS = [
  {
    id: "small" as const,
    labelKey: "accessibility.textSize.small" as const,
    preview: 13,
  },
  {
    id: "default" as const,
    labelKey: "accessibility.textSize.default" as const,
    preview: 16,
  },
  {
    id: "large" as const,
    labelKey: "accessibility.textSize.large" as const,
    preview: 20,
  },
];

export default function SettingsTabScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { user, logout, updateUser, isAuthenticated } = useAuth();
  const {
    highContrast,
    setHighContrast,
    dyslexiaFont,
    setDyslexiaFont,
    reduceMotion,
    setReduceMotion,
    hapticFeedback,
    setHapticFeedback,
    language,
    setLanguage,
    textScale,
    setTextScale,
    themeMode,
    setThemeMode,
  } = usePreferences();

  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [query, setQuery] = useState("");

  const landing = useWorkerLandingDashboard();
  const { data: profile } = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (
      profile?.profile_photo_url &&
      profile.profile_photo_url !== user?.profile_photo_url
    ) {
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
  const photoUrl =
    user?.profile_photo_url || profile?.profile_photo_url || null;
  const roleLabel = formatRole(user?.role);
  const appVersion =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "1.0.0";
  const languageLabel =
    LANGUAGES.find((option) => option.code === language)?.nativeLabel ??
    "English";
  const themeLabel = t(
    themeMode === "light"
      ? "accessibility.theme.light"
      : themeMode === "dark"
        ? "accessibility.theme.dark"
        : "accessibility.theme.system",
  );
  const textSizeLabel = t(
    TEXT_SIZE_OPTIONS.find((o) => o.id === textScale)?.labelKey ??
      "accessibility.textSize.default",
  );

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

  const themeSegmented = (
    <View
      style={[
        styles.segmented,
        { backgroundColor: colors.soft, borderColor: colors.border },
      ]}
    >
      {(
        [
          {
            id: "light" as ThemeMode,
            icon: "sun" as const,
            labelKey: "accessibility.theme.light" as const,
          },
          {
            id: "dark" as ThemeMode,
            icon: "moon" as const,
            labelKey: "accessibility.theme.dark" as const,
          },
          {
            id: "system" as ThemeMode,
            icon: "monitor" as const,
            labelKey: "accessibility.theme.system" as const,
          },
        ] as const
      ).map((option) => {
        const active = themeMode === option.id;
        return (
          <Pressable
            key={option.id}
            onPress={() => {
              setThemeMode(option.id);
              if (hapticFeedback) void Haptics.selectionAsync();
            }}
            style={[
              styles.segmentedOption,
              active && { backgroundColor: colors.card },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Feather
              name={option.icon}
              size={18}
              color={active ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[
                styles.segmentedOptionLabel,
                {
                  color: active ? colors.foreground : colors.mutedForeground,
                  fontFamily: active
                    ? FontFamily.interSemiBold
                    : FontFamily.interMedium,
                },
              ]}
            >
              {t(option.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const textSizeSegmented = (
    <View
      style={[
        styles.segmented,
        { backgroundColor: colors.soft, borderColor: colors.border },
      ]}
    >
      {TEXT_SIZE_OPTIONS.map((option) => {
        const active = textScale === option.id;
        return (
          <Pressable
            key={option.id}
            onPress={() => {
              setTextScale(option.id);
              if (hapticFeedback) void Haptics.selectionAsync();
            }}
            style={[
              styles.segmentedOption,
              active && { backgroundColor: colors.card },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={{
                color: active ? colors.primary : colors.mutedForeground,
                fontFamily: FontFamily.interBold,
                fontSize: option.preview,
              }}
            >
              Aa
            </Text>
            <Text
              style={[
                styles.segmentedOptionLabel,
                {
                  color: active ? colors.foreground : colors.mutedForeground,
                  fontFamily: active
                    ? FontFamily.interSemiBold
                    : FontFamily.interMedium,
                },
              ]}
            >
              {t(option.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const groupsConfig: SettingsGroupConfig[] = useMemo(
    () => [
      {
        key: "worker",
        title: t("settings.worker"),
        items: [
          {
            key: "account",
            icon: "user",
            label: t("settings.row.accountDetails"),
            keywords: "profile name phone email compliance",
            render: (showDivider) => (
              <SettingsRow
                icon="user"
                label={t("settings.row.accountDetails")}
                onPress={() => router.push("/(tabs)/settings/account" as never)}
                showDivider={showDivider}
              />
            ),
          },
        ],
      },
      {
        key: "preferences",
        title: t("settings.preferences"),
        items: [
          {
            key: "accessibility",
            icon: "sliders",
            label: t("nav.accessibility"),
            keywords:
              "accessibility display theme appearance dark mode light font size text scale reduce motion high contrast dyslexia haptic feedback language english vietnamese chinese arabic translate",
            render: (showDivider) => (
              <SettingsRow
                icon="sliders"
                label={t("nav.accessibility")}
                description={`${themeLabel} / ${textSizeLabel} / ${languageLabel}`}
                onPress={() => setAccessibilityOpen(true)}
                showDivider={showDivider}
              />
            ),
          },
        ],
      },
      {
        key: "security",
        title: t("settings.group.securityPrivacy"),
        items: [
          {
            key: "security",
            icon: "shield",
            label: t("nav.security"),
            keywords:
              "password login change password face id fingerprint touch id biometric unlock two factor authentication mfa 2fa otp",
            render: (showDivider) => (
              <SettingsRow
                icon="shield"
                label={t("nav.security")}
                onPress={() => router.push("/worker/security" as never)}
                showDivider={showDivider}
              />
            ),
          },
          {
            key: "sessions",
            icon: "monitor",
            label: t("security.activeSessions"),
            keywords: "devices logged in sessions",
            render: (showDivider) => (
              <SettingsRow
                icon="monitor"
                label={t("security.activeSessions")}
                onPress={() => router.push("/worker/sessions" as never)}
                showDivider={showDivider}
              />
            ),
          },
          {
            key: "privacy",
            icon: "file-text",
            label: t("nav.privacy"),
            keywords:
              "privacy policy legal terms data permissions access consent agreement analytics download export delete account",
            render: (showDivider) => (
              <SettingsRow
                icon="file-text"
                label={t("nav.privacy")}
                onPress={() => router.push("/worker/privacy" as never)}
                showDivider={showDivider}
              />
            ),
          },
        ],
      },
      {
        key: "support",
        title: t("settings.group.support"),
        items: [
          {
            key: "help",
            icon: "help-circle",
            label: t("help.title"),
            keywords: "help faq support contact email known issues",
            render: (showDivider) => (
              <SettingsRow
                icon="help-circle"
                label={t("help.title")}
                onPress={() => router.push("/worker/help" as never)}
                showDivider={showDivider}
              />
            ),
          },
          {
            key: "about",
            icon: "info",
            label: t("settings.row.about", { version: appVersion }),
            keywords: "about version app info",
            render: (showDivider) => (
              <SettingsRow
                icon="info"
                label={t("settings.row.about", { version: appVersion })}
                onPress={() =>
                  showAlert(
                    t("settings.row.about", { version: appVersion }),
                    "CareCliQ",
                  )
                }
                showDivider={showDivider}
              />
            ),
          },
        ],
      },
    ],
    [t, router, appVersion, themeLabel, textSizeLabel, languageLabel],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return groupsConfig;
    return groupsConfig
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.keywords}`
            .toLowerCase()
            .includes(normalizedQuery),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groupsConfig, normalizedQuery]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("settings.workerTitle")} showBack />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.profileHero,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Pressable
            onPress={() => router.push("/worker/profile-photo" as never)}
            style={styles.profileHeroAvatarWrap}
            accessibilityRole="button"
            accessibilityLabel={t("profile.photo.editA11y")}
          >
            <View
              style={[
                styles.profileHeroAvatar,
                { backgroundColor: colors.soft },
              ]}
            >
              {photoUrl ? (
                <Image
                  source={{ uri: photoUrl }}
                  style={styles.profileHeroImage}
                  contentFit="cover"
                />
              ) : (
                <Text
                  style={[
                    styles.profileHeroInitials,
                    { color: colors.primary, fontFamily: FontFamily.interBold },
                  ]}
                >
                  {initials}
                </Text>
              )}
            </View>
            <View
              style={[
                styles.profileHeroEdit,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.background,
                },
              ]}
            >
              <Feather
                name="edit-2"
                size={12}
                color={colors.primaryForeground}
              />
            </View>
          </Pressable>
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <Text
              style={[
                styles.profileHeroName,
                { color: colors.foreground, fontFamily: FontFamily.interBold },
              ]}
            >
              {displayName}
            </Text>
            <Text
              style={[
                styles.profileHeroMeta,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {roleLabel}
            </Text>
          </View>
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.soft }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            accessibilityLabel={t("settings.search.placeholder")}
            value={query}
            onChangeText={setQuery}
            placeholder={t("settings.search.placeholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.searchInput,
              { color: colors.foreground, fontFamily: FontFamily.interRegular },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery("")}
              accessibilityRole="button"
              accessibilityLabel={t("common.clearSearch")}
            >
              <View
                style={[styles.searchClear, { backgroundColor: colors.card }]}
              >
                <Feather name="x" size={12} color={colors.mutedForeground} />
              </View>
            </Pressable>
          )}
        </View>

        {filteredGroups.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="search" size={22} color={colors.mutedForeground} />
            <Text
              style={[
                styles.emptyStateText,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              {t("settings.search.empty", { query })}
            </Text>
          </View>
        ) : (
          filteredGroups.map((group) => (
            <SettingsGroup key={group.key} title={group.title}>
              {group.items.map((item, index) => (
                <React.Fragment key={item.key}>
                  {item.render(index < group.items.length - 1)}
                </React.Fragment>
              ))}
            </SettingsGroup>
          ))
        )}

        {!normalizedQuery && (
          <Pressable
            accessibilityRole="button"
            onPress={handleSignOut}
            style={[
              styles.signOut,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.signOutText,
                {
                  color: colors.destructive,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("common.signOut")}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal
        visible={accessibilityOpen}
        transparent
        animationType={reduceMotion ? "none" : "slide"}
        onRequestClose={() => setAccessibilityOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setAccessibilityOpen(false)}
            accessible={false}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View
              style={[styles.sheetHandle, { backgroundColor: colors.border }]}
            />
            <View style={styles.sheetHeader}>
              <Text
                style={[
                  styles.sheetTitle,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interBold,
                  },
                ]}
              >
                {t("nav.accessibility")}
              </Text>
              <Pressable
                onPress={() => setAccessibilityOpen(false)}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel={t("common.done")}
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
            >
              <Text
                style={[
                  styles.groupTitle,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t("accessibility.theme")}
              </Text>
              {themeSegmented}

              <Text
                style={[
                  styles.groupTitle,
                  styles.sheetSectionSpacing,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {`${t("accessibility.fontSize")} · ${textSizeLabel}`}
              </Text>
              {textSizeSegmented}

              <Text
                style={[
                  styles.groupTitle,
                  styles.sheetSectionSpacing,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {`${t("accessibility.languageHeading")} · ${languageLabel}`}
              </Text>
              <View style={[styles.groupCard, { borderColor: colors.border }]}>
                {LANGUAGES.map((lang, index) => {
                  const active = language === lang.code;
                  return (
                    <Pressable
                      key={lang.code}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      onPress={() => {
                        setLanguage(lang.code);
                        if (hapticFeedback) void Haptics.selectionAsync();
                      }}
                      style={[
                        styles.row,
                        index < LANGUAGES.length - 1 && {
                          borderBottomColor: colors.soft,
                          borderBottomWidth: 1,
                        },
                        active && { backgroundColor: colors.activeBg },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: active ? colors.primary : colors.foreground,
                            fontFamily: FontFamily.interSemiBold,
                            fontSize: 14,
                          }}
                        >
                          {lang.nativeLabel}
                        </Text>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: FontFamily.interRegular,
                            fontSize: 12,
                            marginTop: 1,
                          }}
                        >
                          {lang.label}
                        </Text>
                      </View>
                      {active ? (
                        <Feather
                          name="check"
                          size={16}
                          color={colors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <Text
                style={[
                  styles.groupTitle,
                  styles.sheetSectionSpacing,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t("settings.preferences")}
              </Text>
              <View style={[styles.groupCard, { borderColor: colors.border }]}>
                <SettingsRow
                  icon="pause"
                  label={t("settings.row.reduceMotion")}
                  trailing={
                    <SettingsToggle
                      label={t("settings.row.reduceMotion")}
                      value={reduceMotion}
                      onValueChange={handleReduceMotionToggle}
                    />
                  }
                />
                <SettingsRow
                  icon="sun"
                  label={t("accessibility.highContrast")}
                  trailing={
                    <SettingsToggle
                      label={t("accessibility.highContrast")}
                      value={highContrast}
                      onValueChange={setHighContrast}
                    />
                  }
                />
                <SettingsRow
                  icon="book-open"
                  label={t("accessibility.dyslexia")}
                  trailing={
                    <SettingsToggle
                      label={t("accessibility.dyslexia")}
                      value={dyslexiaFont}
                      onValueChange={setDyslexiaFont}
                    />
                  }
                />
                <SettingsRow
                  icon="activity"
                  label={t("settings.row.haptic")}
                  showDivider={false}
                  trailing={
                    <SettingsToggle
                      label={t("settings.row.haptic")}
                      value={hapticFeedback}
                      onValueChange={handleHapticToggle}
                    />
                  }
                />
              </View>
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAccessibilityOpen(false)}
              style={[styles.doneButton, { backgroundColor: colors.primary }]}
            >
              <Text
                style={{
                  color: colors.primaryForeground,
                  fontFamily: FontFamily.interSemiBold,
                  fontSize: 16,
                }}
              >
                {t("common.done")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    padding: 0,
    minHeight: 28,
  },
  searchClear: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 48,
  },
  emptyStateText: { fontSize: 13, textAlign: "center", paddingHorizontal: 24 },
  profileHero: {
    flexDirection: "row",
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
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
  profileHeroName: { fontSize: 22, lineHeight: 28 },
  profileHeroMeta: { fontSize: 14, lineHeight: 20 },
  group: { marginTop: 24 },
  groupTitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
    marginHorizontal: 4,
  },
  groupCard: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  segmented: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 4,
    flexDirection: "row",
    gap: 4,
  },
  segmentedOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    minHeight: 60,
  },
  segmentedOptionLabel: {
    fontSize: 13,
    width: "100%",
    flexShrink: 1,
    textAlign: "center",
    lineHeight: 18,
  },
  row: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    flexShrink: 0,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 15, lineHeight: 22 },
  rowDescription: { fontSize: 13, lineHeight: 19 },
  signOut: {
    minHeight: 52,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 20,
    marginTop: 14,
    marginBottom: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  signOutText: { fontSize: 15 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    maxHeight: "85%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    marginBottom: 6,
  },
  sheetTitle: { fontSize: 20, lineHeight: 26, flex: 1 },
  sheetScroll: { paddingHorizontal: 18, paddingBottom: 12 },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  doneButton: {
    minHeight: 52,
    marginHorizontal: 18,
    marginTop: 8,
    padding: 12,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBody: { paddingHorizontal: 18, paddingBottom: 12, gap: 10 },
  sheetSectionSpacing: { marginTop: 18 },
});
