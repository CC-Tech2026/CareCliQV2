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
import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
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
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        elevatedCardShadow(colors.scheme === "dark"),
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: colors.soft }]}>
        <Feather name={tile.icon} size={20} color={tile.accent} />
      </View>
      <Text style={[styles.tileLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={2}>
        {tile.label}
      </Text>
      {tile.badge ? (
        <View style={[styles.tileBadge, { backgroundColor: colors.statusProgressBg }]}>
          <Text style={[styles.tileBadgeText, { color: colors.warning, fontFamily: "Inter_700Bold" }]}>
            {tile.badge}
          </Text>
        </View>
      ) : null}
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
      showBlockedByInProgressAlert(t, inProgressShift, (id) => router.push(`/shift/${id}` as never));
      return;
    }
    router.push(`/shift/${shift.id}` as never);
  };

  return (
    <Pressable
      onPress={openShift}
      style={[styles.shiftCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.shiftAvatar, { backgroundColor: colors.soft }]}>
        <Text style={[styles.shiftAvatarText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
          {shiftInitials(shift.participant_name)}
        </Text>
      </View>
      <View style={styles.shiftBody}>
        <Text style={[styles.shiftName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
          {shift.participant_name}
        </Text>
        <Text style={[styles.shiftMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
          {meta || "—"}
        </Text>
      </View>
      <ShiftStatusBadge visualState={visualState} />
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
    () => (credentials ?? []).filter((item) => item.status === "expiring").length,
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
  const done = landing.data?.stats.completed_today ?? shifts.filter((s) => s.visual_state === "completed").length;
  const dateLabel = landing.data?.greeting_context.date_label || formatHomeDateLabel();

  const progressSlots = useMemo(() => {
    const count = Math.max(total, 1);
    return Array.from({ length: count }, (_, i) => i < done);
  }, [total, done]);

  const continueShiftId = useMemo(() => {
    const active = findInProgressShift(shifts);
    return active?.id ?? shifts.find((s) => s.visual_state === "scheduled")?.id ?? shifts[0]?.id ?? null;
  }, [shifts]);

  const inProgressShift = useMemo(() => findInProgressShift(shifts), [shifts]);

  const handleRefresh = () => {
    void landing.refetch();
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "worker-landing"] });
  };

  const openContinue = () => {
    if (continueShiftId) {
      router.push(`/shift/${continueShiftId}` as never);
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
      badge: expiringCount > 0 ? t("settings.credentialsExpiring", { count: expiringCount }) : undefined,
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
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={landing.isRefetching}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <Text style={[styles.greeting, { color: colors.foreground, fontFamily: FontFamily.h1 }]}>
            {t("dashboard.greetingWithName", { greeting, name: displayName })}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("dashboard.shiftsTodayMeta", { date: dateLabel, count: total })}
          </Text>

          <View style={[styles.hero, { backgroundColor: colors.heroCard }]}>
            <Text style={[styles.heroLabel, { color: colors.heroMuted, fontFamily: "Inter_400Regular" }]}>
              {t("dashboard.todaysDocumentation")}
            </Text>
            <Text style={[styles.heroStat, { color: "#FFFFFF", fontFamily: "Inter_700Bold" }]}>
              {t("dashboard.documentedOf", { done, total: Math.max(total, done) })}
            </Text>
            <View style={styles.progressRow}>
              {progressSlots.map((filled, index) => (
                <View
                  key={index}
                  style={[
                    styles.progressSeg,
                    { backgroundColor: filled ? colors.success : colors.progressTrack },
                  ]}
                />
              ))}
            </View>
            <Pressable
              onPress={openContinue}
              style={[styles.continueBtn, { backgroundColor: colors.pink }]}
              accessibilityRole="button"
            >
              <Feather name="play" size={14} color="#FFFFFF" />
              <Text style={[styles.continueText, { fontFamily: "Inter_600SemiBold" }]}>
                {t("dashboard.continueSession")}
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.sectionTitle, styles.quickAccessTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
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

          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            {t("dashboard.todaysShifts")}
          </Text>

          {shifts.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              {t("dashboard.noShiftsToday")}
            </Text>
          ) : (
            shifts.map((shift) => (
              <HomeShiftCard key={shift.id} shift={shift} inProgressShift={inProgressShift} />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },
  greeting: { fontSize: 21, marginTop: 0, marginBottom: 2 },
  subtitle: { fontSize: 12, marginBottom: 12 },
  hero: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  heroLabel: { fontSize: 12, marginBottom: 4 },
  heroStat: { fontSize: 19, marginBottom: 10 },
  progressRow: { flexDirection: "row", gap: 5 },
  progressSeg: { flex: 1, height: 5, borderRadius: 99 },
  continueBtn: {
    marginTop: 12,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  continueText: { color: "#FFFFFF", fontSize: 12 },
  quickAccessTitle: { marginTop: 4 },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: { fontSize: 13, lineHeight: 17 },
  tileBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: -2,
  },
  tileBadgeText: { fontSize: 10 },
  sectionTitle: { fontSize: 15, marginBottom: 8 },
  shiftCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
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
  shiftAvatarText: { fontSize: 12 },
  shiftBody: { flex: 1, gap: 2 },
  shiftName: { fontSize: 13 },
  shiftMeta: { fontSize: 11 },
  empty: { fontSize: 13, paddingVertical: 12 },
});
