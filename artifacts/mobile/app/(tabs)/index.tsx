import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { ShiftStatusBadge } from "@/components/worker/ShiftStatusBadge";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { FontFamily } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import { useColors, type ThemeColors } from "@/hooks/useColors";
import type { DashboardShiftSummary } from "@/lib/dashboard-api";
import { listMyCredentials } from "@/lib/resource-api";
import type { ShiftVisualState } from "@/lib/worker-api";
import {
  findInProgressShift,
  formatHomeDateLabel,
  greetingForHour,
  isBlockedByInProgressShift,
  shiftInitials,
  shortLocationLabel,
} from "@/lib/shift-utils";
import { showBlockedByInProgressAlert } from "@/lib/shift-block-alert";
import { resolveWorkerDisplayName } from "@/lib/display-name";

type QuickAccessTileConfig = {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  accent: string;
  href: string;
  badge?: string;
};

function QuickAccessTile({
  tile,
  colors,
  onPress,
}: {
  tile: QuickAccessTileConfig;
  colors: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: tile.accent }]}>
        <Feather name={tile.icon} size={18} color="#FFFFFF" />
      </View>
      <View style={styles.tileCopy}>
        <Text
          style={[
            styles.tileLabel,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {tile.label}
        </Text>
        {tile.badge ? (
          <Text
            style={[
              styles.tileBadgeText,
              { color: tile.accent, fontFamily: FontFamily.interBold },
            ]}
          >
            {tile.badge}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function HomeShiftCard({
  shift,
  inProgressShift,
}: {
  shift: DashboardShiftSummary;
  inProgressShift: DashboardShiftSummary | null;
}) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const location = shortLocationLabel(shift.participant_address);
  const meta = [shift.time_label, location].filter(Boolean).join(" · ");
  const visualState = (shift.visual_state || "scheduled") as ShiftVisualState;

  const openShift = () => {
    if (isBlockedByInProgressShift(shift, inProgressShift)) {
      showBlockedByInProgressAlert(t, inProgressShift, (id) =>
        router.push(`/shift/${id}` as never),
      );
      return;
    }
    router.push(`/shift/${shift.id}` as never);
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={openShift}
      style={[
        styles.shiftCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={[styles.shiftAvatar, { backgroundColor: colors.soft }]}>
        <Text
          style={[
            styles.shiftAvatarText,
            { color: colors.primary, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {shiftInitials(shift.participant_name)}
        </Text>
      </View>
      <View style={styles.shiftBody}>
        <Text
          style={[
            styles.shiftName,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {shift.participant_name}
        </Text>
        <Text
          style={[
            styles.shiftMeta,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interRegular,
            },
          ]}
        >
          {meta || ""}
        </Text>
        <View style={{ alignSelf: "flex-start", marginTop: 6 }}>
          <ShiftStatusBadge visualState={visualState} />
        </View>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const { user, isAuthenticated } = useAuth();

  const landing = useWorkerLandingDashboard();
  const { data: credentials } = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
    enabled: isAuthenticated,
  });
  const expiringCount = useMemo(
    () =>
      (credentials ?? []).filter((item) => item.status === "expiring").length,
    [credentials],
  );

  const displayName = resolveWorkerDisplayName({
    landingFullName: landing.data?.worker.full_name,
    landingFirstName: landing.data?.worker.first_name,
    authFullName: user?.full_name,
    fallback: "there",
  });
  const greetingPeriod = greetingForHour();
  const greetingKey =
    greetingPeriod === "morning"
      ? "dashboard.greeting.morning"
      : greetingPeriod === "afternoon"
        ? "dashboard.greeting.afternoon"
        : "dashboard.greeting.evening";
  const greeting = t(greetingKey);

  const shifts = landing.data?.today_shifts ?? [];
  const total = landing.data?.stats.shifts_today ?? shifts.length;
  const done =
    landing.data?.stats.completed_today ??
    shifts.filter((s) => s.visual_state === "completed").length;
  const dateLabel =
    landing.data?.greeting_context.date_label || formatHomeDateLabel();

  const inProgressShift = useMemo(() => findInProgressShift(shifts), [shifts]);
  const featuredShift =
    inProgressShift ??
    shifts.find((shift) => shift.visual_state === "scheduled") ??
    null;
  // The hero card above already shows the featured shift's full detail —
  // repeating it again in this list right below is pure duplication when
  // it's the only shift today, and just noise when there are others.
  const remainingShifts = featuredShift
    ? shifts.filter((shift) => shift.id !== featuredShift.id)
    : shifts;
  const progress = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;

  const handleRefresh = () => {
    void landing.refetch();
    void queryClient.invalidateQueries({
      queryKey: ["dashboard", "worker-landing"],
    });
  };

  const openContinue = () => {
    if (featuredShift) {
      router.push(`/shift/${featuredShift.id}` as never);
      return;
    }
    router.push("/(tabs)/shifts" as never);
  };

  const quickAccessTiles: QuickAccessTileConfig[] = [
    {
      key: "participants",
      icon: "users",
      label: t("dashboard.myParticipants"),
      accent: colors.pink,
      href: "/(tabs)/participants",
    },
    {
      key: "availability",
      icon: "calendar",
      label: t("nav.availability"),
      accent: colors.primary,
      href: "/worker/availability",
    },
    {
      key: "toolkit",
      icon: "briefcase",
      label: t("nav.toolkit"),
      accent: colors.navy,
      href: "/toolkit",
    },
    {
      key: "credentials",
      icon: "award",
      label: t("nav.credentials"),
      accent: colors.warning,
      href: "/credentials",
      badge:
        expiringCount > 0
          ? t("settings.credentialsExpiring", { count: expiringCount })
          : undefined,
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.home")} />

      {landing.isLoading && !landing.data ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 120 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={landing.isRefetching}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <Text
            style={[
              styles.greeting,
              { color: colors.foreground, fontFamily: FontFamily.h1 },
            ]}
          >
            {t("dashboard.greetingWithName", { greeting, name: displayName })}
          </Text>
          <Text
            style={[
              styles.subtitle,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {landing.data
              ? t("dashboard.shiftsTodayMeta", {
                  date: dateLabel,
                  count: total,
                })
              : dateLabel}
          </Text>

          {landing.isError ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.bodyText, { color: colors.foreground }]}>
                {t("dashboard.homeLoadError")}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={handleRefresh}
                style={styles.retryButton}
              >
                <Text style={[styles.bodyText, { color: colors.primary }]}>
                  {t("common.retry")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {landing.data ? (
            <View style={[styles.hero, { backgroundColor: colors.heroCard }]}>
              <View style={styles.heroTop}>
                <View style={styles.heroIcon}>
                  <Feather
                    name={inProgressShift ? "activity" : "calendar"}
                    size={22}
                    color="#FFFFFF"
                  />
                </View>
                <Text
                  style={[
                    styles.heroLabel,
                    {
                      color: colors.heroMuted,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t(
                    inProgressShift
                      ? "dashboard.homeActiveShift"
                      : featuredShift
                        ? "dashboard.homeNextShift"
                        : "dashboard.todaysShifts",
                  )}
                </Text>
              </View>
              <Text
                style={[
                  styles.heroStat,
                  { color: "#FFFFFF", fontFamily: FontFamily.h1 },
                ]}
              >
                {featuredShift?.participant_name ??
                  t(
                    total === 0
                      ? "dashboard.noShiftsToday"
                      : "dashboard.homeDayComplete",
                  )}
              </Text>
              <Text style={[styles.heroDetail, { color: colors.heroMuted }]}>
                {featuredShift
                  ? [
                      featuredShift.time_label,
                      shortLocationLabel(featuredShift.participant_address),
                    ]
                      .filter(Boolean)
                      .join(" / ")
                  : t(
                      total === 0
                        ? "dashboard.noShiftsDetail"
                        : "dashboard.homeDayCompleteDetail",
                    )}
              </Text>
              <Pressable
                onPress={openContinue}
                style={[
                  styles.continueBtn,
                  { backgroundColor: colors.primary },
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.continueText,
                    {
                      color: colors.primaryForeground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t(
                    inProgressShift
                      ? "dashboard.continueSession"
                      : featuredShift
                        ? "dashboard.homeReviewShift"
                        : "dashboard.homeViewSchedule",
                  )}
                </Text>
                <Feather
                  name="arrow-right"
                  size={20}
                  color={colors.primaryForeground}
                />
              </Pressable>
              {total > 0 ? (
                <View style={styles.progressSummary}>
                  <Text style={[styles.heroLabel, { color: colors.heroMuted }]}>
                    {t("dashboard.homeCompleted", { done, total })}
                  </Text>
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel={t("dashboard.todaysShifts")}
                    accessibilityValue={{
                      min: 0,
                      max: total,
                      now: Math.min(done, total),
                    }}
                    style={[
                      styles.progressTrack,
                      { backgroundColor: colors.progressTrack },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: (progress * 100 + "%") as `${number}%`,
                          backgroundColor: colors.success,
                        },
                      ]}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {!landing.data || remainingShifts.length === 0 ? null : (
            <>
              <Text
                style={[
                  styles.sectionTitle,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t("dashboard.todaysShifts")}
              </Text>
              {shifts.length === 0 ? (
                <Text
                  style={[
                    styles.empty,
                    {
                      color: colors.mutedForeground,
                      fontFamily: FontFamily.interMedium,
                    },
                  ]}
                >
                  {t("dashboard.noShiftsToday")}
                </Text>
              ) : (
                remainingShifts.map((shift) => (
                  <HomeShiftCard
                    key={shift.id}
                    shift={shift}
                    inProgressShift={inProgressShift}
                  />
                ))
              )}
            </>
          )}
          <Text
            style={[
              styles.sectionTitle,
              styles.quickAccessTitle,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t("dashboard.quickAccess")}
          </Text>
          <View style={styles.quickGrid}>
            {quickAccessTiles.map((tile) => (
              <QuickAccessTile
                key={tile.key}
                tile={tile}
                colors={colors}
                onPress={() => router.push(tile.href as never)}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  greeting: { fontSize: 24, lineHeight: 31, marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 21, marginBottom: 24 },
  hero: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  heroLabel: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: FontFamily.interMedium,
  },
  heroStat: { fontSize: 26, lineHeight: 33, marginBottom: 8 },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroDetail: { fontSize: 15, lineHeight: 23, fontFamily: FontFamily.body },
  progressSummary: { marginTop: 22, gap: 10 },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  notice: { padding: 16, borderWidth: 1, borderRadius: 20, marginBottom: 20 },
  bodyText: { fontSize: 15, lineHeight: 22, fontFamily: FontFamily.body },
  retryButton: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
  },
  continueBtn: {
    marginTop: 20,
    minHeight: 56,
    justifyContent: "space-between",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  continueText: { flexShrink: 1, fontSize: 16, lineHeight: 22 },
  quickAccessTitle: { marginTop: 24 },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tileCopy: { flex: 1, minWidth: 0, gap: 1 },
  tileLabel: { fontSize: 13, lineHeight: 18 },
  tileBadgeText: { fontSize: 11, lineHeight: 15 },
  sectionTitle: { fontSize: 20, lineHeight: 26, marginBottom: 14 },
  shiftCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  shiftAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  shiftAvatarText: { fontSize: 14 },
  shiftBody: { flex: 1, minWidth: 0, gap: 5 },
  shiftName: { fontSize: 16, lineHeight: 23 },
  shiftMeta: { fontSize: 13, lineHeight: 20 },
  empty: { fontSize: 15, lineHeight: 23, paddingVertical: 20 },
});
